"""Revoked browser credentials must not regain access through refresh or tickets."""
from unittest.mock import AsyncMock, patch

import anyio
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import tickets
import ws_auth
from auth_manager import AuthManager
from sqlite_storage import SQLiteStorage


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def manager(tmp_path, monkeypatch):
    monkeypatch.setattr(AuthManager, "_init_secret_key", AsyncMock())
    store = SQLiteStorage(str(tmp_path / "auth.db"))
    mgr = AuthManager(store)
    mgr.secret_key = "test-only-secret-for-revocation"
    await mgr.create_admin("admin", "old-password")
    yield mgr
    await store.close()


@pytest.mark.anyio
async def test_password_change_revokes_existing_token(manager):
    token = await manager.create_access_token("admin")
    assert await manager.verify_token(token) == "admin"
    assert await manager.change_password("admin", "old-password", "new-password")
    assert await manager.verify_token(token) is None


@pytest.mark.anyio
async def test_logout_revokes_refresh_family_but_preserves_other_login(manager):
    first = await manager.create_access_token("admin")
    other = await manager.create_access_token("admin")
    assert await manager.verify_token(first) == "admin"
    refreshed = await manager.refresh_access_token("admin")
    await manager.logout_session()
    assert await manager.verify_token(first) is None
    assert await manager.verify_token(refreshed) is None
    assert await manager.verify_token(other) == "admin"


@pytest.mark.anyio
async def test_password_change_invalidates_ws_sse_file_and_pending_otp_tickets(manager, tmp_path, monkeypatch):
    token = await manager.create_access_token("admin")
    assert await manager.verify_token(token) == "admin"
    monkeypatch.setattr(tickets, "validate_path", lambda path: tmp_path / path)
    ws_ticket, _ = tickets._create_ws_ticket("admin", "/ws/s1")
    file_ticket, _ = tickets._create_file_ticket("admin", "a.png")
    sse_ticket = tickets._create_sse_ticket("admin")
    pending = await manager.create_otp_pending_token("admin")
    assert await manager.change_password("admin", "old-password", "new-password")
    assert tickets._consume_ws_ticket(ws_ticket, "/ws/s1") is None
    assert tickets._consume_file_ticket(file_ticket) is None
    assert tickets._consume_sse_ticket(sse_ticket) is None
    assert await manager.verify_otp_pending_token(pending) is None


class ConnectedSocket:
    def __init__(self, token):
        self.headers = {"origin": "https://term.local", "host": "term.local"}
        self.cookies = {"iterm_auth": token}
        self.close = AsyncMock()


@pytest.mark.anyio
async def test_logout_closes_existing_cookie_socket_and_revokes_prepushed_ticket(manager, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://term.local")
    token = await manager.create_access_token("admin")
    ws = ConnectedSocket(token)
    with patch.object(ws_auth, "get_auth_manager", return_value=manager):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", None) == "admin"
    reconnect, _ = tickets._create_ws_ticket("admin", "/ws/s1")
    await manager.logout_session()
    ws.close.assert_awaited_once_with(code=1008, reason="인증 세션이 만료되었습니다")
    assert tickets._consume_ws_ticket(reconnect, "/ws/s1") is None


@pytest.mark.anyio
async def test_session_revocation_survives_auth_manager_restart(manager):
    token = await manager.create_access_token("admin")
    assert await manager.verify_token(token) == "admin"
    await manager.logout_session()
    restarted = AuthManager(manager.storage)
    restarted.secret_key = manager.secret_key
    assert await restarted.verify_token(token) is None


@pytest.mark.anyio
async def test_password_change_rejects_login_that_verified_old_password_before_change(manager):
    assert await manager.verify_admin("admin", "old-password")
    assert await manager.change_password("admin", "old-password", "new-password")
    with pytest.raises(HTTPException) as exc:
        await manager.create_access_token("admin")
    assert exc.value.status_code == 401
    assert await manager.verify_admin("admin", "new-password")
    assert await manager.verify_token(await manager.create_access_token("admin")) == "admin"


@pytest.mark.anyio
async def test_logout_wakes_and_stops_idle_sse_stream(manager, monkeypatch):
    from routes import user_state
    monkeypatch.setattr(user_state, "storage", manager.storage)
    token = await manager.create_access_token("admin")
    assert await manager.verify_token(token) == "admin"
    ticket = tickets._create_sse_ticket("admin")
    response = await user_state.tab_state_events(ticket, None)
    stream = response.body_iterator
    assert "updatedAt" in await anext(stream)
    async with anyio.create_task_group() as tasks:
        async def receive_next():
            with anyio.fail_after(1):
                with pytest.raises(StopAsyncIteration):
                    await anext(stream)
        tasks.start_soon(receive_next)
        await anyio.sleep(0)
        await manager.logout_session()


@pytest.mark.anyio
async def test_http_logout_rejects_original_and_refreshed_bearers(manager, monkeypatch):
    import _deps
    from routes import auth
    monkeypatch.setattr(_deps, "_auth_manager", manager)
    first = await manager.create_access_token("admin")
    other = await manager.create_access_token("admin")
    app = FastAPI()
    app.include_router(auth.router)

    def use_api():
        with TestClient(app) as client:
            headers = {"Authorization": f"Bearer {first}"}
            response = client.post("/api/auth/refresh", headers=headers)
            assert response.status_code == 200
            refreshed = response.json()["access_token"]
            assert client.post("/api/auth/logout", headers=headers).status_code == 200
            for revoked in (first, refreshed):
                headers = {"Authorization": f"Bearer {revoked}"}
                assert client.get("/api/auth/verify", headers=headers).status_code == 401
                assert client.post("/api/auth/refresh", headers=headers).status_code == 401
            assert client.get("/api/auth/verify", headers={"Authorization": f"Bearer {other}"}).status_code == 200

    await anyio.to_thread.run_sync(use_api)


@pytest.mark.anyio
async def test_bearer_repairs_expired_cookie_without_promoting_invalid_bearer(manager, monkeypatch):
    import _deps
    from routes import auth
    monkeypatch.setattr(_deps, "_auth_manager", manager)
    bearer = await manager.create_access_token("admin")
    app = FastAPI()
    app.include_router(auth.router)

    def use_api():
        with TestClient(app) as client:
            response = client.get("/api/auth/verify", headers={
                "Cookie": "iterm_auth=expired-cookie", "Authorization": f"Bearer {bearer}",
            })
            assert response.status_code == 200
            assert bearer in response.headers["set-cookie"]
            response = client.get("/api/auth/verify", headers={
                "Cookie": f"iterm_auth={bearer}", "Authorization": "Bearer invalid-token",
            })
            assert response.status_code == 200
            assert "set-cookie" not in response.headers

    await anyio.to_thread.run_sync(use_api)


def _sid(token):
    import jwt
    return jwt.decode(token, options={"verify_signature": False})["sid"]


@pytest.mark.anyio
async def test_login_alert_button_revokes_only_that_login(manager):
    target = await manager.create_access_token("admin")
    other = await manager.create_access_token("admin")
    assert await manager.storage.revoke_auth_session(_sid(target)) is True
    assert await manager.storage.revoke_auth_session(_sid(target)) is False   # already gone
    assert await manager.verify_token(target) is None
    assert await manager.verify_token(other) == "admin"


@pytest.mark.anyio
async def test_login_alert_logout_all_voids_every_token(manager):
    first = await manager.create_access_token("admin")
    second = await manager.create_access_token("admin")
    await manager.storage.revoke_all_auth_sessions("admin")
    assert await manager.verify_token(first) is None
    assert await manager.verify_token(second) is None
    # Logging in again still works afterwards.
    assert await manager.verify_token(await manager.create_access_token("admin")) == "admin"
