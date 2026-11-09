"""Upload endpoints authenticate before they read the body, and cap its size.

FastAPI parses a Form/File body *before* it runs dependencies, so the multipart body
of an anonymous request was read in full (spooled to disk past 1MB) and only then
answered 401. Anyone who reached the port could fill memory and /tmp. The routes now
read the form inside a dependency that depends on auth, and refuse oversized bodies
from Content-Length up front and from the byte count while streaming.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import _deps
import upload_form
from routes import files_write, host_files_write

UPLOAD_ROUTES = [
    ("/api/files/upload", "files"),
    ("/api/terminal/paste-image", "file"),
    ("/api/terminal/paste-file", "file"),
    ("/api/hosts/h1/files/upload", "files"),
]


@pytest.fixture
def form_calls(monkeypatch):
    calls: list[int] = []
    original = Request.form

    def spy(self, *args, **kwargs):
        calls.append(1)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Request, "form", spy)
    return calls


def _app(*, authed: bool) -> FastAPI:
    app = FastAPI()
    app.include_router(files_write.router)
    app.include_router(host_files_write.router)
    if authed:
        app.dependency_overrides[_deps.verify_auth_token] = lambda: "u"
    return app


@pytest.mark.parametrize("url, field", UPLOAD_ROUTES)
def test_anonymous_upload_is_refused_before_the_body_is_parsed(form_calls, url, field):
    client = TestClient(_app(authed=False))

    res = client.post(url, files={field: ("big.png", b"x" * (2 * 1024 * 1024), "image/png")})

    assert res.status_code == 401
    assert form_calls == []


def _request(headers: dict[str, str], chunks: list[bytes]) -> Request:
    messages = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
                for i, c in enumerate(chunks)]

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "POST", "headers": raw}, receive)


def _multipart(payload: bytes) -> tuple[dict[str, str], bytes]:
    boundary = "BOUNDARY"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.bin\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + payload + \
        f"\r\n--{boundary}--\r\n".encode()
    return {"content-type": f"multipart/form-data; boundary={boundary}"}, body


def test_declared_oversize_body_is_refused_without_reading(form_calls):
    headers, body = _multipart(b"x" * 10)
    headers["content-length"] = str(10_000)
    request = _request(headers, [body])

    with pytest.raises(HTTPException) as caught:
        asyncio.run(upload_form.read_capped_form(request, max_bytes=1000, max_files=1))

    assert caught.value.status_code == 413
    assert form_calls == []


def test_streamed_oversize_body_is_cut_off(form_calls):
    headers, body = _multipart(b"x" * 5000)
    # No Content-Length: chunked transfer must still be capped by counting bytes.
    request = _request(headers, [body[i:i + 512] for i in range(0, len(body), 512)])

    with pytest.raises(HTTPException) as caught:
        asyncio.run(upload_form.read_capped_form(request, max_bytes=1000, max_files=1))

    assert caught.value.status_code == 413


def test_bad_content_length_is_rejected():
    headers, body = _multipart(b"x")
    headers["content-length"] = "lots"

    with pytest.raises(HTTPException) as caught:
        asyncio.run(upload_form.read_capped_form(_request(headers, [body]), max_bytes=1000, max_files=1))

    assert caught.value.status_code == 400


def test_body_within_the_cap_is_parsed():
    headers, body = _multipart(b"hello")
    headers["content-length"] = str(len(body))

    async def run():
        form = await upload_form.read_capped_form(_request(headers, [body]), max_bytes=1000, max_files=1)
        try:
            (upload,) = upload_form.form_uploads(form, "file")
            return await upload.read()
        finally:
            await form.close()

    assert asyncio.run(run()) == b"hello"


def test_authed_workspace_upload_still_works(tmp_path, monkeypatch):
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(files_write, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(files_write, "_invalidate_file_index", lambda: None)
    (tmp_path / "dest").mkdir()
    client = TestClient(_app(authed=True))

    res = client.post("/api/files/upload", data={"dest": "dest"},
                      files=[("files", ("a.txt", b"one", "text/plain")),
                             ("files", ("b.txt", b"two", "text/plain"))])

    assert res.status_code == 200, res.text
    assert [f["path"] for f in res.json()["files"]] == ["dest/a.txt", "dest/b.txt"]
    assert (tmp_path / "dest" / "b.txt").read_bytes() == b"two"


def test_authed_upload_over_the_request_cap_is_413(tmp_path, monkeypatch):
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(files_write, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_form, "UPLOAD_REQUEST_MAX_BYTES", 1000)
    client = TestClient(_app(authed=True))

    res = client.post("/api/files/upload", files={"files": ("a.txt", b"x" * 5000, "text/plain")})

    assert res.status_code == 413
    assert not (tmp_path / "a.txt").exists()


def test_authed_local_paste_image_still_works(tmp_path, monkeypatch):
    monkeypatch.setattr(files_write, "local_paste_dir", lambda: tmp_path)
    monkeypatch.setattr(files_write, "_invalidate_file_index", lambda: None)
    client = TestClient(_app(authed=True))

    res = client.post("/api/terminal/paste-image", files={"file": ("p.png", b"\x89PNG", "image/png")})

    assert res.status_code == 200, res.text
    assert res.json()["scope"] == "local"
    assert len(list(tmp_path.glob("*.png"))) == 1


def test_paste_image_rejects_non_images(tmp_path, monkeypatch):
    monkeypatch.setattr(files_write, "local_paste_dir", lambda: tmp_path)
    client = TestClient(_app(authed=True))

    res = client.post("/api/terminal/paste-image", files={"file": ("p.txt", b"hi", "text/plain")})

    assert res.status_code == 400
