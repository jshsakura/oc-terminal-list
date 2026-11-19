#!/usr/bin/env python3
"""Terminator's tools: an MCP server (stdio, stdlib only) over the `itl` CLI.

Terminator is the Terminal List companion. It does not edit code or run shell commands
(its Claude Code session starts with `--tools ""`); everything it can do is here:

  terminals      who is open, at which address, doing what           read-only
  read_terminal  the last lines of one terminal                      read-only
  guide          how to use Terminal List, from guide.md only        read-only
  roles          the team roles it can hand work to                  read-only
  open_worker    open a new tab, start an agent, hand it the task
  send           put a message into another terminal
  spotlight      point at a button on screen

Every action goes through `itl`, the same path a person would type, so the terminal
history shows exactly what was done. The name is deliberately not `itl_mcp.py`: the
backend's cleanup removes agent config entries pointing at that old file.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ITL = str(HERE.parent / "itl")
GUIDE = HERE / "guide.md"
ROLES = HERE / "roles.json"
PROTOCOL_VERSION = "2025-06-18"
CALL_TIMEOUT_SEC = 100
GUIDE_TARGET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _text(value) -> dict:
    return {"type": "text", "text": value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)}


def itl(*args: str, stdin: str | None = None) -> tuple[int, dict | str]:
    """Run `itl --json …` and return (exit code, parsed JSON or raw text)."""
    try:
        proc = subprocess.run([sys.executable, ITL, "--json", *args], input=stdin, text=True,
                              capture_output=True, timeout=CALL_TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        return 4, {"ok": False, "error": "itl 이 시간 안에 끝나지 않았다"}
    out = (proc.stdout or "").strip()
    try:
        return proc.returncode, json.loads(out) if out else {"ok": proc.returncode == 0,
                                                             "error": (proc.stderr or "").strip() or None}
    except ValueError:
        return proc.returncode, out or (proc.stderr or "").strip()


def guide_sections() -> dict[str, str]:
    sections: dict[str, str] = {}
    current = None
    for line in GUIDE.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return {k: v.strip() for k, v in sections.items()}


def guide_targets() -> list[str]:
    """Spotlight ids are the backticked ids in guide.md's 화면 안내 대상 section."""
    body = guide_sections().get("화면 안내 대상", "")
    return re.findall(r"`([a-z0-9][a-z0-9-]*)`", body)


# ─── tools ───────────────────────────────────────────────────────────────────

def t_terminals(_args: dict):
    code, data = itl("list")
    if code != 0 or not isinstance(data, dict):
        return True, data
    _c, me = itl("whoami")
    mine = (me.get("pane") or {}).get("native_id") if isinstance(me, dict) else None
    rows = [{
        "addr": p.get("app_addr") or p.get("addr"),
        "running": p.get("agent"),
        "status": p.get("status") or None,
        "cwd": p.get("cwd"),
        "title": p.get("title"),
        "isTerminator": p.get("native_id") == mine,
    } for p in data.get("panes", [])]
    return False, {"terminals": rows}


def t_read_terminal(args: dict):
    lines = max(5, min(int(args.get("lines") or 60), 300))
    code, data = itl("read", str(args["addr"]), "--lines", str(lines))
    if code != 0 or not isinstance(data, dict):
        return True, data
    return False, {"addr": args["addr"], "text": data.get("text", "")}


def t_guide(args: dict):
    sections = guide_sections()
    topic = (args.get("topic") or "").strip()
    if not topic:
        return False, {"topics": list(sections)}
    hit = sections.get(topic) or next((v for k, v in sections.items() if topic in k), None)
    if hit is None:
        return True, {"error": "그런 항목이 없다. topic 을 비우고 다시 불러 목록을 보라", "topics": list(sections)}
    return False, {"topic": topic, "text": hit}


def t_roles(_args: dict):
    return False, json.loads(ROLES.read_text(encoding="utf-8"))


def t_open_worker(args: dict):
    cmd = ["open", "--tool", args["tool"], "--prompt-file", "-", "--wait", "90"]
    for key in ("cwd", "branch", "name"):
        if args.get(key):
            cmd += [f"--{key}", str(args[key])]
    code, data = itl(*cmd, stdin=args["task"])
    return code != 0, data


def t_send(args: dict):
    code, data = itl("send", str(args["to"]), str(args["text"]), "--wait", "30")
    return code != 0, data


def t_spotlight(args: dict):
    target = str(args.get("id") or "")
    if target not in guide_targets() or not GUIDE_TARGET_RE.match(target):
        return True, {"error": "안내 목록에 없는 id 다", "ids": guide_targets()}
    code, data = itl("spotlight", target)
    return code != 0, data


TOOLS = [
    {"name": "terminals", "fn": t_terminals,
     "description": ("List the open terminals: address (like 2.1), what runs there, status, folder. "
                     "Call this before addressing a terminal."),
     "inputSchema": {"type": "object", "properties": {}}, "readOnly": True},
    {"name": "read_terminal", "fn": t_read_terminal,
     "description": "Read the last lines a terminal printed, to see how a worker is doing.",
     "inputSchema": {"type": "object", "properties": {
         "addr": {"type": "string", "description": "Terminal address from `terminals`"},
         "lines": {"type": "integer", "minimum": 5, "maximum": 300}}, "required": ["addr"]}, "readOnly": True},
    {"name": "guide", "fn": t_guide,
     "description": ("How to use Terminal List. Call with no topic for the list of topics, then with one topic. "
                     "Answer how-to questions only from this text; never invent buttons or settings."),
     "inputSchema": {"type": "object", "properties": {"topic": {"type": "string"}}}, "readOnly": True},
    {"name": "roles", "fn": t_roles,
     "description": "The team roles you can hand work to, with the tool each runs on.",
     "inputSchema": {"type": "object", "properties": {}}, "readOnly": True},
    {"name": "open_worker", "fn": t_open_worker,
     "description": ("Open a new tab, switch to a branch, start an agent and hand it the task. Returns the new tab's "
                     "address once the agent has started. Put the person's request, the role's instructions and the "
                     "report-back line into `task`."),
     "inputSchema": {"type": "object", "properties": {
         "tool": {"type": "string", "enum": ["claude", "codex", "opencode"]},
         "task": {"type": "string", "description": "The worker's first instruction (up to 8000 characters)"},
         "cwd": {"type": "string", "description": "Project folder; default is Terminator's own folder"},
         "branch": {"type": "string", "description": "Work branch like fix/login-button. Never main or master."},
         "name": {"type": "string", "description": "Short tab name, like 개발 or 리뷰"}},
         "required": ["tool", "task"]}},
    {"name": "send", "fn": t_send,
     "description": ("Type a message into another terminal and press Enter if an agent runs there "
                     "(a bare shell gets the text only)."),
     "inputSchema": {"type": "object", "properties": {
         "to": {"type": "string", "description": "Terminal address from `terminals`"},
         "text": {"type": "string"}}, "required": ["to", "text"]}},
    {"name": "spotlight", "fn": t_spotlight,
     "description": ("Point at a button on the person's screen when they ask where something is. "
                     "Use an id from the guide topic 화면 안내 대상."),
     "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
]
BY_NAME = {t["name"]: t for t in TOOLS}


def tool_list() -> list[dict]:
    out = []
    for t in TOOLS:
        entry = {"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}
        if t.get("readOnly"):
            entry["annotations"] = {"readOnlyHint": True}
        out.append(entry)
    return out


def handle(req: dict) -> dict | None:
    method = req.get("method")
    rid = req.get("id")
    if rid is None:
        return None                                   # notification
    if method == "initialize":
        version = (req.get("params") or {}).get("protocolVersion") or PROTOCOL_VERSION
        return {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": version, "capabilities": {"tools": {}},
            "serverInfo": {"name": "terminator", "version": "1"}}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": rid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": tool_list()}}
    if method == "tools/call":
        params = req.get("params") or {}
        tool = BY_NAME.get(params.get("name"))
        if not tool:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": "unknown tool"}}
        try:
            is_error, value = tool["fn"](params.get("arguments") or {})
        except (KeyError, ValueError, OSError) as exc:
            is_error, value = True, {"error": f"{type(exc).__name__}: {exc}"}
        return {"jsonrpc": "2.0", "id": rid, "result": {"content": [_text(value)], "isError": bool(is_error)}}
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"unknown method {method}"}}


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        resp = handle(req)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
