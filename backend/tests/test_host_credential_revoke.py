"""호스트 자격증명 폐기 — 세대를 올리는 것만으로 끝나지 않는다.

이미 열려 있는 통로와 "이미 심었다" 캐시를 같이 정리하지 않으면, **폐기했다는 말이
다음 재연결까지 거짓**이 된다. 셋이 한 세트다.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

import itl_remote_setup
import routes.hosts as hosts_route
from remote_agent import registry

HOST_ID = "host-abc"
USER = "jsh"


@pytest.fixture
def storage_stub(monkeypatch):
    class _Storage:
        def __init__(self):
            self.epoch = 1
            self.exists = True

        async def get_host(self, host_id, username):
            if not self.exists or host_id != HOST_ID or username != USER:
                return None
            return {"id": HOST_ID, "username": USER, "name": "gpu-box",
                    "cred_epoch": self.epoch, "remote_tmux_session": "mobile"}

        async def revoke_host_credentials(self, host_id, username):
            if not self.exists or host_id != HOST_ID or username != USER:
                return None
            self.epoch += 1
            return self.epoch

    stub = _Storage()
    monkeypatch.setattr(hosts_route, "storage", stub)
    registry.clear()
    yield stub
    registry.clear()


def _attach_remote():
    async def send(_message):
        return None

    conn = registry.RemoteConnection(HOST_ID, USER, send)
    registry.attach(conn)
    return conn


async def test_revoking_bumps_the_generation(storage_stub):
    result = await hosts_route.revoke_host_credentials(HOST_ID, USER)
    assert result["cred_epoch"] == 2


async def test_a_connected_remote_is_cut_immediately(storage_stub):
    """⚠️ 안 끊으면 이미 열린 통로는 폐기와 무관하게 계속 산다."""
    conn = _attach_remote()
    result = await hosts_route.revoke_host_credentials(HOST_ID, USER)
    assert result["remote_disconnected"] is True
    assert conn.closed
    assert registry.get(HOST_ID) is None


async def test_revoking_with_no_remote_attached_is_fine(storage_stub):
    result = await hosts_route.revoke_host_credentials(HOST_ID, USER)
    assert result["remote_disconnected"] is False


async def test_the_injection_cache_is_cleared(storage_stub, monkeypatch):
    """⚠️ 안 비우면 TTL 이 끝날 때까지 옛(죽은) 토큰을 두고 '이미 심었다' 로 건너뛴다."""
    forgotten = []
    monkeypatch.setattr(itl_remote_setup, "forget_injected",
                        lambda h, s: forgotten.append((h, s)))
    await hosts_route.revoke_host_credentials(HOST_ID, USER)
    assert forgotten == [(HOST_ID, "mobile")]


async def test_someone_elses_host_is_a_404_not_a_revocation(storage_stub):
    with pytest.raises(HTTPException) as exc:
        await hosts_route.revoke_host_credentials(HOST_ID, "someone-else")
    assert exc.value.status_code == 404
    assert storage_stub.epoch == 1          # 남의 호스트 세대를 건드리지 않았다


async def test_a_missing_host_is_a_404(storage_stub):
    storage_stub.exists = False
    with pytest.raises(HTTPException) as exc:
        await hosts_route.revoke_host_credentials("host-gone", USER)
    assert exc.value.status_code == 404
