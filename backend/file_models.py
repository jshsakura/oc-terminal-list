"""파일/경로 관련 Pydantic 모델 + 길이 상수.

main.py 와 routes/* 가 공유한다.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

MAX_PATH_FIELD_LEN = 4096
MAX_FILE_WRITE_BYTES = 10 * 1024 * 1024  # 10MB 텍스트 쓰기 상한 (read 와 대칭)


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
