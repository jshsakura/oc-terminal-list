"""리모트 자격증명 — 호스트 단위로 갇혀 있는가."""
from __future__ import annotations

import pytest

from auth_manager import AuthManager
from remote_agent.credentials import (
    REMOTE_TOKEN_SCOPE,
    issue_credential,
    verify_credential,
)


@pytest.fixture
def manager(tmp_path, monkeypatch):
    mgr = AuthManager.__new__(AuthManager)

    async def secret():
        return "test-secret-key-for-remote-credentials"

    mgr.ensure_secret_key = secret
    return mgr


async def test_credential_round_trips_with_its_host(manager):
    token = await issue_credential(manager, "jsh", "host-abc", epoch=3)
    assert await verify_credential(manager, token) == ("jsh", "host-abc", 3)


async def test_a_credential_without_an_epoch_is_refused(manager):
    """세대 없는 토큰을 통과시키면 폐기 장치가 통째로 우회된다."""
    token = await manager.create_scoped_token("jsh", REMOTE_TOKEN_SCOPE,
                                              extra={"host": "host-abc"})
    assert await verify_credential(manager, token) is None


async def test_a_scoped_token_without_a_host_claim_is_refused(manager):
    """⚠️ 이게 통과하면 '호스트 전용' 이 거짓말이 된다 — scope 만 맞는 토큰이
    아무 호스트로나 붙는다."""
    token = await manager.create_scoped_token("jsh", REMOTE_TOKEN_SCOPE)
    assert await verify_credential(manager, token) is None


async def test_an_itl_token_cannot_attach_as_a_remote(manager):
    """tmux env 로 새어 나가는 그 토큰이 리모트 통로를 열면 안 된다."""
    token = await manager.create_scoped_token("jsh", "itl",
                                              extra={"host": "host-abc", "epoch": 1})
    assert await verify_credential(manager, token) is None


async def test_a_plain_login_token_cannot_attach_as_a_remote(manager):
    token = await manager.create_access_token({"sub": "jsh"}) \
        if hasattr(manager, "create_access_token") else None
    if token:
        assert await verify_credential(manager, token) is None


async def test_extra_claims_cannot_overwrite_identity(manager):
    """호출자가 sub/scope 를 덮을 수 있으면 아무 토큰이나 찍어낼 수 있다."""
    with pytest.raises(ValueError):
        await manager.create_scoped_token("jsh", REMOTE_TOKEN_SCOPE, extra={"sub": "someone-else"})
    with pytest.raises(ValueError):
        await manager.create_scoped_token("jsh", REMOTE_TOKEN_SCOPE, extra={"scope": "itl"})


async def test_garbage_is_refused(manager):
    assert await verify_credential(manager, None) is None
    assert await verify_credential(manager, "") is None
    assert await verify_credential(manager, "not.a.jwt") is None
