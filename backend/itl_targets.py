"""터미널 주소 해소 — "3번 터미널", "1번 탭 3번" 을 실제 세션으로 옮긴다.

주소 체계의 원칙 하나: **번호는 사람이 부르는 이름이고, 신원은 세션 ID 다.**
pane 을 하나 닫으면 뒤 번호가 앞으로 밀린다. 그래서 번호는 호출 시점에 즉시
세션으로 해소하고, 그 뒤의 라우팅(우편함 답장 등)은 세션 ID 로만 한다.
번호를 들고 있다가 나중에 쓰면 엉뚱한 터미널로 간다.

자연어("3번 터미널로 보내")는 여기서 다루지 않는다 — 그건 pane 안에 있는 에이전트가
이미 하는 일이고, 우리는 그 에이전트가 첫 시도에 맞출 만큼 뻔한 어휘만 제공한다.
"""
from __future__ import annotations

import re

# 그룹 주소 — 상태/명령으로 여러 pane 을 한 번에 가리킨다.
GROUP_ALL = "all"
STATUS_GROUPS = {"working", "idle", "permission"}


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


def _tab_of(targets: list[dict], session_key: str | None) -> int | None:
    """어떤 세션이 속한 탭 번호. `itl send 3` 처럼 탭을 생략한 주소의 기준점."""
    if not session_key:
        return None
    for t in targets:
        if session_key in (t["sessionId"], t["tmuxSession"]):
            return t["tabIndex"]
    return None


def _pick_tab(targets: list[dict], tab_index: int, pane_index: int | None) -> list[dict]:
    in_tab = [t for t in targets if t["tabIndex"] == tab_index]
    if pane_index is None:
        return in_tab
    return [t for t in in_tab if t["paneIndex"] == pane_index]


def _by_name(targets: list[dict], name: str, pane_index: int | None) -> list[dict]:
    lowered = name.strip().lower()
    in_tab = [t for t in targets if t["tabName"].strip().lower() == lowered]
    if not in_tab:
        return []
    if pane_index is not None:
        return [t for t in in_tab if t["paneIndex"] == pane_index]
    # 탭 이름만 주면 그 탭의 활성 pane — 없으면 첫 번째.
    active = [t for t in in_tab if t["isActivePane"]]
    return active or in_tab[:1]


def resolve(targets: list[dict], expr: str, from_session: str | None = None) -> list[dict]:
    """주소 문자열 → 대상 목록. 못 찾으면 빈 목록.

    받는 형태:
      `3`          현재 탭(from_session 이 속한 탭)의 3번
      `1.3` `1:3`  1번 탭의 3번
      `@이름`       그 탭의 활성 pane
      `@이름.2`     그 탭의 2번
      `@all`       전부
      `@working` `@idle` `@permission`   상태로
      `@claude` `@codex` …               돌고 있는 명령으로
    """
    if not expr:
        return []
    raw = expr.strip()

    if raw.startswith("@"):
        body = raw[1:]
        group, _, pane_part = body.partition(".")
        pane_index = int(pane_part) if pane_part.isdigit() else None
        key = group.strip().lower()
        # 규칙 하나: **사용자가 지은 탭 이름이 항상 내장 예약어를 이긴다.** 예외 없음.
        # 탭을 "working" 이라 이름 붙였는데 @working 이 딴 데로 가면 그게 함정이다.
        named = _by_name(targets, group, pane_index)
        if named:
            return named
        if key == GROUP_ALL:
            return list(targets)
        if key in STATUS_GROUPS:
            return [t for t in targets if t["status"] == key]
        # 남은 건 돌고 있는 명령 (@claude, @node …)
        return [t for t in targets if t["command"].lower() == key]

    match = re.fullmatch(r"(\d+)\s*[.:]\s*(\d+)", raw)
    if match:
        return _pick_tab(targets, int(match.group(1)), int(match.group(2)))

    if raw.isdigit():
        tab_index = _tab_of(targets, from_session)
        if tab_index is None:
            # 기준 탭을 모르면 전역 번호로 해석하지 않는다 — 조용히 엉뚱한 곳으로
            # 보내느니 못 찾았다고 하는 편이 낫다.
            return []
        return _pick_tab(targets, tab_index, int(raw))

    return []


def format_table(targets: list[dict], from_session: str | None = None) -> str:
    """`itl list` 출력. 이 표 자체가 주소 체계의 사용설명서다."""
    if not targets:
        return "열려 있는 터미널이 없습니다."
    rows = [("", "ADDR", "TAB", "HOST", "CMD", "STATE", "TITLE")]
    for t in targets:
        here = ">" if from_session and from_session in (t["sessionId"], t["tmuxSession"]) else ""
        rows.append((
            here, t["addr"], t["tabName"][:18],
            (t["hostId"] or "local")[:8], t["command"][:10],
            t["status"] or "-", (t["title"] or "")[:34],
        ))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    return "\n".join("  ".join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip() for r in rows)
