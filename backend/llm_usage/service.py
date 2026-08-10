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
from datetime import UTC, datetime, timedelta

from sqlite_storage import storage

from .aggregate import merge_sessions, merge_summaries
from .config import get_config as get_usage_config
from .fx import get_rates
from .runner import CollectFailed, run_local, run_remote
from .sync import load_prices

logger = logging.getLogger(__name__)

LOCAL_SOURCE_ID = "local"
LOCAL_LABEL = "이 서버"

# One collection per source per day. Manual refresh ignores it.
COLLECT_INTERVAL_SECONDS = 24 * 60 * 60
# A source that failed is retried sooner than a day — but not on every collection.
# A NAS with no agent logs, or a host that is simply off, would otherwise cost the
# full SSH timeout every single time just to fail the same way again.
FAILURE_RETRY_SECONDS = 6 * 60 * 60
# Every collection reads this far back, so a skipped day is filled in by the next
# run. Cheap: files older than the cutoff are never opened.
COLLECT_WINDOW_DAYS = 90

# 호스트를 지워도 그 사용량은 이만큼 남는다. 지난달 비용이 삭제 한 번으로 증발하면
# 되돌릴 방법이 없다 — 대신 화면에 "삭제됨(N일 후 정리)" 로 계속 보인다.
# 지금 지우고 싶으면 대시보드의 삭제 버튼이 즉시 purge 한다.
RETIRED_RETENTION_DAYS = 30

ALLOWED_DAYS = (0, 7, 30, 90)
DEFAULT_DAYS = 7
# Fleets grow; don't open thirty SSH connections at once.
MAX_CONCURRENT_HOSTS = 6
SESSION_LIMIT = 50

# One collection at a time per user — the trigger is app usage, and a burst of
# tabs opening must not become a burst of SSH fan-outs.
_running: set[str] = set()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def normalize_days(days) -> int:
    try:
        value = int(days)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return value if value in ALLOWED_DAYS else DEFAULT_DAYS


def _since_day(days: int) -> str | None:
    if days <= 0:
        return None
    return (datetime.now(UTC) - timedelta(days=days)).date().isoformat()


def _age_seconds(stamp: str | None) -> float | None:
    if not stamp:
        return None
    try:
        when = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return (datetime.now(UTC) - when).total_seconds()


def _is_due(info) -> bool:
    """Should this source be collected now?

    Succeeded recently → no; once a day is the point. **Failed recently → also no.**
    A host that is off, or a NAS that will never run an agent, must not cost the
    full SSH timeout on every collection just to fail identically again.
    """
    if info is None or isinstance(info, str):
        info = {"last_ok_at": info}
    ok_age = _age_seconds(info.get("last_ok_at"))
    if ok_age is not None and ok_age < COLLECT_INTERVAL_SECONDS:
        return False
    try_age = _age_seconds(info.get("last_try_at"))
    if ok_age is None and try_age is not None and try_age < FAILURE_RETRY_SECONDS:
        return False
    return True


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
    if force or _is_due(sources.get(LOCAL_SOURCE_ID)):
        tasks.append(_collect_local(username))
    for host in await storage.list_hosts(username):
        if force or _is_due(sources.get(host["id"])):
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
    due = _is_due(sources.get(LOCAL_SOURCE_ID)) or any(
        _is_due(sources.get(h["id"])) for h in hosts
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

def _retired_days_left(retired_at: str | None) -> int | None:
    """보관 만료까지 남은 일수. 은퇴하지 않았으면 None, 이미 지났으면 0."""
    if not retired_at:
        return None
    try:
        at = datetime.fromisoformat(retired_at)
    except ValueError:
        return 0
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    gone = (datetime.now(UTC) - at).days
    return max(0, RETIRED_RETENTION_DAYS - gone)


def _as_source(rows: list, sessions: list, meta: dict, source_id: str,
               session_count: int = 0) -> dict:
    info = meta.get(source_id) or {}
    retired_at = info.get("retired_at")
    return {
        "source_id": source_id,
        "label": info.get("name") or source_id,
        "ok": bool(info.get("last_ok_at")),
        "error": info.get("last_error"),
        "fetched_at": info.get("last_ok_at") or info.get("last_try_at"),
        # 호스트 목록에서 빠진 소스. 화면은 이걸 보고 "삭제됨 · N일 후 정리" 를 단다.
        "retired_at": retired_at,
        "retired_days_left": _retired_days_left(retired_at),
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

    # 단가는 손으로 기억하지 않는다 — 하루 한 번 받아온 표를 쓴다(실패하면 내장 표).
    await load_prices()

    # 보관 기간이 끝난 은퇴 소스를 여기서 치운다 — 폴러 없이, 화면을 열 때 한 번.
    await purge_expired_sources(username)

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


async def purge_expired_sources(username: str) -> list[str]:
    """보관 기간이 지난 은퇴 소스를 지운다. 지운 id 목록을 돌려준다.

    **폴러를 두지 않는다**(이 모듈의 규칙). 대시보드를 열 때 한 번 도는데, 작은 표
    한 번 훑는 비용이라 눈에 띄지 않는다. 앱을 안 쓰면 정리도 안 되지만 그건 문제가
    아니다 — 아무도 안 보는 데이터가 하루 더 남을 뿐이다.
    """
    cutoff = (datetime.now(UTC) - timedelta(days=RETIRED_RETENTION_DAYS)).isoformat()
    expired = await storage.list_expired_llm_sources(username, cutoff)
    for source_id in expired:
        removed = await storage.purge_llm_source(username, source_id)
        logger.info("llm usage: purged retired source %s %s", source_id, removed)
    return expired


async def purge_source(username: str, source_id: str) -> dict:
    """사용자가 지금 지우겠다고 누른 경우. 보관 기간을 기다리지 않는다."""
    removed = await storage.purge_llm_source(username, source_id)
    logger.info("llm usage: purged source %s by request %s", source_id, removed)
    return removed
