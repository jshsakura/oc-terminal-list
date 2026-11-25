import secrets
import time

import pytest
from fastapi import Cookie, FastAPI, HTTPException
from fastapi.testclient import TestClient

import _deps
from auth_sessions import BrowserSession, current_session
from routes import files_read


@pytest.fixture
def preview(tmp_path, monkeypatch):
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(files_read, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(files_read, "_preview_grants", {})
    identity = secrets.token_urlsafe(32)
    session = BrowserSession(identity, "preview-test", time.time() + 3600)

    async def authenticate(iterm_auth: str | None = Cookie(None)):
        if iterm_auth != identity:
            raise HTTPException(status_code=401)
        current_session.set(session)
        return "preview-test"

    app = FastAPI()
    app.dependency_overrides[_deps.verify_auth_token] = authenticate
    app.include_router(files_read.router)
    client = TestClient(app)
    client.cookies.set("iterm_auth", identity)
    folder = tmp_path / "design"
    folder.mkdir()
    (folder / "prototype.html").write_text(
        '<link rel="stylesheet" href="prototype.css"><script src="prototype.js"></script>')
    (folder / "prototype.css").write_text("body { color: red; }")
    (folder / "prototype.js").write_text("document.body.dataset.ready = 'true';")
    return client, folder, session


def open_preview(client, path="design/prototype.html"):
    response = client.get("/api/files/preview", params={"path": path}, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["cache-control"] == "no-store"
    return response.headers["location"]


def test_preview_requires_authentication(preview):
    client, _, _ = preview
    client.cookies.clear()
    assert client.get("/api/files/preview", params={"path": "design/prototype.html"}).status_code == 401


def test_preview_resources_work_without_cookies_and_remain_sandboxed(preview):
    client, _, _ = preview
    location = open_preview(client)
    client.cookies.clear()
    document = client.get(location)
    assert document.status_code == 200
    policy = document.headers["content-security-policy"]
    assert "sandbox allow-scripts;" in policy
    assert "allow-same-origin" not in policy
    assert "frame-ancestors 'self'" in policy
    assert "form-action 'none'" in policy
    assert document.headers["x-frame-options"] == "SAMEORIGIN"
    assert document.headers["referrer-policy"] == "no-referrer"
    for filename, content_type in [("prototype.css", "text/css"), ("prototype.js", "text/javascript")]:
        response = client.get(location.rsplit("/", 1)[0] + "/" + filename)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith(content_type)
        assert response.headers["access-control-allow-origin"] == "*"


def test_preview_denies_escape_missing_and_non_assets(preview):
    client, folder, _ = preview
    outside = folder.parent / "outside.js"
    outside.write_text("outside")
    (folder / "escape.js").symlink_to(outside)
    (folder / ".env").write_text("not an asset")
    base = open_preview(client).rsplit("/", 1)[0]
    for asset, status in [("escape.js", 403), ("%2e%2e%2foutside.js", 403),
                          ("missing.css", 404), (".env", 415)]:
        assert client.get(base + "/" + asset).status_code == status
    assert client.get("/api/files/preview", params={"path": "../outside.html"}).status_code == 403


def test_preview_rejects_non_html_and_supports_encoded_filenames(preview):
    client, folder, _ = preview
    assert client.get("/api/files/preview", params={"path": "design/prototype.css"}).status_code == 415
    name = "한글 # sample.HTM"
    (folder / name).write_text("<h1>preview</h1>")
    assert client.get(open_preview(client, "design/" + name)).status_code == 200


@pytest.mark.parametrize("expired", [True, False])
def test_preview_grant_expires_or_is_revoked(preview, expired):
    client, _, session = preview
    location = open_preview(client)
    if expired:
        next(iter(files_read._preview_grants.values()))["expires_at"] = 0
    else:
        session.revoked.set()
    assert client.get(location).status_code == 401


def test_preview_grants_are_bounded_and_expired_entries_are_reclaimed(preview, monkeypatch):
    client, _, _ = preview
    monkeypatch.setattr(files_read, "_PREVIEW_LIMIT", 1)
    open_preview(client)
    assert client.get("/api/files/preview", params={"path": "design/prototype.html"}).status_code == 429
    next(iter(files_read._preview_grants.values()))["expires_at"] = 0
    open_preview(client)
    assert len(files_read._preview_grants) == 1
