"""Terminator panel API: start the companion session, talk to it, read the conversation.

The backend still calls no LLM. Terminator is a Claude Code session in a tmux session of
its own (`terminator-<hash>`, no tab). These routes only:

  GET  /api/terminator/status    key present? which tools are logged in? running?
  POST /api/terminator/start     make sure the session exists and Terminator runs in it
  POST /api/terminator/say       type the person's message into it and press Enter
  GET  /api/terminator/messages  the conversation, read from its Claude Code transcript
  POST /api/terminator/show      give the session a tab, so the real terminal can be seen

The conversation comes from the transcript file, not from scraping the TUI. Terminator is
started with a fixed `--session-id`, kept as a tmux option on the session, so the backend
knows exactly which `~/.claude/projects/*/<id>.jsonl` is this session's. The panel refetches
when the session's agent status changes (the existing poller already broadcasts that), so
nothing new polls.

Login checks only look at whether a credential file exists. They never read it and never run
the tool: a file being there does not prove the login is still valid, and the panel says so.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _deps import WORKSPACE_ROOT, verify_auth_token
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)
router = APIRouter()

TRANSCRIPT_OPTION = "@terminator_transcript"
# The launcher stamps what it runs with, so the panel shows the real values, not a copy.
MODEL_OPTION = "@terminator_model"
EFFORT_OPTION = "@terminator_effort"
CONTEXT_OPTION = "@terminator_context"
KEY_FILE = "~/.config/zai/api_key"
LOGIN_FILES = {
    "claude": ["~/.claude/.credentials.json"],
    "codex": ["~/.codex/auth.json"],
    "opencode": ["~/.local/share/opencode/auth.json"],
    "github": ["~/.config/gh/hosts.yml"],
}
SHELLS = frozenset({"bash", "zsh", "sh", "dash", "fish"})
MAX_SAY_CHARS = 4000
MAX_MESSAGES = 120
MAX_TEXT_CHARS = 4000
START_TIMEOUT_SEC = 20.0
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_REPORT_RE = re.compile(r"^\[from (\d+\.\d+) · 답장: itl send \S+ '…'\] ?")


def session_name(username: str) -> str:
    """One Terminator per user. The name is a safe id (the WS route checks that)."""
    return "terminator-" + hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]


def _exists(path: str) -> bool:
    return Path(os.path.expanduser(path)).is_file()


def login_state() -> dict[str, bool]:
    state = {tool: any(_exists(p) for p in paths) for tool, paths in LOGIN_FILES.items()}
    state["claude"] = state["claude"] or bool(os.environ.get("ANTHROPIC_API_KEY"))
    return state


async def _option(session: str, name: str) -> str:
    _rc, out, _err = await tmux_manager._run("show-options", "-qv", "-t", session, name, check=False)
    return out.strip()


async def _running(session: str) -> bool:
    if not await tmux_manager.session_exists(session):
        return False
    _rc, out, _err = await tmux_manager._run(
        "display-message", "-p", "-t", session, "#{pane_current_command}", check=False)
    command = out.strip()
    return bool(command) and command not in SHELLS


class SayRequest(BaseModel):
    text: str


@router.get("/api/terminator/status")
async def terminator_status(username: str = Depends(verify_auth_token)):
    session = session_name(username)
    running = await _running(session)
    return {
        "configured": _exists(KEY_FILE),
        "logins": login_state(),
        "sessionId": session,
        "running": running,
        "engine": await _engine(session) if running else None,
    }


async def _engine(session: str) -> dict:
    limit = await _option(session, CONTEXT_OPTION)
    return {
        "model": await _option(session, MODEL_OPTION) or None,
        "effort": await _option(session, EFFORT_OPTION) or None,
        "contextLimit": int(limit) if limit.isdigit() else None,
    }


async def _wait_quiet(session: str, timeout: float = 6.0) -> None:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        screen = (await tmux_manager.capture_pane(session) or "").strip()
        if screen and screen == last:
            return
        last = screen
        await asyncio.sleep(0.3)


@router.post("/api/terminator/start")
async def terminator_start(username: str = Depends(verify_auth_token)):
    if not _exists(KEY_FILE):
        raise HTTPException(status_code=409, detail="터미네이터 연결 키가 없습니다")
    session = session_name(username)
    if await _running(session):
        return {"sessionId": session, "running": True, "started": False}
    if not await tmux_manager.session_exists(session):
        await tmux_manager.create_session(session, cwd=str(Path(WORKSPACE_ROOT).resolve()))
        await storage.create_session(session, username, cwd="")
    transcript = str(uuid.uuid4())
    await tmux_manager._run("set-option", "-t", session, TRANSCRIPT_OPTION, transcript, check=False)
    await _wait_quiet(session)
    await tmux_manager._run("send-keys", "-t", session, "-l", f"terminator --session-id {transcript}",
                            check=False)
    await tmux_manager._run("send-keys", "-t", session, "Enter", check=False)
    deadline = time.monotonic() + START_TIMEOUT_SEC
    while time.monotonic() < deadline:
        if await _running(session):
            logger.info("terminator started for %s (%s)", username, session)
            return {"sessionId": session, "running": True, "started": True}
        await asyncio.sleep(0.4)
    raise HTTPException(status_code=500, detail="터미네이터가 시작되지 않았습니다. 터미널로 보기에서 화면을 확인합니다")


@router.post("/api/terminator/say")
async def terminator_say(request: SayRequest, username: str = Depends(verify_auth_token)):
    # A line feed typed into a pane is Enter. Keep it one line; the agent reads it fine.
    text = _CONTROL_RE.sub(" ", (request.text or "")).replace("\n", " ").strip()
    if not text:
        raise HTTPException(status_code=400, detail="보낼 내용이 없습니다")
    if len(text) > MAX_SAY_CHARS:
        raise HTTPException(status_code=400, detail=f"{MAX_SAY_CHARS}자까지 보낼 수 있습니다")
    session = session_name(username)
    if not await _running(session):
        raise HTTPException(status_code=409, detail="터미네이터가 꺼져 있습니다")
    from itl_router import DeliveryFailed, _run_local
    try:
        await _run_local(["send", session, text])
    except DeliveryFailed as exc:
        raise HTTPException(status_code=502, detail=f"전달하지 못했습니다: {exc}") from exc
    return {"ok": True}


def transcript_path(transcript_id: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f-]{36}", transcript_id or ""):
        return None
    hits = sorted(Path(os.path.expanduser("~/.claude/projects")).glob(f"*/{transcript_id}.jsonl"))
    return hits[0] if hits else None


def _tool_label(block: dict) -> str:
    name = str(block.get("name") or "")
    args = block.get("input") if isinstance(block.get("input"), dict) else {}
    short = name.split("__")[-1]
    if short == "open_worker":
        return f"탭 열기 · {args.get('name') or args.get('tool') or ''}".strip(" ·")
    if short == "send":
        return f"전달 · {args.get('to', '')}"
    if short == "spotlight":
        return f"화면 안내 · {args.get('id', '')}"
    return {"terminals": "터미널 확인", "read_terminal": "화면 읽기", "guide": "안내 찾기",
            "roles": "역할 확인"}.get(short, short)


def _tool_outcome(block: dict) -> dict:
    """A tool_result block -> {ok, detail}. Only what the person needs to trust the routing:
    did it work, and where did it go (the new tab's address) or why not."""
    content = block.get("content")
    if isinstance(content, list):
        content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
    data = None
    if isinstance(content, str):
        try:
            data = json.loads(content)
        except ValueError:
            data = None
    ok = not block.get("is_error")
    detail = ""
    if isinstance(data, dict):
        ok = ok and data.get("ok", True) is not False and not data.get("error")
        detail = str(data.get("addr") or "") if ok else str(data.get("error") or "")
    return {"ok": ok, "detail": _CONTROL_RE.sub(" ", detail)[:160]}


def _entries(lines):
    for raw in lines:
        try:
            entry = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if isinstance(entry, dict) and not entry.get("isMeta") and not entry.get("isSidechain"):
            yield entry


def context_used(lines) -> int | None:
    """Tokens the latest request carried: what the panel shows against the context limit."""
    used = None
    for entry in _entries(lines):
        usage = (entry.get("message") or {}).get("usage") if entry.get("type") == "assistant" else None
        if isinstance(usage, dict):
            used = sum(int(usage.get(k) or 0) for k in
                       ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return used


def parse_transcript(lines) -> list[dict]:
    """Transcript JSONL -> chat items: user / assistant / report / tool. A tool item carries
    its outcome (ok + the new address or the error); raw tool output and meta lines are
    dropped. The person sees what was said, what was done, and whether it worked."""
    lines = list(lines)
    outcomes: dict[str, dict] = {}
    for entry in _entries(lines):
        content = (entry.get("message") or {}).get("content")
        if entry.get("type") == "user" and isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    outcomes[str(block.get("tool_use_id"))] = _tool_outcome(block)
    items: list[dict] = []
    for entry in _entries(lines):
        kind = entry.get("type")
        content = (entry.get("message") or {}).get("content")
        uid = entry.get("uuid") or ""
        if kind == "user":
            text = content if isinstance(content, str) else "".join(
                b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")
            text = text.strip()
            if not text or text.startswith("<"):          # command wrappers, caveats, tool results
                continue
            report = _REPORT_RE.match(text)
            if report:
                items.append({"id": uid, "role": "report", "from": report.group(1),
                              "text": text[report.end():][:MAX_TEXT_CHARS]})
            else:
                items.append({"id": uid, "role": "user", "text": text[:MAX_TEXT_CHARS]})
        elif kind == "assistant" and isinstance(content, list):
            for n, block in enumerate(content):
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text" and (block.get("text") or "").strip():
                    items.append({"id": f"{uid}:{n}", "role": "assistant",
                                  "text": block["text"].strip()[:MAX_TEXT_CHARS]})
                elif block.get("type") == "tool_use":
                    outcome = outcomes.get(str(block.get("id")))
                    items.append({"id": f"{uid}:{n}", "role": "tool", "text": _tool_label(block),
                                  "ok": outcome["ok"] if outcome else None,
                                  "detail": outcome["detail"] if outcome else ""})
    return items[-MAX_MESSAGES:]


@router.get("/api/terminator/messages")
async def terminator_messages(username: str = Depends(verify_auth_token)):
    session = session_name(username)
    if not await tmux_manager.session_exists(session):
        return {"messages": [], "running": False}
    path = transcript_path(await _option(session, TRANSCRIPT_OPTION))
    if path is None:
        return {"messages": [], "running": await _running(session)}
    lines = await asyncio.to_thread(lambda: path.read_text(encoding="utf-8", errors="replace").splitlines())
    return {"messages": parse_transcript(lines), "contextUsed": context_used(lines),
            "running": await _running(session)}


@router.post("/api/terminator/show")
async def terminator_show(username: str = Depends(verify_auth_token)):
    """The panel is an easy view over a real terminal. This puts that terminal in a tab
    (once; a second call returns the same tab) so nothing about it is hidden."""
    from itl_open import append_tab

    session = session_name(username)
    if not await tmux_manager.session_exists(session):
        raise HTTPException(status_code=409, detail="터미네이터가 꺼져 있습니다")
    state = await storage.get_tab_state(username) or {}
    for tab in state.get("tabs") or []:
        if isinstance(tab, dict) and any(isinstance(p, dict) and p.get("sessionId") == session
                                         for p in tab.get("panes") or []):
            return {"tabId": tab.get("id"), "created": False}
    _addr, tab_id = await append_tab(username, session, "", "터미네이터", opened_by="terminator-self")
    return {"tabId": tab_id, "created": True}
