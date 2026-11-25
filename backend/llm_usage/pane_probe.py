"""Data mutation: NONE - 100% read-only."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path

OUTPUT_MARKER = "ITL_LLM_PANE_JSON\n"
MAX_LOG_BYTES = 2 * 1024 * 1024
THREAD_ID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
AGENTS = {"codex": "Codex", "claude": "Claude Code", "gemini": "Gemini CLI", "opencode": "OpenCode"}


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def read_events(path: Path):
    with path.open("rb") as stream:
        size = path.stat().st_size
        offset = max(0, size - MAX_LOG_BYTES)
        stream.seek(offset)
        if offset:
            stream.readline()
        for raw in stream:
            if len(raw) > MAX_LOG_BYTES:
                continue
            try:
                event = json.loads(raw)
            except (ValueError, UnicodeError):
                continue
            if isinstance(event, dict):
                yield event


def summarize(path: Path, row: dict) -> dict:
    result = {"thread_id": row["id"], "model": row.get("model"), "effort": row.get("reasoning_effort"),
              "input_tokens": None, "output_tokens": None, "context_tokens": None,
              "context_window": None, "limits": [], "updated_at": None, "limits_updated_at": None}
    for event in read_events(path):
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if event.get("type") == "turn_context":
            for source, target in [("model", "model"), ("effort", "effort")]:
                value = payload.get(source)
                if isinstance(value, str):
                    result[target] = value[:160]
        if event.get("type") != "event_msg" or payload.get("type") != "token_count":
            continue
        info = payload.get("info")
        if isinstance(info, dict):
            total = info.get("total_token_usage") or {}
            last = info.get("last_token_usage") or {}
            if isinstance(total, dict) and isinstance(last, dict):
                result.update(input_tokens=number(total.get("input_tokens")),
                              output_tokens=number(total.get("output_tokens")),
                              context_tokens=number(last.get("total_tokens")),
                              context_window=number(info.get("model_context_window")),
                              updated_at=event.get("timestamp"))
        rates = payload.get("rate_limits")
        if isinstance(rates, dict):
            limits = []
            for key in ("primary", "secondary"):
                window = rates.get(key)
                if not isinstance(window, dict):
                    continue
                used = number(window.get("used_percent"))
                minutes = number(window.get("window_minutes"))
                if used is None or not minutes:
                    continue
                limits.append({"window_minutes": minutes, "remaining_percent": max(0, 100 - used),
                               "resets_at": number(window.get("resets_at"))})
            result.update(limits=limits, limits_updated_at=event.get("timestamp"))
    return result


def find_agent(pane_pid: int, proc_root: Path = Path("/proc")) -> dict | None:
    if not proc_root.is_dir():
        raise OSError("Process information unavailable")
    children = {}
    parents = {}
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            children.setdefault(int(stat[1]), []).append(int(entry.name))
            parents[int(entry.name)] = int(stat[1])
        except (OSError, ValueError, IndexError):
            continue
    pending = [(pane_pid, 0)]
    found = []
    seen = set()
    while pending and len(seen) < 512:
        pid, depth = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        proc = proc_root / str(pid)
        try:
            argv = [v.decode(errors="replace") for v in (proc / "cmdline").read_bytes().split(b"\0") if v]
            name = Path(argv[0]).name if argv else ""
            wrapper = name in {"node", "nodejs"}
            if wrapper and len(argv) > 1:
                name = Path(argv[1]).name.removesuffix(".js")
            if name in AGENTS and "app-server" not in argv[1:3]:
                found.append({"pid": pid, "agent": AGENTS[name], "depth": depth,
                              "cwd": os.readlink(proc / "cwd")})
                if not wrapper:
                    continue
            pending.extend((child, depth + 1) for child in children.get(pid, []))
        except OSError:
            continue
    if not found:
        return None
    ancestors = set()
    for item in found:
        pid = parents.get(item["pid"])
        visited = set()
        while pid and pid not in visited:
            ancestors.add(pid)
            visited.add(pid)
            pid = parents.get(pid)
    found = [item for item in found if item["pid"] not in ancestors]
    if len(found) != 1:
        raise OSError("Multiple agent processes")
    return found[0]


def codex_home(pid: int) -> Path:
    env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    values = {}
    for entry in env:
        key, _, value = entry.partition(b"=")
        if key in (b"CODEX_HOME", b"HOME"):
            values[key] = os.fsdecode(value)
    if values.get(b"CODEX_HOME"):
        return Path(values[b"CODEX_HOME"]).resolve()
    if values.get(b"HOME"):
        return Path(values[b"HOME"]).resolve() / ".codex"
    raise OSError("Agent home unavailable")


def candidates(home: Path, cwd: str) -> list[dict]:
    database = home / "state_5.sqlite"
    if not database.is_file():
        return []
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        deadline = time.monotonic() + 2
        conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(threads)")}
        order = "updated_at_ms" if "updated_at_ms" in columns else "updated_at"
        rows = conn.execute(
            "SELECT id, rollout_path, model, reasoning_effort, updated_at FROM threads "
            "WHERE archived=0 AND cwd=? AND source IN ('cli', 'vscode') "
            f"ORDER BY {order} DESC LIMIT 10", (cwd,),
        ).fetchall()
        return [dict(row) for row in rows]


def safe_rollout(home: Path, raw: str) -> Path:
    path = Path(raw).resolve()
    if not path.is_relative_to((home / "sessions").resolve()) or path.suffix != ".jsonl":
        raise ValueError("Invalid rollout path")
    return path


def titled_session(home: Path, cwd: str, pane_title: str) -> dict | None:
    title = re.sub(r"^[⠀-⣿]\s+", "", pane_title).strip()
    suffix = f" | {Path(cwd).name or cwd}"
    database = home / "state_5.sqlite"
    if not title.endswith(suffix) or not database.is_file():
        return None
    name = title[:-len(suffix)]
    if not name:
        return None
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        deadline = time.monotonic() + 2
        conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        if "name" not in {row[1] for row in conn.execute("PRAGMA table_info(threads)")}:
            return None
        rows = conn.execute(
            "SELECT id, rollout_path, model, reasoning_effort, updated_at FROM threads "
            "WHERE archived=0 AND cwd=? AND name=? AND source IN ('cli', 'vscode') LIMIT 2", (cwd, name),
        ).fetchall()
        return dict(rows[0]) if len(rows) == 1 else None


def open_rollout(home: Path, pid: int) -> Path | None:
    paths = set()
    for fd in Path(f"/proc/{pid}/fd").iterdir():
        try:
            path = safe_rollout(home, os.readlink(fd))
            if path.is_file():
                paths.add(path)
        except (OSError, ValueError):
            continue
    return next(iter(paths)) if len(paths) == 1 else None


def inspect_pane(pane_pid: int, thread_id: str | None = None, expected_pid: int | None = None,
                 pane_title: str = "", current_only: bool = False) -> dict:
    try:
        agent = find_agent(pane_pid)
        if not agent:
            return {"status": "no_agent"}
        base = {"agent": agent["agent"], "process_id": agent["pid"]}
        if agent["agent"] != "Codex":
            return {**base, "status": "unsupported"}
        home = codex_home(agent["pid"])
        rows = candidates(home, agent["cwd"])
        visible_rows = [{key: row[key] for key in ("id", "model", "updated_at")} for row in rows]
        base["sessions"] = visible_rows
        direct = open_rollout(home, agent["pid"])
        if direct:
            matches = [row for row in rows if safe_rollout(home, row["rollout_path"]) == direct]
            if len(matches) == 1:
                return {**base, "status": "ready", "match": "process", "usage": summarize(direct, matches[0])}
        current = titled_session(home, agent["cwd"], pane_title)
        if current:
            path = safe_rollout(home, current["rollout_path"])
            return {**base, "status": "ready", "match": "title", "usage": summarize(path, current)}
        if current_only:
            return {"agent": base["agent"], "process_id": base["process_id"], "status": "session_unmatched"}
        if thread_id and expected_pid == agent["pid"]:
            row = next((item for item in rows if item["id"] == thread_id), None)
            if not row:
                return {**base, "status": "session_unavailable"}
            path = safe_rollout(home, row["rollout_path"])
            return {**base, "status": "ready", "match": "selected", "usage": summarize(path, row)}
        return {**base, "status": "select_session" if rows else "unavailable"}
    except (OSError, sqlite3.Error, ValueError):
        return {"status": "unavailable"}


def apply_status_limit(result: dict, screen: str) -> dict:
    if result.get("status") != "ready" or result.get("agent") != "Codex":
        return result
    if result.get("match") not in {"process", "title"}:
        return result
    matches = []
    for line in screen.splitlines()[-12:]:
        match = re.fullmatch(
            r"\s*GPT-\S+[^\n]* · Context \d+% used · [^\n]* · weekly (\d{1,3})% left(?: · [^\n]*)?\s*",
            line, re.IGNORECASE,
        )
        if match and 0 <= int(match[1]) <= 100:
            matches.append(int(match[1]))
    if len(matches) != 1:
        return result
    usage = dict(result["usage"])
    usage["limits"] = [dict(limit) for limit in usage.get("limits", []) if limit.get("window_minutes") != 10080]
    usage["limits"].append({"window_minutes": 10080, "remaining_percent": matches[0], "resets_at": None})
    usage["limits_updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    usage["limits_source"] = "terminal_status"
    return {**result, "usage": usage}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--thread")
    parser.add_argument("--process", type=int)
    parser.add_argument("--current-only", action="store_true")
    args = parser.parse_args()
    if args.thread and not THREAD_ID.fullmatch(args.thread):
        raise ValueError("Invalid thread id")
    proc = subprocess.run(
        ["tmux", "display-message", "-p", "-t", f"={args.session}:", "#{pane_pid}\t#{pane_title}"],
        capture_output=True, text=True, timeout=3, check=False,
    )
    pid, _, title = proc.stdout.rstrip("\n").partition("\t")
    if proc.returncode or not pid.isdigit():
        result = {"status": "no_terminal"}
    else:
        result = inspect_pane(int(pid), args.thread, args.process, title, args.current_only)
        if result.get("status") == "ready" and result.get("match") in {"process", "title"}:
            screen = subprocess.run(
                ["tmux", "capture-pane", "-p", "-J", "-t", f"={args.session}:"],
                capture_output=True, text=True, timeout=3, check=False,
            )
            if screen.returncode == 0:
                result = apply_status_limit(result, screen.stdout)
    print(OUTPUT_MARKER + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
