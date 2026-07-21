"""에이전트 상태 워처 싱글턴 — tmux 폴링을 SSE 브로드캐스트에 연결한다.

수집기(agent_status_watcher.AgentStatusWatcher)와 전달 경로(sse_broadcast)를 엮는
배선만 담당한다. main 은 lifespan 에서 start/stop 만 부르고, 라우트는 snapshot()
만 읽는다 — 그래야 main 전역을 역참조하지 않는다.
"""
from __future__ import annotations

from agent_status_watcher import AgentStatusWatcher, PANE_FORMAT
from sse_broadcast import _broadcast_sse, _tab_state_sse_queues
from tmux_manager import tmux_manager


async def _list_agent_panes() -> str:
    return await tmux_manager.list_panes_raw(PANE_FORMAT)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    # 보고 있는 클라이언트가 있으면 폴링을 조인다. 없어도 멈추지는 않는다(알림 때문에).
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)
