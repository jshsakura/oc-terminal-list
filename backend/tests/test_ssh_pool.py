"""
ssh_pool._Pool 의 핵심 동작:

  - get: 같은 host_id 두 번째 호출은 opener 다시 안 부르고 cached conn 반환
  - get: cached conn 이 is_closing() True 면 새로 생성
  - run: 첫 시도 실패 → invalidate → 한 번 재시도 후 성공
  - run: 두 번 다 실패 → 예외 propagate
  - invalidate: 풀에서 제거 + close 호출
  - close_all: 풀 비우고 모든 conn close
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from ssh_pool import _Pool


def _fake_conn(alive=True, run_returns=None, run_raises=None):
    conn = MagicMock()
    conn.is_closing = MagicMock(return_value=not alive)
    if run_raises:
        conn.run = AsyncMock(side_effect=run_raises)
    else:
        conn.run = AsyncMock(return_value=run_returns or MagicMock(stdout="ok"))
    conn.close = MagicMock()
    conn.wait_closed = AsyncMock()
    return conn


@pytest.mark.asyncio
async def test_get_reuses_cached_connection():
    pool = _Pool()
    conn = _fake_conn(alive=True)
    opener = AsyncMock(return_value=conn)
    first = await pool.get("h1", opener)
    second = await pool.get("h1", opener)
    assert first is second
    opener.assert_awaited_once()  # 재사용 — opener 한 번만 호출


@pytest.mark.asyncio
async def test_get_creates_new_when_conn_is_closing():
    pool = _Pool()
    dead = _fake_conn(alive=False)
    fresh = _fake_conn(alive=True)
    opener = AsyncMock(side_effect=[dead, fresh])
    first = await pool.get("h1", opener)
    assert first is dead
    # 두 번째 호출 — dead.is_closing() True → 새로 생성
    second = await pool.get("h1", opener)
    assert second is fresh
    assert opener.await_count == 2
    dead.close.assert_called_once()


@pytest.mark.asyncio
async def test_run_succeeds_first_try():
    pool = _Pool()
    conn = _fake_conn(alive=True, run_returns=MagicMock(stdout="hello"))
    opener = AsyncMock(return_value=conn)
    result = await pool.run("h1", opener, "echo hello")
    assert result.stdout == "hello"
    conn.run.assert_awaited_once_with("echo hello")


@pytest.mark.asyncio
async def test_run_retries_once_on_failure():
    pool = _Pool()
    failing = _fake_conn(alive=True, run_raises=ConnectionError("dead"))
    succeeding = _fake_conn(alive=True, run_returns=MagicMock(stdout="recovered"))
    opener = AsyncMock(side_effect=[failing, succeeding])
    result = await pool.run("h1", opener, "ls")
    assert result.stdout == "recovered"
    assert opener.await_count == 2  # invalidate 후 새 opener 호출
    failing.run.assert_awaited_once()
    succeeding.run.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_raises_when_both_attempts_fail():
    pool = _Pool()
    fail1 = _fake_conn(alive=True, run_raises=ConnectionError("fail1"))
    fail2 = _fake_conn(alive=True, run_raises=ConnectionError("fail2"))
    opener = AsyncMock(side_effect=[fail1, fail2])
    with pytest.raises(ConnectionError, match="fail2"):
        await pool.run("h1", opener, "ls")
    assert opener.await_count == 2


@pytest.mark.asyncio
async def test_invalidate_removes_entry_and_closes_conn():
    pool = _Pool()
    conn = _fake_conn(alive=True)
    opener = AsyncMock(return_value=conn)
    await pool.get("h1", opener)
    await pool.invalidate("h1")
    conn.close.assert_called_once()
    # 다음 get 은 새 conn 생성
    fresh = _fake_conn(alive=True)
    opener2 = AsyncMock(return_value=fresh)
    second = await pool.get("h1", opener2)
    assert second is fresh
    opener2.assert_awaited_once()


@pytest.mark.asyncio
async def test_invalidate_on_unknown_host_is_noop():
    pool = _Pool()
    # 풀에 없는 host_id — 예외 없이 그냥 통과
    await pool.invalidate("unknown")


@pytest.mark.asyncio
async def test_close_all_closes_every_conn_and_clears_pool():
    pool = _Pool()
    conn_a = _fake_conn(alive=True)
    conn_b = _fake_conn(alive=True)
    await pool.get("a", AsyncMock(return_value=conn_a))
    await pool.get("b", AsyncMock(return_value=conn_b))
    await pool.close_all()
    conn_a.close.assert_called_once()
    conn_b.close.assert_called_once()
    # 풀이 비었는지 — 새 get 은 새 opener 호출
    fresh = _fake_conn(alive=True)
    opener = AsyncMock(return_value=fresh)
    await pool.get("a", opener)
    opener.assert_awaited_once()
