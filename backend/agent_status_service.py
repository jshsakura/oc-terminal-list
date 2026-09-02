"""에이전트 상태 워처 싱글턴 — tmux 폴링을 SSE 브로드캐스트에 연결한다.

수집기(agent_status_watcher.AgentStatusWatcher)와 전달 경로(sse_broadcast)를 엮는 배선만
담당한다. main 은 lifespan 에서 start/stop 만 부르고, 라우트는 snapshot() 만 읽는다 —
그래야 main 전역을 역참조하지 않는다.

상태는 **탭 배지와 pane 의 바쁨 표시**로 쓴다. 이 상태를 기기 알림(텔레그램·웹푸시)으로
내보내던 층은 걷어냈다 — 화면에 그리는 것과 밖으로 보내는 것은 다른 일이고, 지금 이
앱이 하는 것은 앞쪽뿐이다.

⚠️ 원격 pane 의 상태는 **여기서 채우지 않는다.** 백엔드 폴링은 이 기계의 tmux 만 본다.
원격은 브라우저가 붙어 있는 동안 xterm 의 타이틀 피드로 들어오고, 안 붙어 있으면 모른다 —
그리고 **모르는 것은 모른다고 남긴다.** 빈 상태를 "유휴" 로 읽는 것이 이 저장소가 이미
값을 치른 실수다.
"""
from __future__ import annotations

import logging

import agent_status_events
from agent_status_watcher import AgentStatusWatcher, PANE_FORMAT
from itl_channel import OUTBOX_OPTION, parse_sentinel
from sse_broadcast import _broadcast_sse, _tab_state_sse_queues
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)


async def _list_agent_panes() -> str:
    return await tmux_manager.list_panes_raw(PANE_FORMAT)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})
    agent_status_events.wake()      # 기다리는 쪽을 깨운다


#: 우편함 한 통의 상한. `cli/itl` 의 MAX_TEXT_BYTES 보다 넉넉하게(JSON 봉투 몫).
MAX_OUTBOX_CHARS = 12000


async def _on_agent_outbox(pending: list[tuple[str, str]]) -> None:
    """붙어 있지 않은 팬이 남긴 전달 요청을 처리한다.

    **왜 이 통로가 따로 있나:** 표식(PTY) 통로는 브라우저가 그 팬에 붙어 있는 동안에만
    읽힌다 — 읽는 주체가 그 WS 브리지이기 때문이다. 배경에서 도는 에이전트는 대개 안
    붙어 있고, 그때 표식은 **조용히 사라진다**(실제로 그 신고에서 출발했다).
    tmux 사용자 옵션은 붙어 있든 아니든 남아 있고, 이 폴링이 이미 1.5초마다 도므로
    **왕복이 새로 생기지 않는다**(포맷 칸 하나).

    🔐 표식보다 오히려 **더** 믿을 만하다: 화면에 찍히는 것은 그 팬을 지나가는 어떤
    출력이든 할 수 있지만, tmux 옵션을 세우려면 그 소켓에 닿을 수 있어야 한다(같은 OS
    사용자). 그래서 여기서는 열쇠를 요구하지 않는다.

    ⚠️ **먼저 비우고 배달한다.** 배달이 느리면 다음 틱이 같은 통을 또 집는다.
    """
    from itl_router import deliver_from_pane
    from sqlite_storage import storage

    for session_id, payload in pending:
        try:
            await tmux_manager._run("set-option", "-u", "-t", session_id,
                                    OUTBOX_OPTION, check=False)
        except Exception as e:                       # noqa: BLE001
            logger.warning("itl 우편함을 비우지 못했다 (%s): %s — 배달을 건너뛴다", session_id, e)
            continue                                 # 못 비웠으면 무한 재배달이 된다
        if len(payload) > MAX_OUTBOX_CHARS:
            logger.warning("itl 우편함이 너무 길다 (%s): %d자", session_id, len(payload))
            continue
        msg = parse_sentinel(payload)
        if not msg:
            logger.info("itl 우편함의 모양이 아니다 (%s)", session_id)
            continue
        # 보낸 이는 **세션에서 되짚는다** — 페이로드의 자칭을 믿으면 사칭이 공짜다.
        owner = None
        try:
            owner = await storage.get_session_owner(session_id)
        except Exception:                            # noqa: BLE001
            pass
        if not owner:
            logger.info("itl 우편함: 세션 주인을 모른다 (%s)", session_id)
            continue
        await deliver_from_pane(owner, session_id, msg)


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    # 보고 있는 클라이언트가 있으면 폴링을 조인다. 없어도 멈추지는 않는다 — 배지는
    # 탭을 다시 열었을 때 이미 맞아 있어야 한다.
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
    on_outbox=_on_agent_outbox,
)
