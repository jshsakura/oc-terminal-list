#!/usr/bin/env python3
"""Collects LLM usage by reading the logs agent CLIs already write.

**One copy of this file runs in two places.**

    local   the backend imports it and calls collect()
    remote  the whole file is piped over SSH stdin and run as `python3 - <days>`

Two constraints follow from that:

1. **stdlib only.** Installing nothing on the hosts is the entire point of this
   approach — no resident process, no port to open, no image to keep updated.
2. **It must stay a single file,** because what gets piped over stdin is exactly
   this file.

The collector **only extracts**. Multiplying by prices happens in the backend
(`pricing.py`): prices change, and a table living inside the remote script would
mean every host computes with whatever table it happened to receive. What leaves
here is token counts and facts.

Output (last stdout line, after the marker):

    {"ok": true, "days": 30, "rows": [...], "sessions": [...],
     "agents": ["claude"], "warnings": [...]}

  rows      token totals per (day, agent, model, project) — by_day / by_model /
            by_agent / by_project are all derived from these.
  sessions  sessions inside the window, for the "recent sessions" list.

Why a marker: SSH stdout carries MOTDs and shell chatter. Parsing from the first
`{` breaks silently the day a banner contains a brace.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

# Lets the backend find where the JSON starts in stdout.
OUTPUT_MARKER = "<<<ITL-LLM-USAGE>>>"

# Session titles get one line in a list — clip them here (also cuts transfer size).
TITLE_MAX = 90
# Max sessions one host returns. The UI shows 5, but sessions from every host are
# merged and re-sorted, so send a healthy surplus. Sessions beyond this still
# count in `rows` and in `session_count`; they just miss the list.
SESSION_LIMIT = 60

TOKEN_FIELDS = ("input", "output", "cache_read", "cache_creation")


def _empty_tokens() -> dict:
    return {f: 0 for f in TOKEN_FIELDS}


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _cutoff(days: int):
    """(date string, epoch seconds). days <= 0 means (None, 0) — everything."""
    if days <= 0:
        return None, 0.0
    start = datetime.now(timezone.utc) - timedelta(days=days)
    return start.date().isoformat(), start.timestamp()


def _project_of(cwd: str) -> str:
    """Project name = last path segment. That is the unit humans recognise."""
    path = (cwd or "").rstrip("/")
    return os.path.basename(path) or (path or "unknown")


def _clip(text: str) -> str:
    text = " ".join((text or "").split())
    return text[:TITLE_MAX]


class Accumulator:
    """Collects (day, agent, model, project) buckets plus a session list."""

    def __init__(self):
        self.rows: dict[tuple, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.agents: set[str] = set()
        self.warnings: list[str] = []

    def add(self, *, day: str, agent: str, model: str, project: str, tokens: dict,
            cost: float | None = None) -> None:
        """Add tokens to one bucket.

        Pass `cost` **only when the source knows its own cost** (opencode does).
        The backend then skips the price table for that row: a tool knows its own
        model's pricing better than our table, and models missing from the table
        would otherwise show up as free.
        """
        if not any(tokens.values()):
            return
        self.agents.add(agent)
        key = (day, agent, model or "unknown", project)
        slot = self.rows.get(key)
        if slot is None:
            slot = {"day": day, "agent": agent, "model": model or "unknown",
                    "project": project, "cost": None, **_empty_tokens()}
            self.rows[key] = slot
        for field in TOKEN_FIELDS:
            slot[field] += _int(tokens.get(field))
        if cost is not None:
            slot["cost"] = (slot["cost"] or 0.0) + float(cost)

    def session(self, session_id: str, **fields) -> None:
        if not session_id:
            return
        slot = self.sessions.setdefault(
            session_id,
            {"session_id": session_id, "agent": "", "model": "", "project": "",
             "cwd": "", "title": "", "last_activity": "", "cost": None, **_empty_tokens()},
        )
        slot.update({k: v for k, v in fields.items() if v not in (None, "")})

    def payload(self, days: int) -> dict:
        sessions = [s for s in self.sessions.values()
                    if any(s[f] for f in TOKEN_FIELDS) or s["cost"]]
        sessions.sort(key=lambda s: str(s.get("last_activity") or ""), reverse=True)
        return {
            "ok": True,
            "days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "rows": sorted(self.rows.values(), key=lambda r: (r["day"], r["agent"], r["model"])),
            "sessions": sessions[:SESSION_LIMIT],
            # The list is truncated, the count is not. A session count that
            # silently shrinks to the list cap is simply a wrong number.
            "session_count": len(sessions),
            "agents": sorted(self.agents),
            "warnings": self.warnings,
        }


# ── claude code ─────────────────────────────────────────────────────────────
# ~/.claude/projects/<path-slug>/<session-uuid>.jsonl — one file per session.
# Tokens live in message.usage on assistant lines. The same response can be
# written to several files (resume / fork), so dedupe globally on
# (message.id, requestId) — the rule ccusage uses. We take the rule, not the tool.

def _collect_claude(acc: Accumulator, home: str, day_cut, ts_cut) -> None:
    root = os.path.join(home, ".claude", "projects")
    if not os.path.isdir(root):
        return
    seen: set[tuple] = set()
    for slug in sorted(os.listdir(root)):
        folder = os.path.join(root, slug)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(folder, name)
            try:
                if ts_cut and os.path.getmtime(path) < ts_cut:
                    continue  # don't even open files outside the window — there are hundreds
            except OSError:
                continue
            _claude_file(acc, path, name[:-6], day_cut, seen)


def _claude_file(acc: Accumulator, path: str, session_id: str, day_cut, seen: set) -> None:
    totals = _empty_tokens()
    cwd = model = title = last_prompt = ""
    last_activity = ""
    try:
        handle = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            kind = entry.get("type")
            if kind == "ai-title":
                title = _clip(entry.get("aiTitle") or "")
                continue
            if kind == "last-prompt":
                last_prompt = _clip(entry.get("lastPrompt") or "")
                continue
            if kind != "assistant":
                continue

            stamp = str(entry.get("timestamp") or "")
            day = stamp[:10]
            if not day or (day_cut and day < day_cut):
                continue
            message = entry.get("message") or {}
            usage = message.get("usage") or {}
            dedup = (message.get("id"), entry.get("requestId"))
            if all(dedup) and dedup in seen:
                continue
            if all(dedup):
                seen.add(dedup)

            model = message.get("model") or model
            if model.startswith("<"):      # <synthetic> — never billed
                continue
            cwd = entry.get("cwd") or cwd
            last_activity = max(last_activity, stamp)
            tokens = {
                "input": _int(usage.get("input_tokens")),
                "output": _int(usage.get("output_tokens")),
                "cache_read": _int(usage.get("cache_read_input_tokens")),
                "cache_creation": _int(usage.get("cache_creation_input_tokens")),
            }
            acc.add(day=day, agent="claude", model=model,
                    project=_project_of(cwd), tokens=tokens)
            for field in TOKEN_FIELDS:
                totals[field] += tokens[field]

    if any(totals.values()):
        acc.session(session_id, agent="claude", model=model, cwd=cwd,
                    project=_project_of(cwd), title=title or last_prompt,
                    last_activity=last_activity, **totals)


# ── codex ───────────────────────────────────────────────────────────────────
# ~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl
# token_count events carry **cumulative** totals. Summing them inflates usage by
# the square of the session length — take the delta from the previous total.

def _collect_codex(acc: Accumulator, home: str, day_cut, ts_cut) -> None:
    root = os.path.join(home, ".codex", "sessions")
    if not os.path.isdir(root):
        return
    for folder, _dirs, files in os.walk(root):
        for name in sorted(files):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(folder, name)
            try:
                if ts_cut and os.path.getmtime(path) < ts_cut:
                    continue
            except OSError:
                continue
            _codex_file(acc, path, day_cut)


def _codex_usage(info: dict) -> dict:
    """codex reports input_tokens *including* the cached part — subtract it."""
    total_input = _int(info.get("input_tokens"))
    cached = _int(info.get("cached_input_tokens"))
    return {
        "input": max(0, total_input - cached),
        "output": _int(info.get("output_tokens")),
        "cache_read": cached,
        "cache_creation": _int(info.get("cache_write_input_tokens")),
    }


def _codex_file(acc: Accumulator, path: str, day_cut) -> None:
    session_id = os.path.basename(path)[:-6]
    cwd = model = ""
    last_activity = ""
    prev = _empty_tokens()
    totals = _empty_tokens()
    try:
        handle = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            payload = entry.get("payload") or {}
            kind = entry.get("type")
            if kind == "session_meta":
                session_id = payload.get("session_id") or payload.get("id") or session_id
                cwd = payload.get("cwd") or cwd
                continue
            if kind == "turn_context":
                model = payload.get("model") or model
                cwd = payload.get("cwd") or cwd
                continue
            if kind != "event_msg" or payload.get("type") != "token_count":
                continue

            stamp = str(entry.get("timestamp") or "")
            day = stamp[:10]
            if not day:
                continue
            info = (payload.get("info") or {}).get("total_token_usage") or {}
            current = _codex_usage(info)
            delta = {f: max(0, current[f] - prev[f]) for f in TOKEN_FIELDS}
            prev = current
            if day_cut and day < day_cut:
                continue   # outside the window, but `prev` must still advance
            last_activity = max(last_activity, stamp)
            acc.add(day=day, agent="codex", model=model,
                    project=_project_of(cwd), tokens=delta)
            for field in TOKEN_FIELDS:
                totals[field] += delta[field]

    if any(totals.values()):
        acc.session(session_id, agent="codex", model=model, cwd=cwd,
                    project=_project_of(cwd), title=_project_of(cwd),
                    last_activity=last_activity, **totals)


# ── opencode ────────────────────────────────────────────────────────────────
# ~/.local/share/opencode/opencode.db — the session table already holds cost,
# tokens and title. There is no per-day breakdown, so everything lands on the day
# of last activity. **Cost comes from opencode itself** — it knows its own model
# better than our table does, so the row carries that cost and the backend does
# not re-price it.

# Columns we would like. opencode's schema moves between versions — two hosts in
# the fleet had no `model` column at all — so the query is built from what the
# table actually has. A missing column must cost us the field, not the host.
_OPENCODE_WANTED = (
    "id", "title", "directory", "model", "agent", "cost",
    "tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write",
    "time_updated",
)


def _opencode_query(conn) -> tuple:
    """(sql, columns) for whatever this opencode version stores."""
    have = {row[1] for row in conn.execute("PRAGMA table_info(session)")}
    columns = [c for c in _OPENCODE_WANTED if c in have]
    if "id" not in columns or "time_updated" not in columns:
        raise sqlite3.Error("session table lacks id/time_updated")
    return f"SELECT {', '.join(columns)} FROM session WHERE time_updated IS NOT NULL", columns


def _opencode_model(raw) -> str:
    """opencode stores model as JSON, not a name — `{"id":"glm-5.2",…}`.

    Left as-is, one model splits into several rows whenever a sibling field
    differs. glm-5.2 showed up as three separate rows before this.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except ValueError:
            return text[:60]
        if isinstance(parsed, dict):
            return str(parsed.get("id") or parsed.get("model") or "")[:60]
    return text[:60]


def _collect_opencode(acc: Accumulator, home: str, day_cut, ts_cut) -> None:
    path = os.path.join(home, ".local", "share", "opencode", "opencode.db")
    if not os.path.isfile(path):
        return
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=3)
    except sqlite3.Error as e:
        acc.warnings.append(f"opencode: cannot open DB ({e})")
        return
    try:
        sql, columns = _opencode_query(conn)
        rows = [dict(zip(columns, row)) for row in conn.execute(sql).fetchall()]
    except sqlite3.Error as e:
        # Unreadable WAL or a table we don't recognise — keep the other agents alive.
        acc.warnings.append(f"opencode: read failed ({e})")
        return
    finally:
        conn.close()

    for row in rows:
        sid = row.get("id")
        title = row.get("title")
        directory = row.get("directory")
        model = row.get("model")
        cost = row.get("cost")
        t_in, t_out = row.get("tokens_input"), row.get("tokens_output")
        t_cread, t_cwrite = row.get("tokens_cache_read"), row.get("tokens_cache_write")
        updated = _int(row.get("time_updated")) / 1000.0
        if ts_cut and updated < ts_cut:
            continue
        day = datetime.fromtimestamp(updated, timezone.utc).date().isoformat()
        tokens = {
            "input": _int(t_in), "output": _int(t_out),
            "cache_read": _int(t_cread), "cache_creation": _int(t_cwrite),
        }
        project = _project_of(directory or "")
        model_name = _opencode_model(model)
        cost_usd = float(cost or 0) or None
        acc.add(day=day, agent="opencode", model=model_name, project=project,
                tokens=tokens, cost=cost_usd)
        acc.session(sid, agent="opencode", model=model_name, cwd=directory or "",
                    project=project, title=_clip(title or project),
                    last_activity=datetime.fromtimestamp(updated, timezone.utc).isoformat(),
                    cost=cost_usd, **tokens)


# ── entry point ─────────────────────────────────────────────────────────────

_SOURCES = (
    ("claude", _collect_claude),
    ("codex", _collect_codex),
    ("opencode", _collect_opencode),
)


def collect(days: int = 30, home: str | None = None, titles: bool = True) -> dict:
    """Walk all three agents. One broken source must not kill the rest.

    `titles=False` strips session titles from the result. A title is the user's
    own prompt text ("fix the VNC crop on mobile"), and prompt text should not
    leave the machine it was typed on — remote collection runs with titles off.
    Numbers, model names and the project directory still come back; those are the
    result, not the content.
    """
    home = home or os.path.expanduser("~")
    day_cut, ts_cut = _cutoff(days)
    acc = Accumulator()
    for name, fn in _SOURCES:
        try:
            fn(acc, home, day_cut, ts_cut)
        except Exception as e:                      # noqa: BLE001 — see docstring
            acc.warnings.append(f"{name}: {type(e).__name__}: {e}")
    payload = acc.payload(days)
    if not titles:
        for session in payload["sessions"]:
            session["title"] = ""
    return payload


def main() -> int:
    try:
        days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    except ValueError:
        days = 30
    # `notitle` — prompt text stays on the machine it was typed on.
    titles = "notitle" not in sys.argv[2:]
    try:
        payload = collect(days, titles=titles)
    except Exception as e:                          # noqa: BLE001
        payload = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(OUTPUT_MARKER + "\n")
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
