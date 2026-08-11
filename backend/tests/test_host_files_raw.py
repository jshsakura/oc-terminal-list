"""GET /api/hosts/{id}/files/raw — inline preview stream for remote files.

The rule this endpoint lives by: it is `download` except the browser *renders* the
bytes, so only media that is safe to render inline passes. Everything else (html,
svg, text, unknown) is refused rather than served as octet-stream, because a
same-origin document from a remote host would run in this app's origin.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import routes.host_files as host_files
from routes.host_files import inline_media_type, raw_host_file

# ---------------------- media type gate ----------------------

@pytest.mark.parametrize("filename,expected", [
    ("cand-1.png", "image/png"),
    ("shot.JPEG", "image/jpeg"),
    ("clip.mp4", "video/mp4"),
    ("voice.mp3", "audio/mpeg"),
    ("paper.pdf", "application/pdf"),
])
def test_inline_media_type_allows_renderable_media(filename, expected):
    assert inline_media_type(filename) == expected


@pytest.mark.parametrize("filename", [
    "index.html",          # would execute in our origin
    "logo.svg",            # an image by extension, a script host in a browser
    "notes.txt",
    "server.py",
    "no-extension",
])
def test_inline_media_type_refuses_everything_else(filename):
    assert inline_media_type(filename) is None


# ---------------------- endpoint ----------------------

async def _agen(chunks):
    for chunk in chunks:
        yield chunk


def _open_download(media_type="application/octet-stream", chunks=(b"\x89PNG",)):
    return AsyncMock(return_value=("cand-1.png", media_type, _agen(chunks)))


@pytest.mark.asyncio
async def test_raw_streams_image_with_guessed_type_and_nosniff():
    with patch.object(host_files, "resolve_host_with_secrets",
                      AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch.object(host_files.host_sftp, "open_download", _open_download()):
        res = await raw_host_file(host_id="h1", path="/home/u/cand-1.png", username="u")
    assert res.media_type == "image/png"
    assert res.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_raw_refuses_non_renderable_before_touching_ssh():
    """확장자만 보고 거절한다 — 거절할 파일 때문에 SSH 를 열 이유가 없다."""
    open_download = _open_download()
    with patch.object(host_files, "resolve_host_with_secrets",
                      AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch.object(host_files.host_sftp, "open_download", open_download):
        with pytest.raises(HTTPException) as exc:
            await raw_host_file(host_id="h1", path="/home/u/index.html", username="u")
    assert exc.value.status_code == 415
    open_download.assert_not_called()


@pytest.mark.asyncio
async def test_raw_refuses_directory_and_closes_the_stream():
    """`foo.png/` 같은 디렉터리는 open_download 가 zip 으로 내보낸다. 거절하되
    스트림을 닫아야 SFTP 컨텍스트가 돌아온다 — 그냥 버리면 연결이 열린 채 남는다."""
    class _Stream:
        def __init__(self):
            self.closed = False

        async def aclose(self):
            self.closed = True

    stream = _Stream()
    with patch.object(host_files, "resolve_host_with_secrets",
                      AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch.object(host_files.host_sftp, "open_download",
                      AsyncMock(return_value=("cand-1.png.zip", "application/zip", stream))):
        with pytest.raises(HTTPException) as exc:
            await raw_host_file(host_id="h1", path="/home/u/cand-1.png", username="u")
    assert exc.value.status_code == 415
    assert stream.closed is True


@pytest.mark.asyncio
async def test_raw_maps_connect_failure_to_502():
    from host_manager import HostConnectError

    with patch.object(host_files, "resolve_host_with_secrets",
                      AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch.object(host_files.host_sftp, "open_download",
                      AsyncMock(side_effect=HostConnectError("host down"))):
        with pytest.raises(HTTPException) as exc:
            await raw_host_file(host_id="h1", path="/home/u/cand-1.png", username="u")
    assert exc.value.status_code == 502
