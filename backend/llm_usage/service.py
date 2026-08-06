"""Collect once a day, read from our own DB.

**The dashboard never waits for SSH.** It reads `llm_usage_daily`, which is ours
and instant. Collection is a separate, throttled act.

Why store instead of re-reading the logs every time:

- The agents' logs expire. Claude Code prunes old transcripts by itself, and a
  retired host takes its history with it. What we collected once stays ours.
- Re-walking hundreds of files for a 90-day window is slow enough to feel.

**No poller.** Collection is triggered by the app being used — opening a terminal
is enough (`maybe_collect_in_background`) — and each source is collected at most
once a day. A missed day is not lost: every collection reads a wide window, so
the next run backfills the gap. Only being away longer than the logs survive
loses anything, and nothing can fix that from here.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlite_storage import storage

from .aggregate import merge_sessions, merge_summaries
from .config import get_config as get_usage_config
from .fx import get_rates
from .runner import CollectFailed, run_local, run_remote

logger = logging.getLogger(__name__)

LOCAL_SOURCE_ID = "local"
LOCAL_LABEL = "이 서버"

# One collection per source per day. Manual refresh ignores it.
COLLECT_INTERVAL_SECONDS = 24 * 60 * 60
# Every collection reads this far back, so a skipped day is filled in by the next
# run. Cheap: files older than the cutoff are never opened.
COLLECT_WINDOW_DAYS = 90

ALLOWED_DAYS = (0, 7, 30, 90)
DEFAULT_DAYS = 7
# Fleets grow; don't open thirty SSH connections at once.
MAX_CONCURRENT_HOSTS = 6
SESSION_LIMIT = 50

# One collection at a time per user — the trigger is app usage, and a burst of
# tabs opening must not become a burst of SSH fan-outs.
_running: set[str] = set()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_days(days) -> int:
    try:
        value = int(days)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return value if value in ALLOWED_DAYS else DEFAULT_DAYS


def _since_day(days: int) -> str | None:
    if days <= 0:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()


def _is_due(last_ok_at: str | None) -> bool:
    if not last_ok_at:
        return True
    try:
        last = datetime.fromisoformat(last_ok_at)
    except (TypeError, ValueError):
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last).total_seconds() >= COLLECT_INTERVAL_SECONDS


# ── collection ──────────────────────────────────────────────────────────────

async def _store(username: str, source_id: str, name: str, payload: dict) -> None:
    await storage.upsert_llm_daily(username, source_id, payload.get("rows") or [])
    await storage.upsert_llm_sessions(username, source_id, payload.get("sessions") or [])
    await storage.mark_llm_source(username, source_id, name=name, ok=True, error=None)


async def _collect_local(username: str) -> None:
    try:
        payload = await run_local(COLLECT_WINDOW_DAYS)
    except CollectFailed as e:
        await storage.mark_llm_source(username, LOCAL_SOURCE_ID, name=LOCAL_LABEL,
                                      ok=False, error=str(e))
        return
    await _store(username, LOCAL_SOURCE_ID, LOCAL_LABEL, payload)


async def _collect_host(username: str, host: dict, gate: asyncio.Semaphore) -> None:
    from host_common import resolve_host_with_secrets

    name = host.get("name") or host.get("hostname") or host["id"]
    try:
        async with gate:
            resolved, secrets = await resolve_host_with_secrets(host["id"], username)
            payload = await run_remote(resolved, secrets, COLLECT_WINDOW_DAYS)
    except CollectFailed as e:
        await storage.mark_llm_source(username, host["id"], name=name, ok=False, error=str(e))
        return
    except Exception as e:  # credential resolution and friends
        logger.warning("llm usage collect failed (%s): %s", host.get("id"), e)
        await storage.mark_llm_source(username, host["id"], name=name, ok=False,
                                      error=f"조회 실패: {e}")
        return
    await _store(username, host["id"], name, payload)


async def collect_all(username: str, force: bool = False) -> dict:
    """Collect from every source that is due (or from all of them, when forced)."""
    sources = await storage.get_llm_sources(username)
    gate = asyncio.Semaphore(MAX_CONCURRENT_HOSTS)
    tasks = []
    if force or _is_due((sources.get(LOCAL_SOURCE_ID) or {}).get("last_ok_at")):
        tasks.append(_collect_local(username))
    for host in await storage.list_hosts(username):
        if force or _is_due((sources.get(host["id"]) or {}).get("last_ok_at")):
            tasks.append(_collect_host(username, host, gate))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    return {"collected": len(tasks)}


async def maybe_collect_in_background(username: str) -> None:
    """Fire-and-forget, called when the app is used — opening a terminal is enough.

    Cheap when there is nothing to do: it reads one small table and returns, so it
    can sit on a hot path. Never raises into its caller.
    """
    if not username or username in _running:
        return
    try:
        config = await get_usage_config()
        if not config.get("enabled"):
            return
        sources = await storage.get_llm_sources(username)
        hosts = await storage.list_hosts(username)
    except Exception:  # noqa: BLE001 — a stats read must never break a terminal
        return
    due = _is_due((sources.get(LOCAL_SOURCE_ID) or {}).get("last_ok_at")) or any(
        _is_due((sources.get(h["id"]) or {}).get("last_ok_at")) for h in hosts
    )
    if not due:
        return

    async def _run():
        _running.add(username)
        try:
            await collect_all(username)
        except Exception as e:  # noqa: BLE001
            logger.warning("background llm collect failed: %s", e)
        finally:
            _running.discard(username)

    asyncio.create_task(_run())


# ── read ────────────────────────────────────────────────────────────────────

def _as_source(rows: list, sessions: list, meta: dict, source_id: str,
               session_count: int = 0) -> dict:
    info = meta.get(source_id) or {}
    return {
        "source_id": source_id,
        "label": info.get("name") or source_id,
        "ok": bool(info.get("last_ok_at")),
        "error": info.get("last_error"),
        "fetched_at": info.get("last_ok_at") or info.get("last_try_at"),
        "payload": {
            "rows": rows,
            "sessions": sessions,
            "session_count": session_count or len(sessions),
            "warnings": [],
        },
    }


async def get_usage(username: str, days: int = DEFAULT_DAYS, force: bool = False) -> dict:
    """What the dashboard draws. Reads the DB; only `force` touches the network."""
    days = normalize_days(days)
    config = await get_usage_config()
    if not config["enabled"]:
        return {**merge_summaries([]), "sessions": [], "days": days,
                "fetched_at": _now_iso(), "enabled": False, "fx": {}}

    if force:
        # The only path that waits for the network — a person pressed refresh.
        await collect_all(username, force=True)
    else:
        # Opening the dashboard also counts as using the app. Schedules at most
        # one collection a day and returns immediately; the numbers on screen come
        # from the DB either way.
        await maybe_collect_in_background(username)

    since = _since_day(days)
    rows = await storage.query_llm_daily(username, since)
    sessions = await storage.query_llm_sessions(username, since, SESSION_LIMIT)
    counts = await storage.count_llm_sessions(username, since)
    meta = await storage.get_llm_sources(username)

    grouped_rows: dict[str, list] = {}
    for row in rows:
        grouped_rows.setdefault(row["source_id"], []).append(row)
    grouped_sessions: dict[str, list] = {}
    for session in sessions:
        grouped_sessions.setdefault(session["source_id"], []).append(session)

    # A source we have ever heard of stays listed even with nothing this window —
    # "that host is quiet" and "that host is broken" must not look the same.
    ids = set(grouped_rows) | set(grouped_sessions) | set(meta)
    sources = [
        _as_source(grouped_rows.get(sid, []), grouped_sessions.get(sid, []), meta, sid,
                   counts.get(sid, 0))
        for sid in sorted(ids)
    ]

    return {
        **merge_summaries(sources),
        "sessions": merge_sessions(sources, SESSION_LIMIT),
        "days": days,
        "fetched_at": _now_iso(),
        "enabled": True,
        "fx": await get_rates(),
    }
