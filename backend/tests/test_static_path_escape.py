"""The SPA catch-all must never serve a file outside the static directory.

It joined the raw URL path onto STATIC_DIR, so `/..%2f..%2fdata%2f.jwt-secret` and
`//home/u/.ssh/id_ed25519` (pathlib drops the left side for an absolute path) returned
any readable file with no authentication. Reachable from the tailnet and loopback.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from static_paths import resolve_static_file


@pytest.fixture
def layout(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>spa</html>")
    (static / "robots.txt").write_text("robots")
    (static / "sub").mkdir()
    (static / "sub" / "a.txt").write_text("nested")
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET")
    return static, secret


def test_정적_폴더_안의_파일은_그대로_찾는다(layout):
    static, _ = layout
    assert resolve_static_file(static, "robots.txt") == (static / "robots.txt").resolve()
    assert resolve_static_file(static, "sub/a.txt") == (static / "sub" / "a.txt").resolve()


@pytest.mark.parametrize("request_path", [
    "../secret.txt",
    "sub/../../secret.txt",
    "../../../../../../../../etc/hostname",
])
def test_상위로_올라가는_경로는_거부한다(layout, request_path):
    static, _ = layout
    assert resolve_static_file(static, request_path) is None


def test_절대경로는_거부한다(layout):
    static, secret = layout
    assert resolve_static_file(static, str(secret)) is None


def test_밖을_가리키는_심볼릭_링크는_거부한다(layout):
    static, secret = layout
    (static / "link.txt").symlink_to(secret)
    assert resolve_static_file(static, "link.txt") is None


@pytest.mark.parametrize("request_path", ["", "sub", "missing.txt", "bad\x00name"])
def test_파일이_아니면_None(layout, request_path):
    static, _ = layout
    assert resolve_static_file(static, request_path) is None


def _catch_all_registered() -> bool:
    return any(getattr(r, "path", "") == "/{full_path:path}" for r in main.app.routes)


@pytest.mark.skipif(not _catch_all_registered(), reason="frontend not built; no catch-all route")
@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize("url", [
    "/..%2fsecret.txt",
    "/sub%2f..%2f..%2fsecret.txt",
    "/%2f{secret}",
    "/%2e%2e%2fsecret.txt",
    "/sub%2f%2e%2e%2f%2e%2e%2fsecret.txt",
    "/%2e%2e/secret.txt",
])
def test_라우트가_정적_폴더_밖의_파일을_돌려주지_않는다(layout, monkeypatch, method, url):
    static, secret = layout
    monkeypatch.setattr(main, "STATIC_DIR", static)
    client = TestClient(main.app)

    res = client.request(method, url.format(secret=str(secret).lstrip("/")))

    assert b"TOP-SECRET" not in res.content
    if method == "GET":
        assert res.text == "<html>spa</html>"


@pytest.mark.skipif(not _catch_all_registered(), reason="frontend not built; no catch-all route")
def test_라우트가_정적_파일은_계속_서빙한다(layout, monkeypatch):
    static, _ = layout
    monkeypatch.setattr(main, "STATIC_DIR", static)
    client = TestClient(main.app)

    assert client.get("/robots.txt").text == "robots"
    assert client.head("/robots.txt").status_code == 200
    assert client.get("/missing.js").status_code == 404
