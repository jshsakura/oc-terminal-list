"""세션을 어디서·무엇으로 띄울지, 그리고 이 세션이 누구 것인지.

cwd/셸 해소는 REST 생성 경로와 WebSocket attach 경로가 **똑같이** 써야 한다 —
두 경로가 갈리면 같은 세션이 열리는 위치가 진입점마다 달라진다.
소유권 검사(_assert_session_owner)도 두 경로 공통이라 여기 둔다.
"""
from __future__ import annotations

import logging
import os

from fastapi import HTTPException

from _deps import WORKSPACE_ROOT, validate_path
from sqlite_storage import storage

logger = logging.getLogger(__name__)


def _basename_or_none(p: str | None) -> str | None:
    return os.path.basename(p) if p else None


def _resolve_create_cwd(req_cwd: str | None) -> str:
    """세션 생성 cwd 결정. 워크스페이스 외부는 차단."""
    if not req_cwd:
        return os.path.abspath(WORKSPACE_ROOT)
    target = validate_path(req_cwd)
    if not target.exists():
        raise HTTPException(status_code=400, detail=f"디렉토리가 존재하지 않습니다: {req_cwd}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"디렉토리가 아닙니다: {req_cwd}")
    if not os.access(str(target), os.X_OK):
        raise HTTPException(status_code=400, detail=f"디렉토리에 접근 권한이 없습니다: {req_cwd}")
    return str(target.absolute())


def _resolve_shell(requested: str | None) -> str | None:
    """프론트가 보내는 'auto'/'bash'/'zsh'/'sh' 를 실제 실행 경로로 변환."""
    candidates = {
        "bash": ["/bin/bash", "/usr/bin/bash"],
        "zsh": ["/bin/zsh", "/usr/bin/zsh"],
        "sh": ["/bin/sh", "/usr/bin/sh"],
    }
    if not requested or requested.strip().lower() in ("auto", ""):
        return None  # tmux가 사용자 기본 셸 사용
    key = requested.strip().lower()
    for path in candidates.get(key, []):
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
    return None


async def _assert_session_owner(session_id: str, username: str) -> None:
    """세션 REST 엔드포인트 소유권 체크. WS attach 의 동일 로직(existing_owner 비교)을 재사용.
    세션이 DB 에 없으면(owner=None) 통과 — WS 쪽과 동일하게 신규/미기록 세션은 허용."""
    try:
        owner = await storage.get_session_owner(session_id)
    except Exception:
        owner = None
    if owner and owner != username:
        raise HTTPException(status_code=403, detail="세션 접근 권한 없음")


