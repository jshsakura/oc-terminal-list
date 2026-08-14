"""워크스페이스 파일 쓰기 — 생성/수정/이동/삭제/업로드/터미널 붙여넣기.

전부 부수효과가 있는 쪽이다. 경로는 예외 없이 validate_path 를 통과해야 하고
(워크스페이스 탈출 차단), 변경 후에는 파일 인덱스를 무효화한다.
읽기 전용 엔드포인트는 routes/files_read.py.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File as FastAPIFile, Form, HTTPException, Query, UploadFile

from _deps import WORKSPACE_ROOT, validate_path, verify_auth_token
from file_index import _invalidate_file_index
from host_common import (
    MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES,
    resolve_host_with_secrets,
)
from host_manager import HostConnectError
import host_sftp
from paste_targets import (
    local_paste_dir, remote_home_paste_dir, remote_paste_dir, safe_basename, stamped_name,
)
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


# ---------------------- 터미널 붙여넣기 ----------------------
#
# PTY 는 텍스트만 나른다. 그래서 이미지/파일은 "올리고 경로만 삽입" 으로 우회한다.
# ⚠️ 파일은 **그 pane 이 사는 머신에** 있어야 한다 — 원격 pane 인데 로컬에 올리면
# 붙여넣기는 성공한 것처럼 보이는데 상대 셸은 그 경로를 열 수 없다.


async def _save_local_paste(file: UploadFile, filename: str) -> dict:
    dest_dir = local_paste_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / filename
    tmp = target.with_suffix(target.suffix + ".part")
    size = 0
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_FILE_BYTES:
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
    return {"status": "uploaded", "path": str(target), "size": size, "scope": "local"}


# host_id -> 그 호스트에서 실제로 써지는 붙여넣기 폴더. 한 번 알아내면 계속 쓴다.
# ⚠️ 캐시가 없으면 /tmp 가 막힌 호스트는 **붙여넣을 때마다** 실패 한 번을 먼저 낸다.
_paste_dir_by_host: dict[str, str] = {}


async def _remote_paste_dirs(host_id: str, host: dict, secrets: dict):
    """시도할 폴더를 **게으르게** 내놓는다. 캐시된 게 있으면 그것 하나뿐.

    `/tmp` 를 먼저 두는 이유는 그대로다(재부팅 때 비워져 정리가 필요 없다). 다만
    **"POSIX 면 /tmp 는 쓸 수 있다" 는 전제가 실제로 깨진다** — 이 배포의 한 호스트는
    SFTP 로 /tmp 에 쓰면 SSH_FX_FAILURE(4) 가 나는데 같은 계정 셸로는 touch 가 된다.
    그때 붙여넣기가 통째로 죽는 것보다 홈에 두는 편이 낫다.

    홈 조회는 **/tmp 가 실패한 뒤에만** 한다 — 멀쩡한 호스트가 붙여넣기마다 SSH 왕복을
    하나 더 태울 이유가 없다(테스트가 이 선을 지킨다).
    """
    cached = _paste_dir_by_host.get(host_id)
    if cached:
        yield cached
        return
    yield remote_paste_dir()
    home = await host_sftp.remote_home(host, secrets)
    if home:
        yield remote_home_paste_dir(home)


async def _save_remote_paste(host_id: str, username: str, file: UploadFile, filename: str) -> dict:
    """원격 호스트의 temp 폴더로 SFTP 업로드. /tmp 가 막힌 호스트는 홈으로 떨어진다."""
    content = await file.read(MAX_UPLOAD_FILE_BYTES + 1)
    if len(content) > MAX_UPLOAD_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)")

    host, secrets = await resolve_host_with_secrets(host_id, username)
    last_error: Exception | None = None
    async for remote_dir in _remote_paste_dirs(host_id, host, secrets):
        remote_path = f"{remote_dir}/{filename}"
        try:
            # 폴더가 이미 있으면 실패하는 구현이 있어 무시하고 진행한다 — 실제 판정은 write 가 한다.
            try:
                await host_sftp.create_item(host, secrets, remote_dir, "directory")
            except Exception:
                pass
            await host_sftp.write_file(host, secrets, remote_path, content)
        except Exception as e:
            last_error = e
            logger.warning("paste SFTP failed (%s, %s): %s", host_id, remote_path, e)
            # 캐시된 폴더가 이제 와서 막혔다면 캐시를 버리고 다음 붙여넣기에 다시 찾게 한다.
            if _paste_dir_by_host.get(host_id) == remote_dir:
                _paste_dir_by_host.pop(host_id, None)
            continue
        if _paste_dir_by_host.get(host_id) != remote_dir:
            logger.info("paste dir for %s -> %s", host_id, remote_dir)
        _paste_dir_by_host[host_id] = remote_dir
        return {"status": "uploaded", "path": remote_path, "size": len(content),
                "scope": "host", "host_id": host_id}

    if isinstance(last_error, HostConnectError):
        raise HTTPException(status_code=502, detail=f"원격 호스트에 올리지 못했습니다: {last_error}")
    raise HTTPException(status_code=500, detail="원격 업로드 실패")


@router.post("/api/terminal/paste-image")
async def paste_image(
    file: UploadFile = FastAPIFile(...),
    host_id: str = Form(""),
    username: str = Depends(verify_auth_token),
):
    """클립보드 이미지 → 붙여넣을 pane 이 사는 머신의 temp 폴더."""
    content_type = (file.content_type or "").lower()
    if content_type not in _PASTE_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="이미지 파일만 붙여넣을 수 있습니다")
    filename = stamped_name(f"pasted.{_PASTE_IMAGE_EXT[content_type]}")
    if host_id:
        return await _save_remote_paste(host_id, username, file, filename)
    result = await _save_local_paste(file, filename)
    _invalidate_file_index()
    return result


@router.post("/api/terminal/paste-file")
async def paste_file(
    file: UploadFile = FastAPIFile(...),
    host_id: str = Form(""),
    username: str = Depends(verify_auth_token),
):
    """우클릭 "파일 보내기" / 드래그&드롭 — 이미지 전용 paste-image 의 일반판."""
    filename = stamped_name(safe_basename(file.filename))
    if host_id:
        return await _save_remote_paste(host_id, username, file, filename)
    result = await _save_local_paste(file, filename)
    _invalidate_file_index()
    return result


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


