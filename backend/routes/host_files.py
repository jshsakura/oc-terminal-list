"""원격 호스트 SFTP 파일 API — 읽기 쪽 (cwd / 목록 / 읽기 / 다운로드).

부수효과가 있는 쪽(쓰기·업로드·이동·복사·삭제·권한)은 `routes/host_files_write.py`.
다운로드는 전부 **스트리밍**이다 — 200MB 파일 하나가 그대로 RSS 가 되지 않도록.
"""
from __future__ import annotations

import logging
import os
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

import host_sftp
from _deps import verify_auth_token
from file_models import FilePathsRequest
from host_common import resolve_host_with_secrets
from host_manager import HostConnectError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hosts/{host_id}", tags=["host-files"])


def _fail(action: str, host_id: str, target, exc: Exception, message: str):
    """SFTP 예외를 HTTP 로 변환. 연결 실패(502)와 그 외(500)를 구분한다."""
    logger.warning("SFTP %s failed (%s, %s): %s", action, host_id, target, exc)
    if isinstance(exc, HostConnectError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=message)


def _attachment_headers(filename: str) -> dict:
    return {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}


@router.get("/cwd")
async def get_host_cwd(
    host_id: str,
    session: str | None = Query(None, description="원격 tmux 세션명. 없으면 가장 최근 활성 세션."),
    username: str = Depends(verify_auth_token),
):
    """원격 호스트 tmux 세션의 현재 작업 디렉토리."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    if not host.get("use_remote_tmux"):
        return {"host_id": host_id, "cwd": None}
    cwd = await host_sftp.get_tmux_cwd(host, secrets, session)
    return {"host_id": host_id, "cwd": cwd}


@router.get("/files")
async def list_host_files(
    host_id: str,
    path: str = Query("", description="원격 디렉토리 경로. 비우면 host start_path 또는 홈."),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    target = (path or "").strip()
    if not target:
        target = (host.get("start_path") or "").strip() or "."
    try:
        result = await host_sftp.list_directory(host, secrets, target)
    except Exception as e:
        raise _fail("list", host_id, target, e, "원격 디렉토리 조회 실패")
    return {
        "items": result["items"],
        "path": result["resolved"],
        "resolved": result["resolved"],
        "fs": result.get("fs"),
        "host_id": host_id,
    }


@router.get("/files/read")
async def read_host_file(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        content = await host_sftp.read_file(host, secrets, path)
    except Exception as e:
        raise _fail("read", host_id, path, e, "원격 파일 읽기 실패")
    return {"content": content, "path": path, "host_id": host_id}


@router.get("/files/download")
async def download_host_file(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        filename, media_type, stream = await host_sftp.open_download(host, secrets, [path])
    except Exception as e:
        raise _fail("download", host_id, path, e, "원격 다운로드 실패")
    return StreamingResponse(stream, media_type=media_type, headers=_attachment_headers(filename))


@router.post("/files/download-zip")
async def download_host_zip(
    host_id: str,
    request: FilePathsRequest,
    username: str = Depends(verify_auth_token),
):
    """여러 항목을 하나의 zip 으로. 파일 하나씩 압축해 흘려보내므로 RAM 을 잡지 않는다."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    paths = [p for p in request.paths if p and p.strip()]
    if not paths:
        raise HTTPException(status_code=400, detail="paths is required")
    try:
        filename, media_type, stream = await host_sftp.open_download(host, secrets, paths)
    except Exception as e:
        raise _fail("download-zip", host_id, paths[:3], e, "원격 다운로드 실패")
    return StreamingResponse(stream, media_type=media_type, headers=_attachment_headers(filename))


@router.post("/files/exists")
async def host_paths_exist(
    host_id: str,
    request: FilePathsRequest,
    username: str = Depends(verify_auth_token),
):
    """업로드 전 덮어쓰기 확인용 — 존재하는 경로만 알려준다."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        existing = await host_sftp.path_exists(host, secrets, request.paths)
    except Exception as e:
        raise _fail("exists", host_id, request.paths[:3], e, "원격 경로 확인 실패")
    return {"host_id": host_id, "existing": [p for p, yes in existing.items() if yes]}


@router.head("/files/download", include_in_schema=False)
async def head_host_file_download(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    await resolve_host_with_secrets(host_id, username)
    filename = os.path.basename(path.rstrip("/")) or "download"
    return Response(
        status_code=200,
        media_type="application/octet-stream",
        headers=_attachment_headers(filename),
    )
