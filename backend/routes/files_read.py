"""워크스페이스 파일 읽기 — 탐색/인덱스/검색/grep/원본/다운로드.

부수효과가 없는 쪽만 모았다. 쓰기·업로드는 routes/files_write.py.
원격 호스트 파일은 routes/host_files.py 가 담당한다(같은 UI, 다른 저장소).
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
import zipfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from _deps import WORKSPACE_ROOT, validate_path, verify_auth_token
from file_index import (
    _FILE_INDEX_IGNORED, _FILE_INDEX_TTL, _build_file_index, _file_index_cache,
)
from routes.local_git import get_git_status_dict as get_git_status
import host_sftp
from tickets import _consume_file_ticket

logger = logging.getLogger(__name__)

router = APIRouter(tags=["files"])


@router.get("/api/files/workspace")
async def get_workspace_info(username: str = Depends(verify_auth_token)):
    return {
        "root": os.path.abspath(WORKSPACE_ROOT),
        "name": os.path.basename(os.path.abspath(WORKSPACE_ROOT)),
    }


@router.get("/api/files")
async def list_files(
    path: str = Query(""),
    username: str = Depends(verify_auth_token),
):
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    safe_path = validate_path(path)

    if not safe_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {safe_path}")
    if not safe_path.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    git_statuses = await get_git_status()
    items = []
    for item in safe_path.iterdir():
        try:
            relative = os.path.relpath(os.path.abspath(str(item)), workspace_abs).replace("\\", "/")
            git_status = git_statuses.get(relative)
            if not git_status and item.is_dir():
                for f_path in git_statuses:
                    if f_path.startswith(relative + "/"):
                        git_status = "M"
                        break
            items.append({
                "name": item.name,
                "path": relative,
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
                "modified": item.stat().st_mtime,
                "git_status": git_status,
            })
        except Exception as e:
            logger.warning("Failed to read item %s: %s", item, e)
            continue

    items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
    return {"items": items}


@router.get("/api/files/index")
async def get_file_index(username: str = Depends(verify_auth_token)):
    """워크스페이스 전체 파일 path 목록 (한번에). 클라이언트가 fuzzy 매칭 직접 수행.
    응답 캐싱 (30s TTL) — 큰 워크스페이스에서도 두번째 호출부터는 즉시.
    """
    global _file_index_cache
    now = time.time()
    if now - _file_index_cache["ts"] > _FILE_INDEX_TTL:
        _file_index_cache = await asyncio.to_thread(_build_file_index)
    return {
        "files": _file_index_cache["files"],
        "truncated": _file_index_cache["truncated"],
        "ts": _file_index_cache["ts"],
    }


@router.get("/api/files/search")
async def search_files(
    q: str = Query("", min_length=0),
    limit: int = Query(200, ge=1, le=500),
    username: str = Depends(verify_auth_token),
):
    """레거시 — 클라이언트가 인덱스를 못 받았을 때 폴백. 서버에서 substring 매칭.
    신규 클라이언트는 /api/files/index 로 받은 캐시에서 직접 fuzzy 한다.
    """
    query = q.strip().lower()
    if not query:
        return {"items": []}

    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    matches = []
    try:
        for current_root, dirs, files in os.walk(workspace_abs):
            dirs[:] = [d for d in dirs if d not in _FILE_INDEX_IGNORED]
            for file_name in files:
                rel = os.path.relpath(os.path.join(current_root, file_name), workspace_abs).replace("\\", "/")
                if query not in f"{file_name} {rel}".lower():
                    continue
                matches.append({"name": file_name, "path": rel})
                if len(matches) >= limit:
                    break
            if len(matches) >= limit:
                break
        matches.sort(key=lambda item: (not item["name"].lower().startswith(query), item["path"].lower()))
        return {"items": matches}
    except Exception as e:
        logger.error("search files failed (q=%s): %s", q, e)
        raise HTTPException(status_code=500, detail="파일 검색에 실패했습니다.")


@router.get("/api/files/grep")
async def grep_files(
    q: str = Query("", min_length=1, max_length=200),
    limit: int = Query(200, ge=1, le=500),
    username: str = Depends(verify_auth_token),
):
    """워크스페이스 전체 파일 내용 검색(ripgrep). 리터럴·대소문자 무시.
    반응성 우선: 파일당 max-count 10, 최대 1MB 파일, 8s 타임아웃, limit 로 총 결과 상한."""
    query = q.strip()
    if not query:
        return {"items": []}
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    ignore_globs: list[str] = []
    for d in _FILE_INDEX_IGNORED:
        ignore_globs += ["-g", f"!{d}"]
    args = [
        "rg", "--json", "-i", "-F",
        "--max-count", "10", "--max-filesize", "1M", "--max-columns", "300",
        *ignore_globs,
        "-e", query, "--", workspace_abs,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        raise HTTPException(status_code=504, detail="검색 시간이 초과되었습니다.")
    except FileNotFoundError:
        raise HTTPException(status_code=501, detail="ripgrep(rg) 가 설치되어 있지 않습니다.")
    except Exception as e:
        logger.error("grep failed (q=%s): %s", q, e)
        raise HTTPException(status_code=500, detail="검색에 실패했습니다.")

    items = []
    for raw in stdout.splitlines():
        if len(items) >= limit:
            break
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if obj.get("type") != "match":
            continue
        data = obj.get("data", {})
        abs_path = (data.get("path") or {}).get("text")
        if not abs_path:
            continue
        rel = os.path.relpath(abs_path, workspace_abs).replace("\\", "/")
        text = ((data.get("lines") or {}).get("text") or "").rstrip("\n")
        items.append({
            "path": rel,
            "name": os.path.basename(rel),
            "line": data.get("line_number"),
            "text": text[:300],
        })
    return {"items": items, "truncated": len(items) >= limit}


@router.get("/api/files/raw")
async def get_raw_file(
    path: str | None = Query(None),
    ticket: str | None = Query(None),
    authorization: str | None = Header(None),
):
    if ticket:
        ticket_path = _consume_file_ticket(ticket)
        if not ticket_path:
            raise HTTPException(status_code=401, detail="유효하지 않은 파일 티켓입니다")
        safe = Path(ticket_path)
    else:
        if not path:
            raise HTTPException(status_code=400, detail="파일 경로가 필요합니다")
        await verify_auth_token(authorization)
        safe = validate_path(path)
    if not safe.exists() or not safe.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # 워크스페이스 안에 만들어진 심볼릭 링크로 외부 경로(/etc/passwd 등) 노출 차단.
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
    return FileResponse(str(safe))


MAX_LOCAL_ZIP_BYTES = host_sftp.MAX_DOWNLOAD_BYTES
MAX_LOCAL_ZIP_FILES = host_sftp.MAX_DOWNLOAD_FILES


class _ZipTooLargeError(Exception):
    """워크스페이스 zip 다운로드가 크기/파일 수 제한을 초과."""


# 누적 크기/파일 수 한도를 공유 카운터로 추적하며 base(파일 또는 디렉터리)를 zip 에 추가.
# 단일/다중 다운로드가 같은 로직을 쓰도록 추출 — 한도 검사 드리프트 방지.
def _add_path_to_zip(zf: "zipfile.ZipFile", base: Path, counters: dict) -> None:
    def bump(size: int) -> None:
        counters["total"] += size
        counters["count"] += 1
        if counters["total"] > MAX_LOCAL_ZIP_BYTES or counters["count"] > MAX_LOCAL_ZIP_FILES:
            raise _ZipTooLargeError(
                f"download too large (>{MAX_LOCAL_ZIP_BYTES} bytes or "
                f"> {MAX_LOCAL_ZIP_FILES} files)"
            )

    if base.is_file():
        try:
            bump(base.stat().st_size)
        except OSError:
            return
        zf.write(base, base.name)
        return

    for current_root, dirs, files in os.walk(base, followlinks=False):
        # 심볼릭 링크 디렉토리는 따라가지 않음 — zip 폭탄/순환 방지.
        dirs[:] = [d for d in dirs if not (Path(current_root) / d).is_symlink()]
        current = Path(current_root)
        if not dirs and not files:
            zf.writestr(f"{current.relative_to(base.parent).as_posix()}/", b"")
        for file_name in files:
            file_path = current / file_name
            if file_path.is_symlink():
                continue
            try:
                size = file_path.stat().st_size
            except OSError:
                continue
            bump(size)
            zf.write(file_path, file_path.relative_to(base.parent).as_posix())


def _zip_directory_bytes(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        _add_path_to_zip(zf, root, {"total": 0, "count": 0})
    return buffer.getvalue()


def _zip_paths_bytes(paths: list[Path]) -> bytes:
    buffer = io.BytesIO()
    counters = {"total": 0, "count": 0}
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for base in paths:
            _add_path_to_zip(zf, base, counters)
    return buffer.getvalue()


@router.get("/api/files/download")
async def download_workspace_item(
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
    if safe.is_file():
        return FileResponse(str(safe), filename=safe.name)
    if safe.is_dir():
        filename = f"{safe.name or 'workspace'}.zip"
        quoted = quote(filename)
        try:
            data = await asyncio.to_thread(_zip_directory_bytes, safe)
        except _ZipTooLargeError as e:
            raise HTTPException(status_code=413, detail=str(e))
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    raise HTTPException(status_code=400, detail="Unsupported file type")


class DownloadZipRequest(BaseModel):
    paths: list[str] = Field(..., min_length=1, max_length=500)


@router.post("/api/files/download-zip")
async def download_workspace_zip(
    body: DownloadZipRequest,
    username: str = Depends(verify_auth_token),
):
    """다중 선택 항목을 단일 zip 으로 묶어 다운로드 (로컬 워크스페이스)."""
    raw_paths = [p for p in body.paths if p and p.strip()]
    if not raw_paths:
        raise HTTPException(status_code=400, detail="No paths provided")
    safes: list[Path] = []
    for p in raw_paths:
        safe = validate_path(p)
        if not safe.exists():
            raise HTTPException(status_code=404, detail=f"Not found: {p}")
        if safe.is_symlink():
            raise HTTPException(status_code=403, detail="Symlinks not allowed")
        safes.append(safe)
    try:
        data = await asyncio.to_thread(_zip_paths_bytes, safes)
    except _ZipTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    filename = f"download-{len(safes)}-items.zip"
    quoted = quote(filename)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )


@router.head("/api/files/download", include_in_schema=False)
async def head_workspace_item_download(
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_file():
        quoted = quote(safe.name)
        return Response(
            status_code=200,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
                "Content-Length": str(safe.stat().st_size),
            },
        )
    if safe.is_dir():
        filename = f"{safe.name or 'workspace'}.zip"
        quoted = quote(filename)
        return Response(
            status_code=200,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    raise HTTPException(status_code=400, detail="Unsupported file type")


@router.get("/api/files/read")
async def read_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
    if not safe.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    if safe.stat().st_size > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    try:
        return {"content": safe.read_text(encoding="utf-8"), "path": path}
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Binary file not supported")


