import time

import pytest
from fastapi.testclient import TestClient

import _deps
import main
import tickets  # 티켓 저장소는 main 에서 분리됨


def setup_function():
    tickets._ws_tickets.clear()
    tickets._file_tickets.clear()


def teardown_function():
    tickets._ws_tickets.clear()
    tickets._file_tickets.clear()


def test_ws_ticket_is_single_use_and_path_bound():
    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")

    assert main._consume_ws_ticket(ticket, "/ws/session-2") is None
    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None

    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")
    assert main._consume_ws_ticket(ticket, "/ws/session-1") == "admin"
    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None


def test_ws_ticket_rejects_expired_ticket():
    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")
    tickets._ws_tickets[ticket]["expires_at"] = time.time() - 1

    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None


def test_ws_ticket_rejects_non_ws_paths():
    with pytest.raises(main.HTTPException):
        main._create_ws_ticket("admin", "/api/sessions")


def test_file_ticket_is_single_use(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    target = tmp_path / "preview.png"
    target.write_bytes(b"image")

    ticket, _expires_at = main._create_file_ticket("admin", "preview.png")

    assert main._consume_file_ticket(ticket) == str(target)
    assert main._consume_file_ticket(ticket) is None


def test_file_ticket_rejects_expired_ticket(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    target = tmp_path / "preview.png"
    target.write_bytes(b"image")
    ticket, _expires_at = main._create_file_ticket("admin", "preview.png")
    tickets._file_tickets[ticket]["expires_at"] = time.time() - 1

    assert main._consume_file_ticket(ticket) is None


def test_validate_path_preserves_literal_dotdot_in_filename(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))

    assert main.validate_path("a..b.txt") == tmp_path.resolve() / "a..b.txt"


def test_validate_path_rejects_parent_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))

    with pytest.raises(main.HTTPException):
        main.validate_path("../outside.txt")


def test_validate_path_rejects_symlink_escape(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    outside = tmp_path.parent / "outside-target"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not available on this filesystem")

    with pytest.raises(main.HTTPException):
        main.validate_path("link/secret.txt")


def test_validate_path_can_reject_workspace_root(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))

    with pytest.raises(main.HTTPException):
        main.validate_path("/", allow_root=False)


@pytest.mark.asyncio
async def test_verify_auth_token_accepts_cookie_and_ignores_null_bearer(monkeypatch):
    class FakeAuth:
        async def verify_token(self, token):
            return "admin" if token == "cookie-token" else None

    monkeypatch.setattr(_deps, "_auth_manager", FakeAuth())

    assert await _deps.verify_auth_token(
        authorization="Bearer null",
        auth_cookie="cookie-token",
    ) == "admin"


def test_verify_endpoint_promotes_legacy_bearer_to_cookie():
    main.app.dependency_overrides[main.verify_auth_token] = lambda: "admin"
    try:
        res = TestClient(main.app).get(
            "/api/auth/verify",
            headers={"Authorization": "Bearer legacy-token"},
        )
    finally:
        main.app.dependency_overrides.clear()

    assert res.status_code == 200
    set_cookie = res.headers["set-cookie"]
    assert f"{main.AUTH_COOKIE_NAME}=legacy-token" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=strict" in set_cookie.lower()


def test_logout_clears_auth_cookie():
    res = TestClient(main.app).post("/api/auth/logout")

    assert res.status_code == 200
    set_cookie = res.headers["set-cookie"]
    assert f"{main.AUTH_COOKIE_NAME}=" in set_cookie
    assert "Max-Age=0" in set_cookie
