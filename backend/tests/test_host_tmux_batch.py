"""여러 호스트의 tmux 세션 조회 — **가장 느린 호스트가 전체를 붙잡지 않는다.**

⚠️ gather 는 다 끝나야 돌아온다. 꺼진 호스트 하나가 "이어할 수 있는 세션" 구획을 통째로
붙잡고 있었다(실측). 전체 마감을 두고, 못 끝낸 것은 그때까지의 결과와 함께 오류로 준다.
"""
from __future__ import annotations

import asyncio

import pytest

import routes.hosts as hosts_route


@pytest.fixture
def fast_deadline(monkeypatch):
    monkeypatch.setattr(hosts_route, "BATCH_TMUX_DEADLINE_SEC", 0.2)


@pytest.fixture
def hosts(monkeypatch):
    rows = [
        {"id": "quick", "username": "u", "use_remote_tmux": 1},
        {"id": "dead", "username": "u", "use_remote_tmux": 1},
    ]

    class _Storage:
        async def list_hosts(self, username):
            return rows

        async def get_host(self, host_id, username):
            return next((h for h in rows if h["id"] == host_id), None)

    monkeypatch.setattr(hosts_route, "storage", _Storage())

    async def fetch(host, host_id, username, refresh):
        if host_id == "dead":
            await asyncio.sleep(30)          # 꺼진 호스트 — 영영 안 돌아온다
        return {"id": host_id, "sessions": [{"name": "s1", "created": 1, "attached": False}]}

    monkeypatch.setattr(hosts_route, "_fetch_host_tmux_sessions", fetch)
    return rows


async def test_a_dead_host_does_not_hold_the_others(fast_deadline, hosts):
    result = await asyncio.wait_for(
        hosts_route.batch_host_tmux_sessions(ids="", refresh=False, username="u"), timeout=3
    )
    by_id = {item["id"]: item for item in result["items"]}
    assert by_id["quick"]["sessions"]              # 살아 있는 호스트는 값을 준다
    assert by_id["dead"]["error"]                  # 못 끝낸 것은 오류로
    assert by_id["dead"]["sessions"] == []


async def test_the_abandoned_lookup_is_cancelled(fast_deadline, hosts, monkeypatch):
    """⚠️ 남겨 두면 아무도 안 보는 SSH 가 계속 돈다 — 폴링마다 하나씩 쌓인다."""
    started = []

    async def fetch(host, host_id, username, refresh):
        started.append(host_id)
        if host_id == "dead":
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                started.append("dead-cancelled")
                raise
        return {"id": host_id, "sessions": []}

    monkeypatch.setattr(hosts_route, "_fetch_host_tmux_sessions", fetch)
    await hosts_route.batch_host_tmux_sessions(ids="", refresh=False, username="u")
    await asyncio.sleep(0.05)
    assert "dead-cancelled" in started


async def test_the_timeout_is_cached_so_the_next_look_is_fast(fast_deadline, hosts, monkeypatch):
    """⚠️ 취소된 태스크는 함수 안의 실패 캐시 기록에 도달하지 못한다 — 배치가 대신 써야
    한다. 안 그러면 화면을 열 때마다 마감을 처음부터 다시 태운다(실측: 두 번째도 6초)."""
    written = {}

    class _Cache:
        async def get(self, key):
            return written.get(key)

        async def set(self, key, value, ttl_seconds=None):
            written[key] = value

    monkeypatch.setattr(hosts_route, "cache", _Cache())
    await hosts_route.batch_host_tmux_sessions(ids="", refresh=False, username="u")
    cached = [v for v in written.values() if v.get("id") == "dead"]
    assert cached and cached[0]["error"]
