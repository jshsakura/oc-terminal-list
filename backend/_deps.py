"""공용 의존성: 워크스페이스 경로 검증, 인증 토큰, subprocess 헬퍼.

main.py 와 routes/* 가 공유하는 순수 유틸. main.py 가 어플 시작 시
`set_auth_manager()` 로 인증 관리자를 주입한다.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)


# ---------------------- 워크스페이스 ----------------------

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_WORKSPACE = os.path.join(_PROJECT_ROOT, "workspace")
WORKSPACE_ROOT = os.path.abspath(os.getenv("WORKSPACE_ROOT") or _DEFAULT_WORKSPACE)


def validate_path(path) -> Path:
    """워크스페이스 외부 접근을 차단하며 안전한 절대 경로 반환."""
    workspace = Path(WORKSPACE_ROOT).resolve()
    if path is None or str(path).strip() in ("/", "", "None"):
        return workspace
    clean = os.path.normpath(str(path).strip().lstrip("/"))
    requested = (workspace / clean).resolve()
    try:
        requested.relative_to(workspace)
    except ValueError:
        return workspace
    return requested


# ---------------------- 인증 ----------------------

_auth_manager = None


def set_auth_manager(mgr) -> None:
    global _auth_manager
    _auth_manager = mgr


async def verify_auth_token(
    authorization: str | None = Header(None),
) -> str:
    actual = None
    if authorization and authorization.startswith("Bearer "):
        actual = authorization[len("Bearer "):]
    if not actual:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다")
    if not _auth_manager:
        raise HTTPException(status_code=503, detail="인증 관리자가 초기화되지 않았습니다")
    username = await _auth_manager.verify_token(actual)
    if not username:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return username


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
