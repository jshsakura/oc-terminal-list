"""원격 호스트 SFTP 파일 API — 부수효과가 있는 쪽.

쓰기 / 생성 / 업로드 / 이동 / 복사 / 삭제 / 권한. 읽기는 `routes/host_files.py`.

업로드는 **청크 스트리밍**이다. 예전처럼 `await f.read()` 로 통째로 받으면
파일 크기가 그대로 프로세스 메모리가 되고, 동시 업로드 몇 개에 죽는다.
"""
from __future__ import annotations

import logging
import posixpath

from fastapi import (
    APIRouter,
    Depends,
    File as FastAPIFile,
    Form,
    HTTPException,
    Query,
    UploadFile,
)

import host_sftp
from _deps import verify_auth_token
from file_models import FileChmodRequest, FileCreateRequest, FileMoveRequest, HostFileWriteRequest
from host_common import (
    MAX_REMOTE_PATH_LEN,
    MAX_UPLOAD_FILE_BYTES,
    MAX_UPLOAD_FILES,
    MAX_UPLOAD_TOTAL_BYTES,
    resolve_host_with_secrets,
)
from routes.host_files import _fail
from upload_common import (
    TransferBudget,
    join_dest,
    normalize_conflict,
    read_chunks,
    safe_relpath,
    unique_name,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hosts/{host_id}", tags=["host-files"])


@router.post("/files/write")
async def write_host_file(
    host_id: str,
    request: HostFileWriteRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.write_file(host, secrets, request.path, request.content)
    except Exception as e:
        raise _fail("write", host_id, request.path, e, "원격 파일 쓰기 실패")
    return {"status": "written", "path": request.path, "host_id": host_id}


@router.post("/files/create")
async def create_host_file(
    host_id: str,
    request: FileCreateRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.create_item(host, secrets, request.path, request.type)
    except Exception as e:
        raise _fail("create", host_id, request.path, e, "원격 파일/폴더 생성 실패")
    return {"status": "created", "path": request.path, "host_id": host_id}


@router.post("/files/upload")
async def upload_host_files(
    host_id: str,
    files: list[UploadFile] = FastAPIFile(...),
    dest: str = Form(""),
    relpaths: list[str] = Form(default=[]),
    on_conflict: str = Form("overwrite"),
    username: str = Depends(verify_auth_token),
):
    """원격 업로드.

    `relpaths[i]` 는 `files[i]` 의 **목적지 기준 상대 경로**다 — 폴더를 통째로 올릴 때
    `src/utils/a.js` 처럼 들어와 구조가 그대로 재현된다. 없으면 파일명만 쓴다.
    """
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 많습니다 (최대 {MAX_UPLOAD_FILES}개)")
    if len(dest) > MAX_REMOTE_PATH_LEN:
        raise HTTPException(status_code=400, detail="dest 경로가 너무 깁니다")
    conflict = normalize_conflict(on_conflict)

    host, secrets = await resolve_host_with_secrets(host_id, username)
    remote_dir = dest or "/"

    # 목적지 경로를 먼저 다 계산해두고 **존재 여부를 한 번에** 묻는다. 파일마다
    # 왕복하면 100개 업로드에 stat 왕복이 100번 붙는다.
    planned: list[tuple[UploadFile, str]] = []
    for index, f in enumerate(files):
        fallback = posixpath.basename((f.filename or "").replace("\\", "/")) or ""
        rel = safe_relpath(relpaths[index] if index < len(relpaths) else None, fallback)
        if not rel:
            continue
        planned.append((f, join_dest(remote_dir, rel)))
    if not planned:
        return {"status": "uploaded", "host_id": host_id, "files": [], "skipped": []}

    try:
        existing = await host_sftp.path_exists(host, secrets, [p for _, p in planned])
    except Exception as e:
        raise _fail("upload", host_id, remote_dir, e, "원격 업로드 실패")

    taken = dict(existing)
    budget = TransferBudget(MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES)
    results: list[dict] = []
    skipped: list[str] = []

    for upload_file, remote_path in planned:
        target = remote_path
        if taken.get(target):
            if conflict == "skip":
                skipped.append(target)
                continue
            if conflict == "rename":
                target = unique_name(target, lambda p: bool(taken.get(p)))
        budget.start_file()
        name = posixpath.basename(target)
        chunks = read_chunks(upload_file, on_bytes=lambda n, fn=name: budget.add(n, fn))
        try:
            written = await host_sftp.upload_stream(host, secrets, target, chunks)
        except HTTPException:
            raise
        except Exception as e:
            raise _fail("upload", host_id, target, e, "원격 업로드 실패")
        taken[target] = True
        results.append({"name": name, "path": target, "size": written})

    return {"status": "uploaded", "host_id": host_id, "files": results, "skipped": skipped}


@router.post("/files/move")
async def move_host_file(
    host_id: str,
    request: FileMoveRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        existing = await host_sftp.path_exists(host, secrets, [request.destination])
        if existing.get(request.destination):
            raise HTTPException(status_code=409, detail="Destination already exists")
        await host_sftp.move_item(host, secrets, request.source, request.destination)
    except HTTPException:
        raise
    except Exception as e:
        raise _fail("move", host_id, f"{request.source} -> {request.destination}", e,
                    "원격 파일/폴더 이동 실패")
    return {
        "status": "moved",
        "source": request.source,
        "destination": request.destination,
        "host_id": host_id,
    }


@router.post("/files/copy")
async def copy_host_file(
    host_id: str,
    request: FileMoveRequest,
    username: str = Depends(verify_auth_token),
):
    """원격 안에서의 복사. 목적지가 이미 있으면 번호를 붙여 비켜 간다."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        existing = await host_sftp.path_exists(host, secrets, [request.destination])
        destination = request.destination
        if existing.get(destination):
            probe = await host_sftp.path_exists(
                host, secrets, _candidates(destination))
            destination = unique_name(destination, lambda p: bool(probe.get(p, False)))
        await host_sftp.copy_item(host, secrets, request.source, destination)
    except HTTPException:
        raise
    except Exception as e:
        raise _fail("copy", host_id, f"{request.source} -> {request.destination}", e,
                    "원격 파일/폴더 복사 실패")
    return {
        "status": "copied",
        "source": request.source,
        "destination": destination,
        "host_id": host_id,
    }


def _candidates(path: str, count: int = 20) -> list[str]:
    """`unique_name` 이 물어볼 후보들을 미리 만들어 존재 확인을 **한 번**으로 끝낸다."""
    directory = posixpath.dirname(path)
    stem, dot, ext = posixpath.basename(path).partition(".")
    out = [path]
    for i in range(1, count + 1):
        name = f"{stem} ({i}){dot}{ext}"
        out.append(posixpath.join(directory, name) if directory else name)
    return out


@router.post("/files/chmod")
async def chmod_host_file(
    host_id: str,
    request: FileChmodRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.chmod_item(host, secrets, request.path, request.mode, request.recursive)
    except Exception as e:
        raise _fail("chmod", host_id, request.path, e, "원격 권한 변경 실패")
    return {"status": "chmod", "path": request.path, "mode": request.mode, "host_id": host_id}


@router.delete("/files")
async def delete_host_file(
    host_id: str,
    path: str = Query(...),
    recursive: bool = Query(True, description="폴더를 내용째 지운다. false 면 빈 폴더만."),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.delete_item(host, secrets, path, recursive)
    except Exception as e:
        raise _fail("delete", host_id, path, e, "원격 파일/폴더 삭제 실패")
    return {"status": "deleted", "path": path, "host_id": host_id}
