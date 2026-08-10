"""호스트를 지워도 사용량은 보관 기간 동안 남는다 — 그리고 기간이 끝나면 사라진다.

지난달 비용이 삭제 한 번으로 증발하면 되돌릴 방법이 없다. 반대로 영영 남기면 유령이
쌓인다(실제로 그랬다). 여기서 지키는 선은 그 둘 사이다.
"""
from datetime import UTC, datetime, timedelta

import pytest

from llm_usage.service import RETIRED_RETENTION_DAYS, _retired_days_left
from sqlite_storage import SQLiteStorage

USER = "u1"
SRC = "host-1"


@pytest.fixture
def store(tmp_path):
    return SQLiteStorage(str(tmp_path / "t.db"))


async def _seed(store):
    await store.mark_llm_source(USER, SRC, name="box", ok=True)
    await store.upsert_llm_daily(USER, SRC, [
        {"day": "2026-08-01", "agent": "claude", "model": "opus", "project": "p",
         "input": 1, "output": 2, "cache_read": 0, "cache_creation": 0, "cost": 0.5},
    ])


@pytest.mark.asyncio
async def test_retire_marks_without_deleting_data(store):
    await _seed(store)
    await store.retire_llm_source(USER, SRC)

    sources = await store.get_llm_sources(USER)
    assert sources[SRC]["retired_at"], "은퇴 시각이 찍혀야 한다"
    assert len(await store.query_llm_daily(USER)) == 1, "데이터는 그대로 남는다"


@pytest.mark.asyncio
async def test_retire_is_idempotent(store):
    """두 번 지워도 시계가 다시 돌지 않는다 — 보관 기간이 무한정 밀리면 안 된다."""
    await _seed(store)
    await store.retire_llm_source(USER, SRC)
    first = (await store.get_llm_sources(USER))[SRC]["retired_at"]
    await store.retire_llm_source(USER, SRC)
    assert (await store.get_llm_sources(USER))[SRC]["retired_at"] == first


@pytest.mark.asyncio
async def test_successful_collection_unretires(store):
    """수집에 성공했다는 건 살아 돌아왔다는 뜻이다. 표시를 남겨두면 조용히 지워진다."""
    await _seed(store)
    await store.retire_llm_source(USER, SRC)
    await store.mark_llm_source(USER, SRC, name="box", ok=True)
    assert (await store.get_llm_sources(USER))[SRC]["retired_at"] is None


@pytest.mark.asyncio
async def test_retire_does_not_create_a_source(store):
    """수집된 적 없는 호스트를 지우면서 유령을 새로 만들 이유가 없다."""
    await store.retire_llm_source(USER, "never-collected")
    assert "never-collected" not in await store.get_llm_sources(USER)


@pytest.mark.asyncio
async def test_expiry_list_respects_the_cutoff(store):
    await _seed(store)
    await store.retire_llm_source(USER, SRC)
    now = datetime.now(UTC)

    fresh = (now - timedelta(days=RETIRED_RETENTION_DAYS)).isoformat()
    assert await store.list_expired_llm_sources(USER, fresh) == []

    later = (now + timedelta(days=1)).isoformat()
    assert await store.list_expired_llm_sources(USER, later) == [SRC]


@pytest.mark.asyncio
async def test_purge_clears_all_three_tables(store):
    """한 표에는 있고 한 표에는 없는 상태는 유령보다 헷갈린다 — 셋이 같이 사라져야 한다."""
    await _seed(store)
    await store.upsert_llm_sessions(USER, SRC, [
        {"session_id": "s1", "agent": "claude", "model": "opus", "project": "p",
         "cwd": "/w", "title": "t", "last_activity": "2026-08-01T00:00:00Z",
         "input": 1, "output": 1, "cache_read": 0, "cache_creation": 0, "cost": 0.1},
    ])

    removed = await store.purge_llm_source(USER, SRC)

    assert removed["daily"] == 1
    assert removed["sessions"] == 1
    assert await store.query_llm_daily(USER) == []
    assert SRC not in await store.get_llm_sources(USER)


@pytest.mark.asyncio
async def test_purge_leaves_other_sources_alone(store):
    await _seed(store)
    await store.mark_llm_source(USER, "other", name="other", ok=True)
    await store.upsert_llm_daily(USER, "other", [
        {"day": "2026-08-01", "agent": "claude", "model": "opus", "project": "p",
         "input": 9, "output": 9, "cache_read": 0, "cache_creation": 0, "cost": 1.0},
    ])

    await store.purge_llm_source(USER, SRC)

    assert [r["source_id"] for r in await store.query_llm_daily(USER)] == ["other"]


def test_days_left_counts_down_and_floors_at_zero():
    now = datetime.now(UTC)
    assert _retired_days_left(None) is None
    assert _retired_days_left(now.isoformat()) == RETIRED_RETENTION_DAYS
    assert _retired_days_left((now - timedelta(days=10)).isoformat()) == RETIRED_RETENTION_DAYS - 10
    assert _retired_days_left((now - timedelta(days=999)).isoformat()) == 0


def test_days_left_treats_garbage_as_expired():
    """읽을 수 없는 값 때문에 영원히 안 지워지는 행이 생기면 안 된다."""
    assert _retired_days_left("nonsense") == 0
