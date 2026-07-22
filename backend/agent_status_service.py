"""에이전트 상태 워처 싱글턴 — tmux 폴링을 SSE 브로드캐스트와 웹 푸시에 연결한다.

수집기(agent_status_watcher.AgentStatusWatcher)와 전달 경로(sse_broadcast, push_service)를
엮는 배선만 담당한다. main 은 lifespan 에서 start/stop 만 부르고, 라우트는 snapshot()
만 읽는다 — 그래야 main 전역을 역참조하지 않는다.
"""
from __future__ import annotations

import logging
import time

from agent_status_watcher import AgentStatusWatcher, PANE_FORMAT
from push_service import build_agent_done_payload, send_to_user
from notify_message import summarize_others
from session_label import describe_session, format_label
from telegram_service import notify_agent_done
from sqlite_storage import storage
from sse_broadcast import _broadcast_sse, _tab_state_sse_queues
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# 같은 세션에 이 시간 안에는 완료 알림을 두 번 보내지 않는다.
# 에이전트 타이틀이 짧게 흔들리면 working↔idle 이 연달아 잡힐 수 있는데,
# 그때마다 폰이 울리면 알림을 꺼버리게 된다.
DONE_NOTIFY_COOLDOWN_SECONDS = 60

_last_notified_at: dict[str, float] = {}
# 세션이 working 으로 들어간 시각 — 완료 알림의 "얼마나 걸렸나" 는 여기서 나온다.
# 워처가 이미 전이를 보고 있으므로 추가 비용이 없다.
_working_since: dict[str, float] = {}


def _should_notify(session_id: str, now: float) -> bool:
    last = _last_notified_at.get(session_id, 0.0)
    if now - last < DONE_NOTIFY_COOLDOWN_SECONDS:
        return False
    _last_notified_at[session_id] = now
    return True


def _forget_session(session_id: str) -> None:
    _last_notified_at.pop(session_id, None)
    _working_since.pop(session_id, None)


def _track_working(change: dict, now: float) -> float | None:
    """working 진입을 기록하고, 끝났으면 소요시간을 돌려준다."""
    session_id = change.get("sessionId")
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


async def _notify_completions(changes: list[dict]) -> None:
    """working → 그 외 전이를 기기로 밀어준다.

    구독이 있다는 것 자체가 사용자의 명시적 동의다(브라우저 권한 + 구독 등록).
    별도 설정 토글을 두지 않는 이유 — 끄고 싶으면 구독을 해제하면 된다.
    """
    now = time.time()
    for change in changes:
        session_id = change.get("sessionId")
        if not session_id:
            continue
        if change.get("gone"):
            _forget_session(session_id)
            continue
        # 완료가 아니어도 working 진입은 기록해 둬야 나중에 소요시간을 낼 수 있다.
        elapsed = _track_working(change, now)
        if not change.get("completed"):
            continue
        if not _should_notify(session_id, now):
            continue
        owner = None
        try:
            owner = await storage.get_session_owner(session_id)
        except Exception as e:
            logger.debug("session owner lookup failed (%s): %s", session_id, e)
        if not owner:
            continue   # 원격 pane 등 우리가 소유자를 모르는 세션

        # "작업 완료" 만으로는 어느 터미널인지 알 수 없다 — 주소(탭.pane)를 붙인다.
        described = await describe_session(owner, session_id)
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
                duration_seconds=elapsed,
                described=described,
                others=summarize_others(agent_status_watcher.snapshot(), session_id),
            )
        except Exception as e:
            logger.debug("telegram notify failed (%s): %s", session_id, e)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})
    await _notify_completions(changes)


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    # 보고 있는 클라이언트가 있으면 폴링을 조인다. 없어도 멈추지는 않는다 — 아무도
    # 안 보고 있을 때야말로 알림이 필요한 순간이다.
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)
