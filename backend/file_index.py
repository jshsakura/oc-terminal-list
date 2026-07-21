"""워크스페이스 파일 경로 인덱스 — 퀵오픈/검색이 쓰는 캐시.

읽기 쪽(routes/files_read.py)이 만들고, 쓰기 쪽(routes/files_write.py)이 무효화한다.
양쪽이 공유하므로 어느 한쪽에 두면 라우트 모듈끼리 얽힌다 — 그래서 독립 모듈.
"""
from __future__ import annotations

import os
import time

from _deps import WORKSPACE_ROOT


# 워크스페이스 인덱스 캐시 — 모든 파일 path 를 한 번에 들고 와서 클라이언트가
# 직접 fuzzy 매칭하도록 한다 (서버 왕복 제거 → 즉시 반응).
# TTL 30s, 명시적 invalidate (mutating endpoint 들에서 호출) 가능.
_FILE_INDEX_IGNORED = {".git", "node_modules", "dist", "build", "coverage", "__pycache__",
                       ".venv", "venv", ".next", ".turbo", ".idea", ".vscode"}
_FILE_INDEX_TTL = 30.0
_FILE_INDEX_LIMIT = 50000  # 안전 cap — 워크스페이스가 미친듯이 크면 자르고 truncated 표시
_file_index_cache: dict = {"ts": 0.0, "files": [], "truncated": False}


def _build_file_index() -> dict:
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    files: list[str] = []
    truncated = False
    for current_root, dirs, names in os.walk(workspace_abs):
        dirs[:] = [d for d in dirs if d not in _FILE_INDEX_IGNORED]
        for n in names:
            rel = os.path.relpath(os.path.join(current_root, n), workspace_abs).replace("\\", "/")
            files.append(rel)
            if len(files) >= _FILE_INDEX_LIMIT:
                truncated = True
                break
        if truncated:
            break
    return {"ts": time.time(), "files": files, "truncated": truncated}


def _invalidate_file_index() -> None:
    """mutating endpoint 가 호출 — 다음 요청에서 강제 리빌드."""
    _file_index_cache["ts"] = 0.0

