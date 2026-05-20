"""공용 의존성: 워크스페이스 경로 검증, 인증 토큰, subprocess 헬퍼.

main.py 와 routes/* 가 공유하는 순수 유틸. main.py 가 어플 시작 시
`set_auth_manager()` 로 인증 관리자를 주입한다.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from fastapi import Cookie, Header, HTTPException

logger = logging.getLogger(__name__)


# ---------------------- 워크스페이스 ----------------------

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_WORKSPACE = os.path.join(_PROJECT_ROOT, "workspace")
WORKSPACE_ROOT = os.path.abspath(os.getenv("WORKSPACE_ROOT") or _DEFAULT_WORKSPACE)


def validate_path(path, *, allow_root: bool = True) -> Path:
    """워크스페이스 외부 접근을 차단하며 안전한 절대 경로 반환.

    예전 구현은 path traversal/symlink escape 를 workspace root 로 조용히 보정했다.
    변경/삭제 API 에서 그 동작은 의도치 않은 root 대상 작업으로 이어질 수 있으므로
    이제는 명시적으로 거절한다.
    """
    workspace = Path(WORKSPACE_ROOT).resolve()
    raw = "" if path is None else str(path).strip()
    if raw in ("", "/", "None"):
        if not allow_root:
            raise HTTPException(status_code=400, detail="워크스페이스 루트는 이 작업의 대상이 될 수 없습니다")
        return workspace
    clean = os.path.normpath(raw.lstrip("/"))
    if clean in ("", "."):
        if not allow_root:
            raise HTTPException(status_code=400, detail="워크스페이스 루트는 이 작업의 대상이 될 수 없습니다")
        return workspace
    requested = (workspace / clean).resolve()
    try:
        requested.relative_to(workspace)
    except ValueError:
        raise HTTPException(status_code=403, detail="워크스페이스 외부 경로는 허용되지 않습니다") from None
    return requested


# ---------------------- 인증 ----------------------

_auth_manager = None
AUTH_COOKIE_NAME = "iterm_auth"


def set_auth_manager(mgr) -> None:
    global _auth_manager
    _auth_manager = mgr


async def verify_auth_token(
    authorization: str | None = Header(None),
    auth_cookie: str | None = Cookie(None, alias=AUTH_COOKIE_NAME),
) -> str:
    candidates: list[str] = []
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[len("Bearer "):].strip()
        if bearer and bearer.lower() not in {"null", "undefined"}:
            candidates.append(bearer)
    if auth_cookie:
        candidates.append(auth_cookie)
    if not candidates:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다")
    if not _auth_manager:
        raise HTTPException(status_code=503, detail="인증 관리자가 초기화되지 않았습니다")
    for token in candidates:
        username = await _auth_manager.verify_token(token)
        if username:
            return username
    raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")


# ---------------------- subprocess ----------------------

GIT_STATUS_TIMEOUT = 30
GIT_QUICK_TIMEOUT = 5
GIT_DIFF_TIMEOUT = 30
GIT_COMMIT_TIMEOUT = 30
GIT_PUSH_TIMEOUT = 120


async def run_proc(args: list[str], timeout: float, **kwargs) -> tuple[int, bytes, bytes]:
    """create_subprocess_exec + wait_for. 타임아웃 시 proc 강제 종료."""
    proc = await asyncio.create_subprocess_exec(*args, **kwargs)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        try:
            await proc.wait()
        except Exception:
            pass
        raise
    return proc.returncode or 0, stdout or b"", stderr or b""
