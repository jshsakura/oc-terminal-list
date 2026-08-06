"""파일/경로 관련 Pydantic 모델 + 길이 상수.

main.py 와 routes/* 가 공유한다.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

MAX_PATH_FIELD_LEN = 4096
MAX_FILE_WRITE_BYTES = 10 * 1024 * 1024  # 10MB 텍스트 쓰기 상한 (read 와 대칭)
MAX_BATCH_PATHS = 500  # 한 번에 다룰 경로 개수 상한 (zip 다운로드 / 존재확인)


class FileWriteRequest(BaseModel):
    path: str = Field(max_length=MAX_PATH_FIELD_LEN)
    content: str = Field(max_length=MAX_FILE_WRITE_BYTES)


class FileCreateRequest(BaseModel):
    path: str = Field(max_length=MAX_PATH_FIELD_LEN)
    type: str = Field(pattern="^(file|directory)$")


class FileMoveRequest(BaseModel):
    source: str = Field(max_length=MAX_PATH_FIELD_LEN)
    destination: str = Field(max_length=MAX_PATH_FIELD_LEN)


class HostFileWriteRequest(BaseModel):
    path: str = Field(max_length=MAX_PATH_FIELD_LEN)
    content: str = Field(max_length=MAX_FILE_WRITE_BYTES)


class FilePathsRequest(BaseModel):
    """여러 경로를 한 번에 받는 요청 (zip 다운로드 / 존재 확인)."""
    paths: list[str] = Field(min_length=1, max_length=MAX_BATCH_PATHS)


class FileChmodRequest(BaseModel):
    """권한 변경. mode 는 8진 퍼미션 비트(0o644 = 420)."""
    path: str = Field(max_length=MAX_PATH_FIELD_LEN)
    mode: int = Field(ge=0, le=0o7777)
    recursive: bool = False
