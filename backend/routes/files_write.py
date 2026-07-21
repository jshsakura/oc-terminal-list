"""워크스페이스 파일 쓰기 — 생성/수정/이동/삭제/업로드/터미널 붙여넣기.

전부 부수효과가 있는 쪽이다. 경로는 예외 없이 validate_path 를 통과해야 하고
(워크스페이스 탈출 차단), 변경 후에는 파일 인덱스를 무효화한다.
읽기 전용 엔드포인트는 routes/files_read.py.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File as FastAPIFile, Form, HTTPException, Query, UploadFile

from _deps import WORKSPACE_ROOT, validate_path, verify_auth_token
from file_index import _invalidate_file_index
from host_common import MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES
from file_models import FileCreateRequest, FileMoveRequest, FileWriteRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["files"])


@router.post("/api/files/write")
async def write_file(request: FileWriteRequest, username: str = Depends(verify_auth_token)):
    safe = validate_path(request.path, allow_root=False)
    safe.parent.mkdir(parents=True, exist_ok=True)
    safe.write_text(request.content, encoding="utf-8")
    return {"status": "written", "path": request.path}


@router.post("/api/files/move")
async def move_file(request: FileMoveRequest, username: str = Depends(verify_auth_token)):
    src = validate_path(request.source, allow_root=False)
    dst = validate_path(request.destination, allow_root=False)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    _invalidate_file_index()
    return {"status": "moved", "source": request.source, "destination": request.destination}


@router.post("/api/files/create")
async def create_file(request: FileCreateRequest, username: str = Depends(verify_auth_token)):
    safe = validate_path(request.path, allow_root=False)
    if safe.exists():
        raise HTTPException(status_code=409, detail="Already exists")
    if request.type == "directory":
        safe.mkdir(parents=True, exist_ok=True)
    elif request.type == "file":
        safe.parent.mkdir(parents=True, exist_ok=True)
        safe.touch()
    else:
        raise HTTPException(status_code=400, detail="Invalid type (must be 'file' or 'directory')")
    _invalidate_file_index()
    return {"status": "created", "path": request.path, "type": request.type}


@router.post("/api/files/upload")
async def upload_files(
    files: list[UploadFile] = FastAPIFile(...),
    dest: str = Form(""),
    username: str = Depends(verify_auth_token),
):
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 많습니다 (최대 {MAX_UPLOAD_FILES}개)")
    workspace = Path(WORKSPACE_ROOT)
    dest_path = validate_path(dest) if dest else workspace
    if not dest_path.is_dir():
        raise HTTPException(status_code=400, detail="Destination is not a directory")
    results = []
    total = 0
    upload_chunk = 1024 * 1024  # 1 MB
    for f in files:
        filename = os.path.basename(f.filename or "")
        if not filename:
            continue
        target = dest_path / filename
        if not str(target.resolve()).startswith(str(workspace.resolve())):
            raise HTTPException(status_code=403, detail="Path outside workspace")
        target.parent.mkdir(parents=True, exist_ok=True)
        # 스트리밍 쓰기 — f.read() 로 전체 메모리 적재 시 200MB×N 업로드가 OOM 위험.
        # 청크 단위로 디스크에 직접 쓰고, 한도 초과 시 부분 파일 삭제.
        file_size = 0
        tmp = target.with_suffix(target.suffix + ".part")
        try:
            with open(tmp, "wb") as out:
                while True:
                    chunk = await f.read(upload_chunk)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_UPLOAD_FILE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"파일 '{filename}' 가 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                        )
                    total += len(chunk)
                    if total > MAX_UPLOAD_TOTAL_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"업로드 합계가 너무 큽니다 (최대 {MAX_UPLOAD_TOTAL_BYTES} bytes)",
                        )
                    out.write(chunk)
            os.replace(tmp, target)
        except Exception:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise
        rel = str(target.relative_to(workspace)).replace("\\", "/")
        results.append({"name": f.filename, "path": rel, "size": file_size})
    _invalidate_file_index()
    return {"status": "uploaded", "files": results}


# 클립보드 이미지 붙여넣기 전용 — 단일 이미지 저장 후 절대경로 반환.
# 터미널에서 paste 시 프론트가 이 경로를 입력으로 주입해 Claude Code 등이 바로 읽게 한다.
_PASTE_IMAGE_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
}


@router.post("/api/terminal/paste-image")
async def paste_image(
    file: UploadFile = FastAPIFile(...),
    username: str = Depends(verify_auth_token),
):
    content_type = (file.content_type or "").lower()
    if content_type not in _PASTE_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="이미지 파일만 붙여넣을 수 있습니다")

    workspace = Path(WORKSPACE_ROOT)
    dest_dir = workspace / ".pasted"
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = _PASTE_IMAGE_EXT[content_type]
    stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
    target = dest_dir / f"pasted-{stamp}.{ext}"

    file_size = 0
    chunk_size = 1024 * 1024  # 1 MB
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"이미지가 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                    )
                out.write(chunk)
        os.replace(tmp, target)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise

    _invalidate_file_index()
    rel = str(target.relative_to(workspace)).replace("\\", "/")
    return {"status": "uploaded", "path": str(target), "rel_path": rel, "size": file_size}


@router.post("/api/terminal/paste-file")
async def paste_file(
    file: UploadFile = FastAPIFile(...),
    username: str = Depends(verify_auth_token),
):
    """터미널로 보낼 임의 파일 업로드 — .pasted/ 에 저장하고 경로를 돌려준다.
    이미지 전용 paste-image 의 일반판(사진/파일 아무거나 골라 보내기). 파일명은 basename+화이트리스트로
    정규화해 경로 traversal 을 원천 차단하고, 타임스탬프 prefix 로 충돌을 막는다."""
    workspace = Path(WORKSPACE_ROOT)
    dest_dir = workspace / ".pasted"
    dest_dir.mkdir(parents=True, exist_ok=True)

    raw_name = os.path.basename(file.filename or "file").strip() or "file"
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)[:80].lstrip(".") or "file"
    stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
    target = dest_dir / f"{stamp}-{safe_name}"

    file_size = 0
    chunk_size = 1024 * 1024  # 1 MB
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"파일이 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                    )
                out.write(chunk)
        os.replace(tmp, target)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise

    _invalidate_file_index()
    rel = str(target.relative_to(workspace)).replace("\\", "/")
    return {"status": "uploaded", "path": str(target), "rel_path": rel, "size": file_size}


@router.delete("/api/files")
async def delete_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path, allow_root=False)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_dir():
        shutil.rmtree(safe)
    else:
        safe.unlink()
    _invalidate_file_index()
    return {"status": "deleted", "path": path}


