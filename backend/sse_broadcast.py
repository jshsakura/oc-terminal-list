"""tab-state SSE 브로드캐스트 — 연결된 EventSource 클라이언트 큐 레지스트리.

한 스트림에 여러 종류의 이벤트가 흐른다(tab-state 버전, 에이전트 상태).
⚠️ 클라이언트는 디바이스당 EventSource 를 **하나만** 연다 — 두 번째 연결을 열면
재연결 폭주가 재발한다(frontend/src/hooks/useWorkspaceTabs.js 의 CRITICAL 주석).
"""
from __future__ import annotations

import asyncio


# ---------------------- tab-state SSE 브로드캐스트 ----------------------
# username → 연결 중인 EventSource 클라이언트 큐 목록

_tab_state_sse_queues: dict[str, list[asyncio.Queue]] = {}


def _notify_tab_state_change(username: str, updated_at: str) -> None:
    """PUT /api/tab-state 저장 후 호출 — 모든 SSE 클라이언트에 버전 전파."""
    _broadcast_sse({"updatedAt": updated_at}, username=username)


def _broadcast_sse(payload: dict, username: str | None = None) -> None:
    """SSE 페이로드를 클라이언트 큐에 넣는다. username 이 None 이면 전체.

    같은 스트림에 여러 종류의 이벤트가 흐른다. 구 클라이언트는 `updatedAt` 만 읽고
    없으면 조용히 무시하므로, 새 타입을 얹어도 하위호환이 깨지지 않는다.
    """
    targets = (
        [_tab_state_sse_queues.get(username, [])] if username
        else list(_tab_state_sse_queues.values())
    )
    for queues in targets:
        for q in list(queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # 큐가 밀렸다는 건 그 클라이언트가 못 따라온다는 뜻 — 버린다.
                # 상태는 재연결 시 /api/agent-status 로 다시 하이드레이션된다.
                pass

