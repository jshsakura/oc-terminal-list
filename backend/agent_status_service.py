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
from sse_broadcast import _broadcast_sse, _tab_state_sse_queues
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)


async def _list_agent_panes() -> str:
    return await tmux_manager.list_panes_raw(PANE_FORMAT)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})
    agent_status_events.wake()      # 기다리는 쪽을 깨운다


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    # 보고 있는 클라이언트가 있으면 폴링을 조인다. 없어도 멈추지는 않는다 — 배지는
    # 탭을 다시 열었을 때 이미 맞아 있어야 한다.
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)
