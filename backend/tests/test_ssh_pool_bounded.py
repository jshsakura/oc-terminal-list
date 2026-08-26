"""SSH 풀은 어떤 자리에서도 무한히 기다리지 않는다.

⚠️ **실측 사고(2026-08-27 오전).** 앱이 멍해졌다. 원인은 `get()` 이 **per-host 잠금을
쥔 채** 상한 없는 opener 를 기다린 것이다. 거기서 멈추면 그 호스트로 가는 모든 후속
요청이 잠금 뒤에 쌓이는데, 홈 화면이 tmux 세션 목록을 주기적으로 폴링하므로 **폴링마다
태스크가 하나씩 영구히** 늘었다. 종료 로그에 `Cancel 97 running task(s)` 가 남았다.

그리고 멈춤은 **예외가 아니라서** 실패 캐시에도 안 걸렸다 — 캐시는 예외에만 반응한다.
상한을 두면 멈춤이 예외가 되고, 그 순간 캐시가 받아 다음 폴링을 막는다.
"""
from __future__ import annotations

import asyncio

import pytest

import ssh_pool as module


@pytest.fixture
def pool(monkeypatch):
    monkeypatch.setattr(module, "_CONNECT_TIMEOUT", 0.05)
    monkeypatch.setattr(module, "_COMMAND_TIMEOUT", 0.05)
    monkeypatch.setattr(module, "_CLOSE_TIMEOUT", 0.05)
    return module._Pool()


class _Conn:
    def __init__(self, hang_run=False, hang_close=False):
        self._hang_run = hang_run
        self._hang_close = hang_close
        self.closed = False

    def is_closing(self):
        return False

    async def run(self, cmd, **kwargs):
        if self._hang_run:
            await asyncio.sleep(3600)
        return type("R", (), {"stdout": "ok"})()

    def close(self):
        self.closed = True

    async def wait_closed(self):
        if self._hang_close:
            await asyncio.sleep(3600)


async def _hanging_opener():
    await asyncio.sleep(3600)


async def test_a_hanging_connect_gives_up_instead_of_holding_the_lock(pool):
    with pytest.raises(ConnectionError):
        await asyncio.wait_for(pool.get("h1", _hanging_opener), timeout=2)


async def test_the_lock_is_free_afterwards(pool):
    """⚠️ 이것이 사고의 핵심이다. 잠금이 안 풀리면 그 호스트로 가는 요청이 **전부** 쌓인다."""
    with pytest.raises(ConnectionError):
        await pool.get("h1", _hanging_opener)

    async def _good():
        return _Conn()

    # 잠금이 풀렸으면 곧바로 열린다.
    conn = await asyncio.wait_for(pool.get("h1", _good), timeout=2)
    assert isinstance(conn, _Conn)


async def test_many_waiters_do_not_pile_up_forever(pool):
    """폴링이 겹치는 상황 — 멈춘 호스트에 요청이 쌓이면 그게 곧 이벤트 루프 적체다."""
    tasks = [asyncio.create_task(pool.get("h1", _hanging_opener)) for _ in range(5)]
    done, pending = await asyncio.wait(tasks, timeout=3)
    assert not pending, "대기자가 남았다 — 잠금이 안 풀렸다는 뜻"
    assert all(isinstance(t.exception(), ConnectionError) for t in done)


async def test_a_hanging_command_times_out(pool):
    """반쯤 죽은 연결에서 `conn.run` 은 오지 않을 답을 기다린다."""
    async def _opener():
        return _Conn(hang_run=True)

    with pytest.raises(Exception):
        await asyncio.wait_for(pool.run("h1", _opener, "tmux ls"), timeout=3)


async def test_closing_a_dead_peer_does_not_hang(pool):
    """끊긴 망에서 `wait_closed()` 는 안 돌아올 수 있다."""
    conn = _Conn(hang_close=True)

    async def _opener():
        return conn

    await pool.get("h1", _opener)
    await asyncio.wait_for(pool.invalidate("h1"), timeout=2)
    assert conn.closed


async def test_close_all_is_bounded(pool):
    conn = _Conn(hang_close=True)

    async def _opener():
        return conn

    await pool.get("h1", _opener)
    await asyncio.wait_for(pool.close_all(), timeout=2)
