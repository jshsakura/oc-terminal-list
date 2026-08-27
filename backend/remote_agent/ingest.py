"""리모트가 올려보낸 pane 상태를 이 서버의 에이전트 상태 파이프라인에 합류시킨다.

**폴링이 없다.** 리모트가 변화를 밀어 주므로 여기는 그것을 받아 전이를 계산하고 알린다.
예전 원격 경로는 물어볼 때마다 SSH 왕복이었고 `terminal_wait` 는 5초마다 그걸 했다 —
이 저장소가 토큰을 크게 태운 그 패턴이다.

호스트마다 `AgentStatusWatcher` 를 하나씩 두되 **루프는 돌리지 않는다.** 그 클래스의
`_diff` 가 이미 전이 계산·스피너 접기·사라진 pane 처리를 다 갖고 있어서, 판정을 두 번째로
구현하지 않는다(이 저장소가 파서 이중화로 세 번 데었다).

⚠️ **원격 pane 의 sessionId 는 그 호스트의 tmux 세션명이다.** 호스트가 다르면 겹치므로
상태는 호스트별 워처에 갇혀 있어야 하고, 밖으로 내보내는 변경에는 `hostId` 를 붙인다.
"""
from __future__ import annotations

import logging

import agent_status_events
from agent_status_watcher import AgentStatusWatcher, parse_pane_lines

logger = logging.getLogger(__name__)

# host_id -> AgentStatusWatcher (루프 없이 _diff 만 쓴다)
_watchers: dict[str, AgentStatusWatcher] = {}
# host_id -> {"server": bool|None}
_server_state: dict[str, dict] = {}
_on_changes = None      # async (host_id, changes) -> None  (배선은 서비스가 넣는다)


def set_change_handler(handler) -> None:
    """전이가 생겼을 때 부를 곳. 배선을 여기서 import 하지 않는 이유는 순환 때문이다."""
    global _on_changes
    _on_changes = handler


def _watcher(host_id: str) -> AgentStatusWatcher:
    watcher = _watchers.get(host_id)
    if watcher is None:
        watcher = AgentStatusWatcher()
        _watchers[host_id] = watcher
    return watcher


async def handle_event(host_id: str, kind: str, message: dict) -> None:
    state = _server_state.setdefault(host_id, {"server": None})
    if kind == "server":
        state["server"] = True
        return
    if kind == "no-server":
        # ⚠️ "tmux 서버가 없다" 는 "pane 0개" 가 아니다. 0개로 접으면 **있지도 않은 완료
        # 알림**이 나간다(사라진 pane 은 전이로 계산되므로). 상태만 적고 비우지 않는다.
        state["server"] = False
        return
    if kind != "panes":
        return

    lines = message.get("lines") or []
    # probe 는 변화가 있을 때 **현재 목록 전체**를 보낸다 — 그래서 diff 가 성립한다.
    # 판정을 두 벌로 두지 않으려고 워처의 diff 를 그대로 쓴다.
    panes = parse_pane_lines("\n".join(lines))
    changes = _watcher(host_id)._diff(panes)
    if not changes:
        return

    tagged = [{**change, "hostId": host_id} for change in changes]
    agent_status_events.wake()
    if _on_changes is not None:
        try:
            await _on_changes(host_id, tagged)
        except Exception as e:
            # 알림이 실패해도 상태 수신은 계속되어야 한다.
            logger.debug("remote status handler failed (%s): %s", host_id, e)


def snapshot(host_id: str) -> dict[str, dict]:
    """그 호스트의 sessionId → {status, title, command}. 리모트가 없으면 빈 dict."""
    watcher = _watchers.get(host_id)
    return watcher.snapshot() if watcher else {}


def has_live_state(host_id: str) -> bool:
    """리모트가 상태를 밀어 주고 있는가 — 그렇다면 SSH 로 물어볼 이유가 없다."""
    return host_id in _watchers and _server_state.get(host_id, {}).get("server") is not False


def forget(host_id: str) -> None:
    _watchers.pop(host_id, None)
    _server_state.pop(host_id, None)
