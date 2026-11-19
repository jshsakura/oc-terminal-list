"""`itl open`: a pane asks the app to open a new worker tab and start an agent in it.

This is how Terminator (the Terminal List companion) hands work to a teammate session
without the person touching tabs, branches or commands. The request rides the same tmux
outbox as `itl send` (`{"op": "open", ...}`), so the asking pane does not need a browser
attached. The backend still calls no LLM: it creates a tmux session, adds a tab, types one
launch line, and reports back.

What runs is a whitelist, never the payload: `tool` picks one entry of LAUNCH, `branch`
must look like a branch name, `cwd` must sit inside the workspace. The prompt is written to
a file and handed to the agent as its first argument (`claude "$(cat file)"`), so nothing
has to be typed into the agent after it starts. Typing into a TUI that is still booting
eats the first characters, and Claude's folder-trust dialog would swallow an Enter.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
import time
import uuid
from pathlib import Path

from pane_targets import build_targets
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

#: tool name -> argv that starts it with no approval prompts. The prompt file is appended.
LAUNCH: dict[str, list[str]] = {
    "claude": ["claude"],
    "codex": ["codex", "--yolo"],
    "opencode": ["opencode", "--prompt"],
}
SHELLS = frozenset({"bash", "zsh", "sh", "dash", "fish"})
BRANCH_RE = re.compile(r"^(?![-/.])(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]{1,80}(?<![/.])$")
PROTECTED_BRANCHES = frozenset({"main", "master", "HEAD"})
MAX_PROMPT_CHARS = 8000  # the outbox holds 12000 chars including the JSON around it
MAX_NAME_CHARS = 40
#: Opens per user within RATE_WINDOW_SEC. Two agents bouncing work could otherwise open
#: tabs every poll forever.
RATE_MAX_OPENS = 6
RATE_WINDOW_SEC = 60.0
SHELL_READY_TIMEOUT_SEC = 6.0
AGENT_START_TIMEOUT_SEC = 25.0
SAVE_RETRIES = 4
_opens: dict[str, list[float]] = {}


class OpenFailed(Exception):  # noqa: N818 - same naming as itl_router.DeliveryFailed
    """A refused or failed open. The message is shown to the asking agent as is."""


def prompt_dir() -> Path:
    return Path(os.path.expanduser("~/.cache/terminator"))


def parse_open(data: dict) -> dict:
    """Outbox JSON -> validated spec. Raises OpenFailed with a reason the agent can act on."""
    tool = data.get("tool")
    if tool not in LAUNCH:
        raise OpenFailed(f"tool 은 {', '.join(LAUNCH)} 중 하나여야 한다")
    branch = (data.get("branch") or "").strip()
    if branch and (not BRANCH_RE.match(branch) or branch in PROTECTED_BRANCHES):
        raise OpenFailed("branch 는 main/master 가 아닌 브랜치 이름이어야 한다 (예: fix/login-button)")
    prompt = data.get("prompt") or ""
    if not isinstance(prompt, str) or not prompt.strip():
        raise OpenFailed("prompt(첫 지시문)가 비어 있다")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise OpenFailed(f"prompt 가 너무 길다 (>{MAX_PROMPT_CHARS}자)")
    name = data.get("name") if isinstance(data.get("name"), str) else ""
    name = re.sub(r"[\x00-\x1f\x7f]", " ", name).strip()[:MAX_NAME_CHARS]
    cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else ""
    return {"tool": tool, "branch": branch, "prompt": prompt, "name": name or tool, "cwd": cwd.strip()}


def resolve_cwd(cwd: str) -> tuple[Path, str]:
    """Workspace-relative or absolute-inside-workspace -> (absolute dir, relative form).

    Local pane cwd is stored workspace-relative; an absolute value there lands somewhere wrong.
    """
    from fastapi import HTTPException

    from _deps import WORKSPACE_ROOT, validate_path

    workspace = Path(WORKSPACE_ROOT).resolve()
    raw = cwd
    if raw.startswith(str(workspace)):
        raw = raw[len(str(workspace)):]
    try:
        absolute = validate_path(raw)
    except HTTPException as exc:
        raise OpenFailed(f"cwd 가 워크스페이스 밖이다: {cwd}") from exc
    if not absolute.is_dir():
        raise OpenFailed(f"cwd 폴더가 없다: {cwd}")
    rel = str(absolute.relative_to(workspace))
    return absolute, "" if rel == "." else rel


def launch_line(spec: dict, prompt_file: Path) -> str:
    """The one line typed into the new shell. Visible on purpose: the person can see what ran."""
    agent = " ".join(shlex.quote(part) for part in LAUNCH[spec["tool"]])
    start = f'{agent} "$(cat {shlex.quote(str(prompt_file))})"'
    if not spec["branch"]:
        return start
    branch = shlex.quote(spec["branch"])
    # Existing branch: switch to it. New: create it from where the folder is now.
    return f"{{ git switch {branch} 2>/dev/null || git switch -c {branch}; }} && {start}"


def rate_ok(username: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    recent = [t for t in _opens.get(username, []) if now - t < RATE_WINDOW_SEC]
    if len(recent) >= RATE_MAX_OPENS:
        _opens[username] = recent
        return False
    _opens[username] = [*recent, now]
    return True


def new_tab(tabs: list, *, session_id: str, rel_cwd: str, name: str, next_number: int,
            opened_by: str = "terminator") -> dict:
    """The same shape the frontend builds for a local single-pane tab (extractPaneToTabOp)."""
    pane_id = str(uuid.uuid4())
    used = {t.get("addressNumber") for t in tabs if isinstance(t, dict)}
    number = max(1, next_number)
    while number in used:
        number += 1
    return {
        "id": f"local:{session_id}:{int(time.time() * 1000)}:{pane_id[:6]}",
        "type": "local",
        "name": name,
        "cwd": rel_cwd,
        "icon": None,
        "color_index": 0,
        "panes": [{"id": pane_id, "sessionId": session_id, "cwd": rel_cwd, "addressNumber": 1}],
        "layout": "single",
        "splitTree": {"type": "pane", "paneId": pane_id},
        "activePaneId": pane_id,
        "addressNumber": number,
        "sessionId": session_id,
        "openedBy": opened_by,
    }


async def append_tab(username: str, session_id: str, rel_cwd: str, name: str,
                     opened_by: str = "terminator") -> tuple[str, str]:
    """Add the tab under the optimistic lock and tell every open client. Returns (address, tab id)."""
    from pane_addr import stamp_addresses
    from routes.user_state import _next_tab_address_number
    from sse_broadcast import _notify_tab_state_change

    for _ in range(SAVE_RETRIES):
        state = await storage.get_tab_state(username) or {}
        tabs = [t for t in (state.get("tabs") or []) if isinstance(t, dict)]
        tab = new_tab(tabs, session_id=session_id, rel_cwd=rel_cwd, name=name, opened_by=opened_by,
                      next_number=_next_tab_address_number(tabs, state.get("nextTabAddressNumber")))
        next_tabs = [*tabs, tab]
        result = await storage.save_tab_state_checked(
            username, next_tabs, state.get("activeTabId"),
            _next_tab_address_number(next_tabs, state.get("nextTabAddressNumber")),
            if_match=state.get("updatedAt"),
        )
        if result.status == "conflict":
            continue                      # another device saved in between; re-read and retry
        _notify_tab_state_change(username, result.state["updatedAt"])
        await stamp_addresses(next_tabs)
        hit = next((t for t in build_targets(next_tabs) if t.get("sessionId") == session_id), None)
        return (hit["addr"] if hit else ""), tab["id"]
    raise OpenFailed("탭 상태를 저장하지 못했다 (다른 기기와 저장이 계속 겹쳤다)")


async def _current_command(session_id: str) -> str:
    _rc, out, _err = await tmux_manager._run(
        "display-message", "-p", "-t", session_id, "#{pane_current_command}", check=False)
    return out.strip()


async def _wait_shell_ready(session_id: str) -> None:
    """Wait for the shell to draw something and go quiet. rc files can eat early keystrokes."""
    deadline = time.monotonic() + SHELL_READY_TIMEOUT_SEC
    last = None
    while time.monotonic() < deadline:
        screen = (await tmux_manager.capture_pane(session_id) or "").strip()
        if screen and screen == last:
            return
        last = screen
        await asyncio.sleep(0.3)


async def _wait_agent_started(session_id: str) -> bool:
    deadline = time.monotonic() + AGENT_START_TIMEOUT_SEC
    while time.monotonic() < deadline:
        command = await _current_command(session_id)
        if command and command not in SHELLS:
            return True
        await asyncio.sleep(0.4)
    return False


async def open_worker(username: str, spec: dict) -> dict:
    """Create the session, add the tab, start the agent. Returns what the asking agent needs."""
    if not rate_ok(username):
        raise OpenFailed(f"탭 열기 속도 제한 (>{RATE_MAX_OPENS}/{int(RATE_WINDOW_SEC)}s)")
    absolute, rel_cwd = resolve_cwd(spec["cwd"])
    session_id = str(uuid.uuid4())
    prompt_dir().mkdir(parents=True, exist_ok=True, mode=0o700)
    prompt_file = prompt_dir() / f"{session_id}.md"
    prompt_file.write_text(spec["prompt"], encoding="utf-8")
    prompt_file.chmod(0o600)

    await tmux_manager.create_session(session_id, cwd=str(absolute))
    await storage.create_session(session_id, username, cwd=rel_cwd)
    addr, tab_id = await append_tab(username, session_id, rel_cwd, spec["name"])

    await _wait_shell_ready(session_id)
    line = launch_line(spec, prompt_file)
    await tmux_manager._run("send-keys", "-t", session_id, "-l", line, check=False)
    await tmux_manager._run("send-keys", "-t", session_id, "Enter", check=False)
    started = await _wait_agent_started(session_id)
    logger.info("itl open %s %s (%s, branch=%s) by %s started=%s",
                addr, spec["tool"], rel_cwd or "/", spec["branch"] or "-", username, started)
    if not started:
        raise OpenFailed(f"{addr} 탭은 열었지만 {spec['tool']} 이(가) 시작되지 않았다. 그 탭 화면을 확인하라")
    return {"addr": addr, "tabId": tab_id, "sessionId": session_id, "tool": spec["tool"],
            "branch": spec["branch"] or None, "cwd": rel_cwd}


async def open_from_pane(username: str, sender_session: str, data: dict) -> None:
    """Outbox entry point. Always records a receipt so the waiting `itl open` gets an answer."""
    from itl_router import _record_delivery

    request_id = data.get("n") if isinstance(data.get("n"), str) else None
    try:
        spec = parse_open(data)
        result = await open_worker(username, spec)
        receipt = {"ok": True, "requestId": request_id, "delivery": "opened", **result}
    except OpenFailed as exc:
        logger.warning("itl open 거절 (%s): %s", sender_session, exc)
        receipt = {"ok": False, "requestId": request_id, "delivery": "failed", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - one failed open must not kill the poller
        logger.warning("itl open 예외 (%s): %s", sender_session, exc, exc_info=True)
        receipt = {"ok": False, "requestId": request_id, "delivery": "failed", "error": "탭을 열지 못했다"}
    if request_id:
        await _record_delivery(username, sender_session, None, receipt)


SPOTLIGHT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def is_open_request(payload: str) -> dict | None:
    """The outbox carries a send (`to`/`text`) or an app op (`op: open` / `op: spotlight`)."""
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) and data.get("op") in ("open", "spotlight") else None


async def handle_op(username: str, sender_session: str, data: dict) -> None:
    if data.get("op") == "spotlight":
        spotlight(username, data)
        return
    await open_from_pane(username, sender_session, data)


def spotlight(username: str, data: dict) -> bool:
    """Ask this user's open clients to point at one button. The id is a shape, never markup:
    the client looks it up in its own list of `data-guide` targets and ignores unknown ids."""
    from sse_broadcast import _broadcast_sse

    target = data.get("id")
    if not isinstance(target, str) or not SPOTLIGHT_ID_RE.match(target):
        logger.info("itl spotlight 거절: %r", target)
        return False
    _broadcast_sse({"type": "spotlight", "id": target}, username)
    return True
