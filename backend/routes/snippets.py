"""커맨드 스니펫 CRUD — 사용자별 저장 명령 팔레트."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from _deps import verify_auth_token
from sqlite_storage import storage

router = APIRouter(prefix="/api/snippets", tags=["snippets"])


class SnippetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    command: str = Field(..., min_length=1, max_length=4000)
    tags: str = Field(default='', max_length=500)
    sort_index: int = Field(default=0)


class SnippetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    command: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    tags: Optional[str] = Field(default=None, max_length=500)
    sort_index: Optional[int] = None


@router.get("")
async def list_snippets(username: str = Depends(verify_auth_token)):
    return await storage.list_snippets(username)


@router.post("", status_code=201)
async def create_snippet(body: SnippetCreate, username: str = Depends(verify_auth_token)):
    snippet_id = str(uuid.uuid4())
    return await storage.create_snippet(
        username=username,
        snippet_id=snippet_id,
        name=body.name,
        command=body.command,
        tags=body.tags,
        sort_index=body.sort_index,
    )


@router.put("/{snippet_id}")
async def update_snippet(snippet_id: str, body: SnippetUpdate, username: str = Depends(verify_auth_token)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await storage.update_snippet(username, snippet_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"ok": True}


@router.delete("/{snippet_id}")
async def delete_snippet(snippet_id: str, username: str = Depends(verify_auth_token)):
    deleted = await storage.delete_snippet(username, snippet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"ok": True}
