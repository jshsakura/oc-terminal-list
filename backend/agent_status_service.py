"""에이전트 상태 워처 싱글턴 — tmux 폴링을 SSE 브로드캐스트와 웹 푸시에 연결한다.

수집기(agent_status_watcher.AgentStatusWatcher)와 전달 경로(sse_broadcast, push_service)를
엮는 배선만 담당한다. main 은 lifespan 에서 start/stop 만 부르고, 라우트는 snapshot()
만 읽는다 — 그래야 main 전역을 역참조하지 않는다.
"""
from __future__ import annotations

import logging
import time

import agent_status_events
from agent_status_watcher import AgentStatusWatcher, PANE_FORMAT
from pane_excerpt import extract_excerpt
from push_service import build_agent_done_payload, send_to_user
from notify_message import summarize_others
from session_label import describe_session, format_label, shorten_path
from telegram_service import notify_agent_done
from sqlite_storage import storage
from sse_broadcast import _broadcast_sse, _tab_state_sse_queues
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# 중복 판정은 시간이 아니라 **내용**으로 한다. 같은 제목 + 같은 화면 발췌면
# 다시 보내지 않는다. (working↔idle 스피너 흔들림 자체는 워처가 이미 접으므로
# 여기까지 오지 않는다 — 여기 오는 completed 는 진짜 턴 종료다.)
_last_notified_at: dict[str, float] = {}
# 세션이 working 으로 들어간 시각 — 완료 알림의 "얼마나 걸렸나" 는 여기서 나온다.
_working_since: dict[str, float] = {}
# 마지막으로 알린 완료의 지문(제목 + 화면 발췌). 같은 지문이면 다시 안 보낸다 —
# 에이전트가 "짧게 응답하고 멈춤" 을 반복해도 내용이 그대로면 새 알림이 아니다.
#
# ⚠️ 여기 담기는 건 "이미 보낸 것" 이지 "사용자가 [계속] 을 눌렀는지" 가 아니다.
# 안 누른 상태를 기다리며 막아두는 게 아니라서, 다음에 **다른** 일이 끝나면 그건
# 지문이 달라 정상적으로 알림이 간다. 세워두는 상태가 아니다.
_last_signature: dict[str, str] = {}

# 원격 화면 발췌를 기다리는 상한. 알림 하나가 이만큼도 못 받으면 발췌 없이 보낸다.
REMOTE_EXCERPT_TIMEOUT_SEC = 8.0


def _state_key(change: dict) -> str:
    """내부 상태 맵의 키.

    ⚠️ 원격 pane 의 sessionId 는 **그 호스트의 tmux 세션명**(`mobile` 등)이라 호스트가
    다르면 겹친다. 겹치면 한쪽의 완료가 다른 쪽의 지문을 덮어 알림이 조용히 사라진다.
    그래서 호스트를 앞에 붙인다. 화면·알림에 나가는 값은 여전히 bare sessionId 다
    (`describe_session` 이 tmuxSession 정확일치로 찾는다).
    """
    host_id = change.get("hostId")
    session_id = change.get("sessionId") or ""
    return f"{host_id}:{session_id}" if host_id else session_id


def _forget_session(session_id: str) -> None:
    _last_notified_at.pop(session_id, None)
    _working_since.pop(session_id, None)
    _last_signature.pop(session_id, None)


def _track_working(change: dict, now: float) -> float | None:
    """working 진입을 기록하고, 끝났으면 소요시간을 돌려준다."""
    session_id = _state_key(change)
    status, previous = change.get("status"), change.get("previousStatus")
    if status == "working" and previous != "working":
        _working_since[session_id] = now
        return None
    if previous == "working" and status != "working":
        started = _working_since.pop(session_id, None)
        return now - started if started else None
    return None


async def _list_agent_panes() -> str:
    return await tmux_manager.list_panes_raw(PANE_FORMAT)


async def _capture_excerpt(session_id: str) -> str:
    """화면 마지막 몇 줄. LLM 없이 capture-pane 출력에서 UI 장식만 걷어낸다."""
    pane_text = await tmux_manager.capture_pane(session_id)
    return extract_excerpt(pane_text)


async def _default_owner(change: dict) -> str | None:
    try:
        return await storage.get_session_owner(change.get("sessionId"))
    except Exception as e:
        logger.debug("session owner lookup failed (%s): %s", change.get("sessionId"), e)
        return None


async def _notify_completions(changes: list[dict], *, resolve_owner=None, capture=None) -> None:
    """working → 그 외 전이를 기기로 밀어준다.

    구독이 있다는 것 자체가 사용자의 명시적 동의다(브라우저 권한 + 구독 등록).
    별도 설정 토글을 두지 않는 이유 — 끄고 싶으면 구독을 해제하면 된다.

    소유자 조회와 화면 발췌는 **주입받는다.** 로컬은 세션 표와 tmux 를 보면 되지만,
    원격은 소유자를 리모트 연결이 알고 발췌는 그 소켓으로 물어야 한다. 여기를 두 벌로
    만들면 중복 억제·소요시간 계산 같은 규칙이 갈라진다 — 그건 조용히 어긋나는 종류다.
    """
    resolve_owner = resolve_owner or _default_owner
    capture = capture or (lambda change: _capture_excerpt(change.get("sessionId")))
    now = time.time()
    for change in changes:
        session_id = change.get("sessionId")
        if not session_id:
            continue
        state_key = _state_key(change)
        if change.get("gone"):
            _forget_session(state_key)
            continue
        # 완료가 아니어도 working 진입은 기록해 둬야 나중에 소요시간을 낼 수 있다.
        elapsed = _track_working(change, now)
        if not change.get("completed"):
            continue
        owner = await resolve_owner(change)
        if not owner:
            continue   # 소유자를 모르는 세션

        # 화면 발췌를 여기서 한 번 뽑는다 — 지문 계산과 두 알림이 같이 쓴다.
        excerpt = await capture(change)

        # 같은 완료를 또 보내지 않는다: 제목 + 발췌가 직전과 같으면 새 알림이 아니다.
        # (에이전트가 "짧게 응답하고 멈춤" 을 반복해도 내용이 그대로면 조용히 넘어간다.)
        signature = f"{change.get('title', '')}\x00{excerpt}"
        # 같은 내용이면 다시 안 보낸다. 내용이 **바뀌면** 시간과 무관하게 보낸다 —
        # min-gap 은 "같은 걸 또" 를 막는 것이지 새 소식을 지연시키는 게 아니다.
        if _last_signature.get(state_key) == signature:
            continue
        _last_signature[state_key] = signature
        _last_notified_at[state_key] = now

        # "작업 완료" 만으로는 어느 터미널인지 알 수 없다 — 주소(탭.pane)를 붙인다.
        described = await describe_session(owner, session_id, change.get("cwd", ""))
        label = format_label(described, session_id)

        try:
            await send_to_user(owner, build_agent_done_payload(change, label))
        except Exception as e:
            # 알림 실패가 상태 브로드캐스트를 막으면 안 된다.
            logger.debug("push notify failed (%s): %s", session_id, e)
        try:
            # 텔레그램은 **버튼이 붙는** 알림을 맡는다. 웹푸시 액션 버튼은 iOS 에서
            # 렌더되지 않아 아이폰에선 "계속"이 아예 안 보인다.
            await notify_agent_done(
                session_id, change.get("command", ""), change.get("title", ""), label,
                duration_seconds=elapsed, excerpt=excerpt,
                described={**described, "cwd": shorten_path(described.get("cwd", ""))},
                others=summarize_others(agent_status_watcher.snapshot(), session_id),
            )
        except Exception as e:
            logger.debug("telegram notify failed (%s): %s", session_id, e)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})
    agent_status_events.wake()      # 기다리는 쪽(terminal_wait)을 깨운다
    await _notify_completions(changes)


# ---------------------- 원격(리모트가 밀어 주는 상태) ----------------------

async def _remote_owner(change: dict) -> str | None:
    """리모트 연결이 소유자를 안다 — 세션 표를 뒤질 필요가 없다."""
    from remote_agent import registry
    connection = registry.get(change.get("hostId"))
    return connection.username if connection else None


async def _remote_excerpt(change: dict) -> str:
    """화면 발췌를 **그 소켓으로** 물어본다. SSH 왕복이 없다.

    못 물어보면 빈 문자열이다 — 알림은 발췌 없이라도 나가야 한다. 발췌는 "지금 봐야
    하나" 를 돕는 정보지 알림의 조건이 아니다.
    """
    from remote_agent import registry
    connection = registry.get(change.get("hostId"))
    if connection is None:
        return ""
    session_id = change.get("sessionId")
    reply = await connection.request(
        {"t": "excerpt", "session": session_id},
        key=f"excerpt:{session_id}",
        timeout=REMOTE_EXCERPT_TIMEOUT_SEC,
    )
    return extract_excerpt((reply or {}).get("text") or "")


async def _on_remote_status_change(host_id: str, changes: list[dict]) -> None:
    """리모트가 밀어 준 전이 — 로컬과 **같은 알림 경로**를 탄다.

    ⚠️ SSE 로는 안 보낸다. 프론트의 상태 스토어는 원격 pane 을 **pane id** 로 키잉하는데
    백엔드는 그 값을 모른다. 그리고 pane 을 보고 있을 때는 xterm 이 이미 타이틀을 읽어
    채우므로 여기서 보태도 얻을 게 없다. 구멍은 **안 보고 있을 때의 알림**이고 그건
    아래 한 줄이 메운다.
    """
    await _notify_completions(changes, resolve_owner=_remote_owner, capture=_remote_excerpt)


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    # 보고 있는 클라이언트가 있으면 폴링을 조인다. 없어도 멈추지는 않는다 — 아무도
    # 안 보고 있을 때야말로 알림이 필요한 순간이다.
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)


# 리모트가 상태를 밀어 주면 위 경로로 흘려보낸다. ingest 가 서비스를 import 하면
# 순환이 되므로 **배선은 이쪽에서** 꽂는다.
from remote_agent import ingest as _remote_ingest  # noqa: E402

_remote_ingest.set_change_handler(_on_remote_status_change)
