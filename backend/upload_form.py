"""Multipart bodies read only after authentication, with a hard size cap.

FastAPI parses a route's Form/File parameters *before* it solves dependencies, so
`files: list[UploadFile] = File(...)` next to `Depends(verify_auth_token)` reads and
spools the whole body of an anonymous request and only then answers 401. Anyone who
reaches the port could fill memory and the temp dir.

Upload routes therefore declare no Form/File parameters. They take the form from one
of the dependencies below, which depend on auth first and then read the body through
a byte-counting receive, refusing an oversized Content-Length before reading at all.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException

from _deps import verify_auth_token
from host_common import MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES

# Multipart framing (boundaries, part headers, small text fields) on top of the payload.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024
UPLOAD_REQUEST_MAX_BYTES = MAX_UPLOAD_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES
PASTE_REQUEST_MAX_BYTES = MAX_UPLOAD_FILE_BYTES + MULTIPART_OVERHEAD_BYTES
# Text fields per upload: dest, on_conflict and one relpath per file.
UPLOAD_MAX_FIELDS = MAX_UPLOAD_FILES + 16
PASTE_MAX_FIELDS = 16


def _too_large(max_bytes: int) -> HTTPException:
    return HTTPException(status_code=413, detail=f"요청 본문이 너무 큽니다 (최대 {max_bytes} bytes)")


def _check_declared_length(request: Request, max_bytes: int) -> None:
    declared = request.headers.get("content-length")
    if declared is None:
        return
    try:
        length = int(declared)
    except ValueError:
        raise HTTPException(status_code=400, detail="Content-Length 가 올바르지 않습니다") from None
    if length < 0:
        raise HTTPException(status_code=400, detail="Content-Length 가 올바르지 않습니다")
    if length > max_bytes:
        raise _too_large(max_bytes)


async def read_capped_form(
    request: Request,
    *,
    max_bytes: int,
    max_files: int,
    max_fields: int = PASTE_MAX_FIELDS,
) -> FormData:
    """Parse the request's form, never reading more than max_bytes of body.

    Content-Length is checked before the first byte is read; chunked bodies (no
    Content-Length) are cut off by counting bytes as they arrive. Starlette closes
    the spooled files of a parse that raises.
    """
    _check_declared_length(request, max_bytes)
    received = 0

    async def capped_receive():
        nonlocal received
        message = await request.receive()
        if message.get("type") == "http.request":
            received += len(message.get("body", b""))
            if received > max_bytes:
                raise _too_large(max_bytes)
        return message

    capped = Request(request.scope, capped_receive)
    try:
        return await capped.form(max_files=max_files, max_fields=max_fields)
    except MultiPartException as exc:
        raise HTTPException(status_code=400, detail=exc.message) from None


def form_text(form: FormData, name: str, default: str = "") -> str:
    value = form.get(name, default)
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"'{name}' 는 텍스트 필드여야 합니다")
    return value


def form_texts(form: FormData, name: str) -> list[str]:
    values = form.getlist(name)
    if not all(isinstance(v, str) for v in values):
        raise HTTPException(status_code=400, detail=f"'{name}' 는 텍스트 필드여야 합니다")
    return list(values)


def form_uploads(form: FormData, name: str) -> list[UploadFile]:
    return [v for v in form.getlist(name) if isinstance(v, UploadFile)]


def form_upload(form: FormData, name: str) -> UploadFile:
    uploads = form_uploads(form, name)
    if len(uploads) != 1:
        raise HTTPException(status_code=400, detail=f"'{name}' 파일이 하나 필요합니다")
    return uploads[0]


async def upload_form(
    request: Request,
    _username: str = Depends(verify_auth_token),
) -> AsyncIterator[FormData]:
    """Authenticated multi-file upload body (workspace and SFTP uploads)."""
    form = await read_capped_form(
        request,
        max_bytes=UPLOAD_REQUEST_MAX_BYTES,
        max_files=MAX_UPLOAD_FILES,
        max_fields=UPLOAD_MAX_FIELDS,
    )
    try:
        yield form
    finally:
        await form.close()


async def paste_form(
    request: Request,
    _username: str = Depends(verify_auth_token),
) -> AsyncIterator[FormData]:
    """Authenticated single-file terminal paste body."""
    form = await read_capped_form(request, max_bytes=PASTE_REQUEST_MAX_BYTES, max_files=1)
    try:
        yield form
    finally:
        await form.close()
