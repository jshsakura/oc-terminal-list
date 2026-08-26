"""리모트가 올려보낸 상태를 이 서버의 에이전트 상태 파이프라인에 합류시킨다.

아직 배선 전이다 — 지금은 마지막으로 본 것을 들고만 있는다. 이 자리가 따로 있는 이유는
`routes/remote_ws.py` 가 상태 판정을 **모르게** 하기 위해서다. 라우트가 파서를 알면
판정이 또 한 벌 생긴다(이 저장소가 세 번 겪은 사고).
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# host_id -> {"lines": [...], "server": bool|None}
_last: dict[str, dict] = {}


async def handle_event(host_id: str, kind: str, message: dict) -> None:
    state = _last.setdefault(host_id, {"lines": [], "server": None})
    if kind == "server":
        state["server"] = True
    elif kind == "no-server":
        # ⚠️ "tmux 서버가 없다" 는 "pane 0개" 가 아니다. 0개로 접으면 있지도 않은
        # 완료 알림이 나간다.
        state["server"] = False
        state["lines"] = []
    elif kind == "panes":
        state["lines"] = list(message.get("lines") or [])


def snapshot(host_id: str) -> dict:
    return dict(_last.get(host_id) or {"lines": [], "server": None})


def forget(host_id: str) -> None:
    _last.pop(host_id, None)
