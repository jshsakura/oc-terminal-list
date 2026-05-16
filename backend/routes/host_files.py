"""원격 호스트 SFTP 파일 API — 디렉토리/읽기/다운로드/쓰기/생성/업로드/이동/삭제."""
from __future__ import annotations

import logging
import os
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File as FastAPIFile,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import Response

import host_sftp
from _deps import verify_auth_token
from file_models import FileCreateRequest, FileMoveRequest, HostFileWriteRequest
from host_common import (
    MAX_REMOTE_PATH_LEN,
    MAX_UPLOAD_FILE_BYTES,
    MAX_UPLOAD_FILES,
    MAX_UPLOAD_TOTAL_BYTES,
    resolve_host_with_secrets,
)
from host_manager import HostConnectError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hosts/{host_id}", tags=["host-files"])


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
        return {
            "items": result["items"],
            "path": result["resolved"],
            "resolved": result["resolved"],
            "host_id": host_id,
        }
    except HostConnectError as e:
        logger.warning("SFTP list failed (%s, %s): %s", host_id, target, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP list failed (%s, %s): %s", host_id, target, e)
        raise HTTPException(status_code=500, detail="원격 디렉토리 조회 실패")


@router.get("/files/read")
async def read_host_file(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        content = await host_sftp.read_file(host, secrets, path)
        return {"content": content, "path": path, "host_id": host_id}
    except HostConnectError as e:
        logger.warning("SFTP read failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP read failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail="원격 파일 읽기 실패")


@router.get("/files/download")
async def download_host_file(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        data, filename, media_type = await host_sftp.download_item(host, secrets, path)
        quoted = quote(filename)
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    except HostConnectError as e:
        logger.warning("SFTP download failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP download failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail="원격 다운로드 실패")


@router.head("/files/download", include_in_schema=False)
async def head_host_file_download(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    await resolve_host_with_secrets(host_id, username)
    filename = os.path.basename(path.rstrip("/")) or "download"
    quoted = quote(filename)
    return Response(
        status_code=200,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )


@router.post("/files/write")
async def write_host_file(
    host_id: str,
    request: HostFileWriteRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.write_file(host, secrets, request.path, request.content)
        return {"status": "written", "path": request.path, "host_id": host_id}
    except HostConnectError as e:
        logger.warning("SFTP write failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP write failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=500, detail="원격 파일 쓰기 실패")


@router.post("/files/create")
async def create_host_file(
    host_id: str,
    request: FileCreateRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.create_item(host, secrets, request.path, request.type)
        return {"status": "created", "path": request.path, "host_id": host_id}
    except HostConnectError as e:
        logger.warning("SFTP create failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP create failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=500, detail="원격 파일/폴더 생성 실패")


@router.post("/files/upload")
async def upload_host_files(
    host_id: str,
    files: list[UploadFile] = FastAPIFile(...),
    dest: str = Form(""),
    username: str = Depends(verify_auth_token),
):
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 많습니다 (최대 {MAX_UPLOAD_FILES}개)")
    if len(dest) > MAX_REMOTE_PATH_LEN:
        raise HTTPException(status_code=400, detail="dest 경로가 너무 깁니다")
    host, secrets = await resolve_host_with_secrets(host_id, username)
    remote_dir = dest or "/"
    results = []
    total = 0
    for f in files:
        filename = os.path.basename(f.filename or "")
        if not filename:
            continue
        content = await f.read()
        if len(content) > MAX_UPLOAD_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"파일 '{filename}' 가 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)")
        total += len(content)
        if total > MAX_UPLOAD_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail=f"업로드 합계가 너무 큽니다 (최대 {MAX_UPLOAD_TOTAL_BYTES} bytes)")
        remote_path = f"{remote_dir.rstrip('/')}/{filename}"
        try:
            await host_sftp.write_file(host, secrets, remote_path, content)
        except HostConnectError as e:
            logger.warning("SFTP upload failed (%s, %s): %s", host_id, remote_path, e)
            raise HTTPException(status_code=502, detail=str(e))
        except Exception as e:
            logger.warning("SFTP upload failed (%s, %s): %s", host_id, remote_path, e)
            raise HTTPException(status_code=500, detail="원격 업로드 실패")
        results.append({"name": filename, "path": remote_path, "size": len(content)})
    return {"status": "uploaded", "host_id": host_id, "files": results}


@router.post("/files/move")
async def move_host_file(
    host_id: str,
    request: FileMoveRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.move_item(host, secrets, request.source, request.destination)
        return {"status": "moved", "source": request.source, "destination": request.destination, "host_id": host_id}
    except HostConnectError as e:
        logger.warning("SFTP move failed (%s, %s -> %s): %s", host_id, request.source, request.destination, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP move failed (%s, %s -> %s): %s", host_id, request.source, request.destination, e)
        raise HTTPException(status_code=500, detail="원격 파일/폴더 이동 실패")


@router.delete("/files")
async def delete_host_file(
    host_id: str,
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.delete_item(host, secrets, path)
        return {"status": "deleted", "path": path, "host_id": host_id}
    except HostConnectError as e:
        logger.warning("SFTP delete failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("SFTP delete failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail="원격 파일/폴더 삭제 실패")
