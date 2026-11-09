"""Local raw previews render in an opaque origin.

The editor's HTML preview is an <iframe src="/api/files/raw?path=..."> on the app's
own origin, so a script in any workspace .html (a cloned repo, a downloaded page) ran
as the app: it could read the API with the user's cookie and type into terminals.
A `Content-Security-Policy: sandbox` header without allow-same-origin gives the
document an opaque origin and no cookies, whichever way it is opened.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import files_read


async def _authed(*_args, **_kwargs):
    return "u"


@pytest.fixture
def fetch(tmp_path, monkeypatch):
    monkeypatch.setattr(files_read, "verify_auth_token", _authed)
    app = FastAPI()
    app.include_router(files_read.router)
    client = TestClient(app)

    def get(name: str, body: bytes):
        target = tmp_path / name
        target.write_bytes(body)
        monkeypatch.setattr(files_read, "validate_path", lambda *_a, **_k: target)
        return client.get("/api/files/raw", params={"path": name})

    return get


def _sandbox_directive(res) -> str:
    csp = res.headers.get("content-security-policy", "")
    return next((d.strip() for d in csp.split(";") if d.strip().startswith("sandbox")), "")


@pytest.mark.parametrize("name, body", [
    ("page.html", b"<script>fetch('/api/hosts')</script>"),
    ("page.htm", b"<script>1</script>"),
    ("doc.xhtml", b"<html xmlns='http://www.w3.org/1999/xhtml'/>"),
    ("pic.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"),
    ("data.xml", b"<x/>"),
    ("notes.txt", b"plain"),
    ("pic.png", b"\x89PNG\r\n\x1a\n"),
])
def test_documents_are_served_in_an_opaque_origin(fetch, name, body):
    res = fetch(name, body)

    assert res.status_code == 200
    sandbox = _sandbox_directive(res)
    assert sandbox, res.headers
    assert "allow-same-origin" not in sandbox
    assert res.headers.get("x-content-type-options") == "nosniff"


def test_pdf_is_not_sandboxed_because_browsers_refuse_to_render_it(fetch):
    # Chromium's PDF viewer will not load inside a sandboxed document. A PDF is not a
    # script host the way HTML/SVG are, so it keeps working.
    res = fetch("doc.pdf", b"%PDF-1.4\n")

    assert res.status_code == 200
    assert _sandbox_directive(res) == ""
    assert res.headers.get("x-content-type-options") == "nosniff"
