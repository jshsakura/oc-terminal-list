"""Accumulation: what we collected once stays ours.

The agents' logs expire — Claude Code prunes old transcripts, a retired host takes
its history along — so re-reading the source every time can only ever show what is
still on disk. These tests pin the two rules that make storage worth having:

  - collecting the same day twice overwrites that day (never doubles it)
  - a short window never erases the days outside it
"""
import pytest

from sqlite_storage import SQLiteStorage


@pytest.fixture
def store(tmp_path):
    return SQLiteStorage(str(tmp_path / "t.db"))   # SchemaMixin creates every table


def row(day, agent="claude", model="claude-opus-5", project="app", output=10, cost=None):
    return {"day": day, "agent": agent, "model": model, "project": project,
            "input": 0, "output": output, "cache_read": 0, "cache_creation": 0, "cost": cost}


@pytest.mark.anyio
async def test_same_day_collected_twice_is_not_doubled(store):
    await store.upsert_llm_daily("u", "local", [row("2026-08-05", output=10)])
    await store.upsert_llm_daily("u", "local", [row("2026-08-05", output=10)])

    rows = await store.query_llm_daily("u")
    assert len(rows) == 1
    assert rows[0]["output"] == 10          # not 20


@pytest.mark.anyio
async def test_a_later_collection_corrects_the_day(store):
    """The day is not over when we first read it — the second read must win."""
    await store.upsert_llm_daily("u", "local", [row("2026-08-05", output=10)])
    await store.upsert_llm_daily("u", "local", [row("2026-08-05", output=42)])

    rows = await store.query_llm_daily("u")
    assert rows[0]["output"] == 42


@pytest.mark.anyio
async def test_a_narrow_window_does_not_erase_older_days(store):
    await store.upsert_llm_daily("u", "local", [row("2026-06-01"), row("2026-08-05")])
    # A later 7-day collection only carries recent rows.
    await store.upsert_llm_daily("u", "local", [row("2026-08-05", output=99)])

    days = sorted(r["day"] for r in await store.query_llm_daily("u"))
    assert days == ["2026-06-01", "2026-08-05"]


@pytest.mark.anyio
async def test_rows_are_scoped_per_source_and_user(store):
    await store.upsert_llm_daily("u", "local", [row("2026-08-05")])
    await store.upsert_llm_daily("u", "rpi", [row("2026-08-05")])
    await store.upsert_llm_daily("other", "local", [row("2026-08-05")])

    assert len(await store.query_llm_daily("u")) == 2
    assert len(await store.query_llm_daily("other")) == 1


@pytest.mark.anyio
async def test_since_day_filters_the_window(store):
    await store.upsert_llm_daily("u", "local", [row("2026-06-01"), row("2026-08-05")])

    recent = await store.query_llm_daily("u", "2026-08-01")
    assert [r["day"] for r in recent] == ["2026-08-05"]


@pytest.mark.anyio
async def test_a_remote_collection_never_wipes_a_title_it_cannot_send(store):
    """Remote collection strips prompt text, so its blank title must not overwrite
    the one a local collection already stored."""
    await store.upsert_llm_sessions("u", "rpi", [
        {"session_id": "s1", "title": "포트 정리", "last_activity": "2026-08-05T00:00:00Z", "output": 1},
    ])
    await store.upsert_llm_sessions("u", "rpi", [
        {"session_id": "s1", "title": "", "last_activity": "2026-08-05T01:00:00Z", "output": 2},
    ])

    sessions = await store.query_llm_sessions("u")
    assert sessions[0]["title"] == "포트 정리"
    assert sessions[0]["output"] == 2


@pytest.mark.anyio
async def test_source_status_records_success_and_failure(store):
    from llm_usage.service import _is_due

    await store.mark_llm_source("u", "rpi", name="rpi", ok=False, error="SSH 실패")
    meta = await store.get_llm_sources("u")
    assert meta["rpi"]["last_error"] == "SSH 실패"
    # A failed attempt does not count as collected — it must be retried.
    assert _is_due(meta["rpi"]["last_ok_at"]) is True

    await store.mark_llm_source("u", "rpi", name="rpi", ok=True, error=None)
    meta = await store.get_llm_sources("u")
    assert _is_due(meta["rpi"]["last_ok_at"]) is False   # once a day is enough
