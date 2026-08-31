"""저장된 탭 상태 → 주소가 붙은 터미널 목록.

주소는 사람이 말하는 번호(`탭.pane`)다. 화면의 pane 배지(PaneAddressLabel)·tmux 하단
상태바(pane_addr)·실행 중 보드가 모두 이 한 규칙을 쓴다 — 세 곳이 각자 세면 "2번" 이
가리키는 것이 화면마다 달라진다.

⚠️ **번호는 밀린다.** pane 을 닫으면 뒤가 당겨진다. 그래서 이것은 저장하는 값이 아니라
매번 다시 세는 값이다.
"""
from __future__ import annotations


def build_targets(tabs: list, status_map: dict | None = None) -> list[dict]:
    """저장된 탭 상태 + 에이전트 상태 스냅샷 → 주소가 붙은 터미널 목록.

    로컬 pane 은 `sessionId` 로, 원격 pane 은 `hostId` + `tmuxSession` 으로 식별된다.
    """
    status_map = status_map or {}
    targets: list[dict] = []
    for tab_index, tab in enumerate(tabs or [], start=1):
        if not isinstance(tab, dict):
            continue
        panes = [p for p in (tab.get("panes") or []) if isinstance(p, dict)]
        active_pane_id = tab.get("activePaneId")
        for pane_index, pane in enumerate(panes, start=1):
            session_id = pane.get("sessionId")
            host_id = pane.get("hostId")
            tmux_session = pane.get("tmuxSessionName")
            if not session_id and not (host_id and tmux_session):
                continue          # 빈 picker pane — 보낼 곳이 없다
            key = session_id or tmux_session
            state = status_map.get(key) or {}
            targets.append({
                # 원격 pane 의 상태는 **모르는 것이 기본**이다. 백엔드 워처는 그 호스트의
                # tmux 를 볼 수 없다(CLAUDE.md 상태감지 절). 빈 상태를 "유휴" 로 읽으면
                # 기다림이 0 초에 거짓 완료로 끝난다 — 그래서 모른다고 적어 둔다.
                # 실행 중 보드는 호스트 스냅샷을 받아 이 값을 내린다(routes/fleet.apply_snapshot).
                "statusUnknown": not session_id and not state,
                "addr": f"{tab_index}.{pane_index}",
                "tabIndex": tab_index,
                "paneIndex": pane_index,
                "tabName": tab.get("name") or "",
                "paneId": pane.get("id"),
                "isActivePane": pane.get("id") == active_pane_id,
                "kind": "host" if host_id else "local",
                "sessionId": session_id,
                "hostId": host_id,
                "tmuxSession": tmux_session,
                "cwd": pane.get("cwd") or tab.get("cwd") or "",
                "command": state.get("command") or "",
                "status": state.get("status"),
                "title": state.get("title") or "",
            })
    return targets
