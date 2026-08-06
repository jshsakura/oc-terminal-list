"""업로드 공통 규칙 — 청크 스트리밍, 크기 상한, 이름 충돌 처리.

로컬(워크스페이스)과 원격(SFTP) 업로드가 **같은 규칙**을 쓰도록 한 곳에 모았다.
어느 한쪽만 조용히 덮어쓰거나 한쪽만 폴더 구조를 살리면 사용자는 그걸 버그로
인식하지 못하고 그냥 참고 쓴다.
"""
from __future__ import annotations

import posixpath
import re

from fastapi import HTTPException

# 업로드 스트리밍 청크. HTTP 수신 버퍼와 SFTP 쓰기 단위를 겸한다.
UPLOAD_CHUNK_BYTES = 1024 * 1024  # 1 MB

# 충돌 처리 방식 — 프론트가 사용자에게 물어본 결과를 그대로 넘긴다.
CONFLICT_MODES = ("overwrite", "skip", "rename")
DEFAULT_CONFLICT = "overwrite"

_UNSAFE = re.compile(r"[\x00-\x1f]")


def normalize_conflict(mode: str | None) -> str:
    value = (mode or DEFAULT_CONFLICT).strip().lower()
    if value not in CONFLICT_MODES:
        raise HTTPException(status_code=400, detail=f"on_conflict must be one of {CONFLICT_MODES}")
    return value


def safe_relpath(raw: str | None, fallback: str) -> str:
    """업로드 항목의 **상대 경로**를 안전하게 정규화한다.

    폴더 업로드는 `dir/sub/file.txt` 같은 상대 경로를 그대로 살려야 구조가 보존된다.
    다만 그 경로는 브라우저가 준 문자열이므로 `..` 로 목적지 밖을 짚거나 절대경로로
    바뀌어서는 안 된다 — 여기서 걸러내지 않으면 목적지 폴더를 벗어나 파일이 떨어진다.
    """
    value = (raw or "").replace("\\", "/").strip()
    if not value or _UNSAFE.search(value):
        return fallback
    parts = [p for p in value.split("/") if p not in ("", ".", "..")]
    return "/".join(parts) or fallback


def join_dest(dest_dir: str, relpath: str) -> str:
    base = (dest_dir or "").rstrip("/")
    return f"{base}/{relpath}" if base else relpath


def unique_name(path: str, taken) -> str:
    """`taken(candidate) -> bool` 로 물어가며 비어 있는 이름을 찾는다.

    `report.pdf` → `report (1).pdf` → `report (2).pdf`. 확장자 앞에 번호를 넣는 건
    데스크톱 파일 관리자들의 관습이라 사용자가 결과를 예측할 수 있다.
    """
    if not taken(path):
        return path
    directory = posixpath.dirname(path)
    name = posixpath.basename(path)
    stem, dot, ext = name.partition(".")
    for i in range(1, 1000):
        candidate = f"{stem} ({i}){dot}{ext}"
        full = posixpath.join(directory, candidate) if directory else candidate
        if not taken(full):
            return full
    raise HTTPException(status_code=409, detail="이름 충돌을 해소하지 못했습니다")


async def read_chunks(upload_file, *, on_bytes=None, chunk_size: int = UPLOAD_CHUNK_BYTES):
    """UploadFile 을 청크 async iterator 로. `on_bytes(n)` 로 누계 상한을 검사한다.

    전체를 `await f.read()` 로 읽으면 파일 크기가 그대로 RSS 가 된다 — 200MB 짜리
    동시 업로드 몇 개면 프로세스가 죽는다.
    """
    while True:
        chunk = await upload_file.read(chunk_size)
        if not chunk:
            break
        if on_bytes:
            on_bytes(len(chunk))
        yield chunk


class TransferBudget:
    """이번 요청이 쓸 수 있는 바이트 예산. 초과하면 즉시 413."""

    def __init__(self, per_file: int, total: int) -> None:
        self.per_file = per_file
        self.total = total
        self.total_used = 0
        self.file_used = 0

    def start_file(self) -> None:
        self.file_used = 0

    def add(self, n: int, filename: str) -> None:
        self.file_used += n
        self.total_used += n
        if self.file_used > self.per_file:
            raise HTTPException(
                status_code=413,
                detail=f"파일 '{filename}' 가 너무 큽니다 (최대 {self.per_file} bytes)",
            )
        if self.total_used > self.total:
            raise HTTPException(
                status_code=413,
                detail=f"업로드 합계가 너무 큽니다 (최대 {self.total} bytes)",
            )
