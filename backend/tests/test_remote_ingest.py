"""리모트가 밀어 준 상태 → 전이 계산 → 알림. **폴링이 없다.**"""
from __future__ import annotations

import asyncio

import pytest

import agent_status_events
from remote_agent import ingest

HOST = "h1"


@pytest.fixture(autouse=True)
def _clean():
    ingest.forget(HOST)
    ingest.set_change_handler(None)
    yield
    ingest.forget(HOST)
    ingest.set_change_handler(None)


def _pane(session, title, command="claude"):
    return f"{session}\t1\t{command}\t/tmp\t{title}"


async def _send(kind, message=None, seen=None):
    if seen is not None:
        async def handler(host_id, changes):
            seen.extend(changes)
        ingest.set_change_handler(handler)
    await ingest.handle_event(HOST, kind, message or {})


async def test_a_transition_reaches_the_handler():
    seen = []
    await _send("server", seen=seen)
    await _send("panes", {"lines": [_pane("mobile", "⠋ building")]}, seen=seen)
    await _send("panes", {"lines": [_pane("mobile", "✳ done")]}, seen=seen)
    completed = [c for c in seen if c.get("completed")]
    assert completed and completed[0]["sessionId"] == "mobile"


async def test_changes_carry_the_host():
    """⚠️ 원격 sessionId 는 그 호스트의 tmux 세션명이라 호스트가 다르면 겹친다.
    hostId 가 없으면 한쪽의 완료가 다른 쪽 지문을 덮어 알림이 조용히 사라진다."""
    seen = []
    await _send("panes", {"lines": [_pane("mobile", "⠋ x")]}, seen=seen)
    assert all(c["hostId"] == HOST for c in seen)


async def test_a_missing_tmux_server_is_not_zero_panes():
    """⚠️ "tmux 가 없다" 를 "pane 0개" 로 접으면 사라진 pane 들이 전이로 계산되어
    **있지도 않은 완료 알림**이 나간다."""
    seen = []
    await _send("panes", {"lines": [_pane("mobile", "⠋ x")]}, seen=seen)
    seen.clear()
    await _send("no-server", seen=seen)
    assert seen == []


async def test_status_is_readable_without_asking_the_host():
    """`itl list` 가 SSH 없이 상태를 읽는 자리 — 이게 되면 원격 `?` 가 사라진다."""
    await _send("server")
    await _send("panes", {"lines": [_pane("mobile", "⠋ building")]})
    table = ingest.snapshot(HOST)
    assert table["mobile"]["status"] == "working"
    assert ingest.has_live_state(HOST) is True


async def test_an_unknown_host_has_no_live_state():
    """리모트가 없으면 "모른다" 여야 한다 — 빈 표를 "일 안 함" 으로 읽으면 안 된다."""
    assert ingest.snapshot("nobody") == {}
    assert ingest.has_live_state("nobody") is False


async def test_waiters_wake_on_change_not_on_a_timer():
    """폴링의 반대 — 변화가 있을 때만 깨어난다."""
    waiter = asyncio.create_task(agent_status_events.wait_for_change(5))
    await asyncio.sleep(0)
    await _send("panes", {"lines": [_pane("mobile", "⠋ x")]})
    assert await asyncio.wait_for(waiter, timeout=2) is True


async def test_waiting_times_out_quietly_when_nothing_happens():
    assert await agent_status_events.wait_for_change(0.05) is False


async def test_waiters_do_not_leak():
    """⚠️ 깨어나거나 상한에 닿은 뒤에도 남아 있으면, 오래 도는 서버에서 조용히 쌓인다."""
    before = agent_status_events.waiter_count()
    await agent_status_events.wait_for_change(0.01)
    waiter = asyncio.create_task(agent_status_events.wait_for_change(5))
    await asyncio.sleep(0)
    agent_status_events.wake()
    await waiter
    assert agent_status_events.waiter_count() == before
