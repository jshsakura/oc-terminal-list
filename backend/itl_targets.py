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
# Caller-anchored groups — only meaningful with a from_session anchor.
CALLER_GROUPS = {"here", "siblings"}

# INT tokens (tab/pane indices). @WORD is detected by '@' prefix only —
# tab names are user strings, never regex-validated (spec §4.6 principle).
_INT_RE = re.compile(r"^\d+$")


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
                # routes/itl.py `_fill_remote_status` 가 실제로 물어보면 이 값을 내린다.
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


def _tab_of(targets: list[dict], session_key: str | None) -> int | None:
    """어떤 세션이 속한 탭 번호. `itl send 3` 처럼 탭을 생략한 주소의 기준점."""
    if not session_key:
        return None
    for t in targets:
        if session_key in (t["sessionId"], t["tmuxSession"]):
            return t["tabIndex"]
    return None


def _by_name(targets: list[dict], name: str) -> list[dict]:
    """Case-insensitive tab-name lookup → active pane (or first if none active)."""
    lowered = name.strip().lower()
    in_tab = [t for t in targets if t["tabName"].strip().lower() == lowered]
    if not in_tab:
        return []
    active = [t for t in in_tab if t["isActivePane"]]
    return active or in_tab[:1]


def _split_addr(raw: str) -> tuple[str, str | None, str | None]:
    """Split a raw address at the LAST '.' or ':' separator.

    The tail must be an INT or start with '@' to qualify as a panesel;
    otherwise the whole string is the tab_part. Tab names may themselves
    contain separators (e.g. 'api.v2'), so the cut happens at the LAST
    separator and a non-qualifying tail means the whole thing is a tab
    name. Head and tail are stripped so tolerant forms like '1 . 3' parse.
    """
    pos = max(raw.rfind("."), raw.rfind(":"))
    if pos < 0:
        return raw.strip(), None, None
    head = raw[:pos].strip()
    tail = raw[pos + 1:].strip()
    if not head or not (_INT_RE.match(tail) or tail.startswith("@")):
        return raw.strip(), None, None
    return head, raw[pos], tail


def _bare_pane(targets: list[dict], pane_num: int, from_session: str | None) -> list[dict]:
    """Bare `N` → pane N of the caller's tab. Empty when there is no anchor.

    Without a known caller tab we refuse rather than reinterpret `N` as a
    global number — better to miss than to silently hit the wrong terminal.
    """
    idx = _tab_of(targets, from_session)
    if idx is None:
        return []
    return [t for t in targets if t["tabIndex"] == idx and t["paneIndex"] == pane_num]


def _filter_by_word(targets: list[dict], word: str, from_session: str | None) -> list[dict]:
    """Filter a target list by a @WORD selector (panesel scope).

    Order per spec §4.3: reserved groups first, then running command. Tab
    names are NOT consulted here — that is tabsel scope, not panesel.
    """
    key = word.strip().lower()
    if key == GROUP_ALL:
        return list(targets)
    if key in CALLER_GROUPS:
        idx = _tab_of(targets, from_session)
        if idx is None:
            return []
        scoped = [t for t in targets if t["tabIndex"] == idx]
        if key == "siblings":
            scoped = [t for t in scoped
                      if from_session not in (t["sessionId"], t["tmuxSession"])]
        return scoped
    if key in STATUS_GROUPS:
        return [t for t in targets if t["status"] == key]
    # Anything else is treated as a running command (@claude, @node, ...).
    return [t for t in targets if t["command"].strip().lower() == key]


def _select_tab(targets: list[dict], sel: str, from_session: str | None) -> list[dict]:
    """Resolve the tab selector (left of SEP) to a tab-scoped target list.

    sel is INT (tab number) or @WORD. @WORD here is tab-name only — status
    groups are NOT consulted in tabsel position (spec §4.3). The caller-
    anchored words @here/@siblings refer to the caller's whole tab.
    """
    if _INT_RE.match(sel):
        idx = int(sel)
        return [t for t in targets if t["tabIndex"] == idx]
    if not sel.startswith("@"):
        return []
    name = sel[1:].strip()
    if not name:
        return []
    lowered = name.lower()
    # User-given tab name ALWAYS wins — every pane of that tab, no exceptions.
    named = [t for t in targets if t["tabName"].strip().lower() == lowered]
    if named:
        return named
    if lowered in CALLER_GROUPS:
        idx = _tab_of(targets, from_session)
        if idx is None:
            return []
        return [t for t in targets if t["tabIndex"] == idx]
    # Status groups, @all, and commands are not valid tabsels — empty.
    return []


def _select_pane(scoped: list[dict], sel: str, from_session: str | None) -> list[dict]:
    """Pick panes from an already tab-scoped list.

    sel is INT (pane index within the scoped tab) or @WORD (filter). Any
    other shape is treated as no match.
    """
    if _INT_RE.match(sel):
        n = int(sel)
        return [t for t in scoped if t["paneIndex"] == n]
    if sel.startswith("@"):
        return _filter_by_word(scoped, sel[1:], from_session)
    return []


def _by_identity(targets: list[dict], raw: str) -> list[dict]:
    """Exact `sessionId` / `tmuxSession` match — the address that never moves.

    Numbers are what humans say, ids are identity (see the module docstring), so a
    handle meant to survive being copied elsewhere carries the id. This is checked
    **before** the address is split, because a remote session is free to be named
    `mobile.2` — splitting first would read that as "tab mobile, pane 2".
    """
    key = raw.strip()
    if not key:
        return []
    return [t for t in targets if key in (t["sessionId"], t["tmuxSession"])]


def resolve(targets: list[dict], expr: str | None, from_session: str | None = None) -> list[dict]:
    """Address string → target list. Returns empty list when nothing matches.

    Accepted shapes (spec §4.1):
      `<session-id>`     that exact terminal, wherever it moved to
      `3`                pane N of the caller's tab (needs from_session)
      `1.3` `1:3`        tab 1, pane 3
      `@name`            named tab → its active pane
      `@name.2`          named tab → pane 2
      `@all`             every target
      `@working` `@idle` `@permission`   status groups (global)
      `@here` `@siblings`                caller's tab panes (needs from_session)
      `@claude` `@codex` …               running-command group (global)
      `2.@claude`        tab 2, panes running claude
      `@here.@claude`    caller's tab, panes running claude
    """
    if not expr:
        return []
    raw = expr.strip()

    # Identity first — before any splitting, so a session literally named `mobile.2`
    # is not read as "tab mobile, pane 2".
    by_id = _by_identity(targets, raw)
    if by_id:
        return by_id

    tab_part, sep, pane_part = _split_addr(raw)

    if sep is None:
        # Single-token form: bare INT, or @NAME (tab-name priority), or @WORD.
        if _INT_RE.match(tab_part):
            return _bare_pane(targets, int(tab_part), from_session)
        if not tab_part.startswith("@"):
            return []
        word = tab_part[1:].strip()
        if not word:
            return []
        # User-given tab name wins over every reserved word — no exceptions.
        named = _by_name(targets, word)
        if named:
            return named
        return _filter_by_word(targets, word, from_session)

    # Two-token form: tabsel SEP panesel. sep is non-None here, so pane_part
    # is also non-None — guard once for the type checker and for safety.
    if pane_part is None:
        return []
    scoped = _select_tab(targets, tab_part, from_session)
    if not scoped:
        return []
    return _select_pane(scoped, pane_part, from_session)


def filter_targets(
    targets: list[dict],
    *,
    scope: str = "all",
    from_session: str | None = None,
    status: str | None = None,
    command: str | None = None,
    exclude_self: bool = False,
) -> list[dict]:
    """Pure filter for the GET /api/itl/targets listing.

    Applies scope (all|same_tab), self-exclusion, status group, and command
    filters in order so the route handler stays thin. `same_tab` without
    from_session yields an empty list — the route is responsible for raising
    422 in that case. `exclude_self` drops targets matching from_session by
    sessionId or tmuxSession.
    """
    if scope == "same_tab":
        idx = _tab_of(targets, from_session)
        if idx is None:
            return []
        targets = [t for t in targets if t["tabIndex"] == idx]
    if exclude_self and from_session:
        targets = [t for t in targets
                   if from_session not in (t["sessionId"], t["tmuxSession"])]
    if status:
        targets = [t for t in targets if t["status"] == status]
    if command:
        cmd = command.strip().lower()
        targets = [t for t in targets if t["command"].strip().lower() == cmd]
    return list(targets)


def _state_cell(target: dict) -> str:
    """STATE 칸. `?` 는 **물어보지 못했다**는 뜻이고 `-` 는 일하고 있지 않다는 뜻이다.

    원격 pane 은 백엔드 워처가 볼 수 없어 기본적으로 상태가 비어 있다. 그 빈칸을 `-`
    로 적으면 "확인했고 유휴다" 로 읽혀 기다림·판단이 거짓 위에 선다.
    """
    if target.get("statusUnknown"):
        return "?"
    return target.get("status") or "-"


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
            _state_cell(t), (t["title"] or "")[:34],
        ))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    return "\n".join("  ".join(c.ljust(widths[i]) for i, c in enumerate(r)).rstrip() for r in rows)
