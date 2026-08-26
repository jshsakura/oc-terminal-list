"""리모트 통로 관리 — 없는 것을 있다고 하지 않는가."""
from __future__ import annotations

import asyncio

import pytest

from remote_agent import registry


@pytest.fixture(autouse=True)
def _clean():
    registry.clear()
    yield
    registry.clear()


def _conn(host_id="h1", sink=None, fail=False):
    async def send(message):
        if fail:
            raise ConnectionError("gone")
        (sink if sink is not None else []).append(message)

    return registry.RemoteConnection(host_id, "jsh", send)


async def test_an_absent_remote_is_none_not_a_silent_success():
    assert registry.get("nobody") is None


async def test_attach_and_get():
    conn = _conn()
    registry.attach(conn)
    assert registry.get("h1") is conn
    assert registry.connected_host_ids() == ["h1"]


async def test_a_second_remote_for_one_host_replaces_the_first():
    """재부팅 뒤 옛 프로세스가 남으면 상태가 두 벌 들어와 전이가 덧그려진다."""
    first, second = _conn(), _conn()
    registry.attach(first)
    previous = registry.attach(second)
    assert previous is first
    assert first.closed
    assert registry.get("h1") is second


async def test_detach_does_not_remove_a_newer_connection():
    """⚠️ 옛 연결의 정리 코드가 늦게 돌아도 살아 있는 새 통로를 지우면 안 된다."""
    first, second = _conn(), _conn()
    registry.attach(first)
    registry.attach(second)
    registry.detach(first)
    assert registry.get("h1") is second


async def test_a_failed_send_marks_the_connection_closed():
    conn = _conn(fail=True)
    registry.attach(conn)
    assert await conn.send({"t": "ping"}) is False
    assert registry.get("h1") is None


async def test_request_times_out_instead_of_hanging():
    """상한이 없으면 끊긴 리모트 하나가 알림 경로를 통째로 멈춘다."""
    conn = _conn()
    registry.attach(conn)
    result = await asyncio.wait_for(
        conn.request({"t": "excerpt"}, key="excerpt:s1", timeout=0.05), timeout=2,
    )
    assert result is None


async def test_request_is_answered():
    conn = _conn()
    registry.attach(conn)
    task = asyncio.create_task(conn.request({"t": "excerpt"}, key="k", timeout=2))
    await asyncio.sleep(0)
    assert conn.resolve("k", {"text": "hello"})
    assert await task == {"text": "hello"}


async def test_closing_wakes_waiters_instead_of_making_them_wait_out_the_timeout():
    conn = _conn()
    registry.attach(conn)
    task = asyncio.create_task(conn.request({"t": "excerpt"}, key="k", timeout=30))
    await asyncio.sleep(0)
    registry.detach(conn)
    assert await asyncio.wait_for(task, timeout=2) is None
