"""꺼진 호스트의 실패도 캐시한다 — 안 하면 홈 화면이 매번 15초 멈춘다.

`_fetch_host_tmux_sessions` 는 성공만 60초 캐시하고 실패는 캐시하지 않았다. 그래서
꺼진 호스트 하나가 조회 때마다 SSH connect timeout(`host_manager.CONNECT_TIMEOUT` = 15초)
을 새로 태웠고, `/api/hosts/tmux-sessions/batch` 는 `asyncio.gather` 라 그 15초가
**응답 전체**의 대기 시간이 됐다. 실측(2026-08-20): 죽은 Raspberry-PI 한 대가 홈의
"이어할 수 있는 세션" 구획을 열 때마다 15초씩 붙잡고 있었다.

호스트가 살아 돌아왔을 때의 탈출구는 `refresh=True`(새로고침) — 그것까지 캐시에 먹히면
사용자가 손으로 풀 방법이 없어진다.
"""
from __future__ import annotations

import pytest

import routes.hosts as hosts

HOST_ID = "test-dead-host"


class _DeadPool:
    """15초를 태우고 실패하는 SSH — 시간만 빼고 똑같이 흉내낸다."""

    def __init__(self) -> None:
        self.dials = 0

    async def run(self, *args, **kwargs):
        self.dials += 1
        raise RuntimeError("연결 실패: 10.0.0.9:22 응답 없음 (15초 시간 초과)")


class _FakeCache:
    """루프에 묶이지 않는 캐시 — 이 테스트는 백엔드(Redis/메모리) 선택과 무관해야 한다."""

    def __init__(self) -> None:
        self.data: dict[str, object] = {}
        self.ttls: dict[str, float] = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, ttl_seconds=0):
        self.data[key] = value
        self.ttls[key] = ttl_seconds


def _dead_host() -> dict:
    # get_host 가 주는 모양(password_enc 컬럼이 있고 값은 비어 있음).
    return {
        "id": HOST_ID,
        "hostname": "10.0.0.9",
        "auth_method": "password",
        "password_enc": None,
    }


@pytest.fixture
def env(monkeypatch):
    pool, fake_cache = _DeadPool(), _FakeCache()
    monkeypatch.setattr(hosts, "ssh_pool", pool)
    monkeypatch.setattr(hosts, "cache", fake_cache)
    return pool, fake_cache


@pytest.mark.asyncio
async def test_a_dead_host_is_dialed_once_not_once_per_request(env):
    pool, fake_cache = env
    first = await hosts._fetch_host_tmux_sessions(_dead_host(), HOST_ID, "u", False)
    second = await hosts._fetch_host_tmux_sessions(_dead_host(), HOST_ID, "u", False)

    assert first.get("error") and second.get("error")
    assert first["sessions"] == [] and second["sessions"] == []
    assert pool.dials == 1, "두 번째 조회가 다시 SSH 를 걸었다 — 홈 화면이 또 15초 멈춘다"

    key = hosts.key_host_tmux_sessions(HOST_ID)
    assert fake_cache.ttls[key] == hosts.HOST_TMUX_ERROR_TTL_SEC
    assert fake_cache.ttls[key] > 0, "ttl_seconds=0 은 만료 없음 — 영영 실패로 굳는다"


@pytest.mark.asyncio
async def test_refresh_still_redials_so_a_recovered_host_is_reachable(env):
    pool, _ = env
    await hosts._fetch_host_tmux_sessions(_dead_host(), HOST_ID, "u", False)
    await hosts._fetch_host_tmux_sessions(_dead_host(), HOST_ID, "u", True)
    assert pool.dials == 2


@pytest.mark.asyncio
async def test_the_failure_ttl_is_shorter_than_the_success_ttl():
    """실패를 성공만큼 오래 물고 있으면 살아 돌아온 호스트가 그만큼 안 보인다."""
    assert 0 < hosts.HOST_TMUX_ERROR_TTL_SEC <= hosts.HOST_TMUX_CACHE_TTL_SEC
