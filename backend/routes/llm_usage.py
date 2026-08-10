"""LLM 사용량 API — 로그를 직접 읽어(로컬 import / 원격 SSH) 합쳐 돌려준다.

폴러가 없으므로 이 라우터가 유일한 진입점이다. 캐시가 살아있으면 아무 데도 안 붙고,
`refresh` 를 줘야만 실제로 호스트들을 다시 훑는다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _deps import is_safe_id, verify_auth_token
from llm_usage.config import get_config, public_view, save_config
from llm_usage.service import DEFAULT_DAYS, get_usage, purge_source
from sqlite_storage import storage

router = APIRouter(prefix="/api/llm-usage", tags=["llm-usage"])


@router.get("/summary")
async def llm_usage_summary(
    days: int = Query(DEFAULT_DAYS, description="0=전체, 7/30/90 만 허용"),
    username: str = Depends(verify_auth_token),
):
    """합산 사용량 + 호스트별 내역 + 최근 세션.

    꺼져 있으면 `enabled: false` 로 돌아온다 — 프론트는 그때 이 구획을 아예
    그리지 않는다(에이전트 기능은 옵트인).
    """
    return await get_usage(username, days=days)


@router.post("/refresh")
async def llm_usage_refresh(
    days: int = Query(DEFAULT_DAYS),
    username: str = Depends(verify_auth_token),
):
    """캐시를 무시하고 호스트들을 다시 훑는다 — 사용자가 누를 때만."""
    return await get_usage(username, days=days, force=True)


@router.get("/config")
async def llm_usage_config(username: str = Depends(verify_auth_token)):
    """연동 설정 조회 — 스위치 상태 하나."""
    return public_view(await get_config())


class UsageConfigUpdate(BaseModel):
    enabled: bool | None = None


@router.put("/config")
async def update_llm_usage_config(
    body: UsageConfigUpdate,
    username: str = Depends(verify_auth_token),
):
    await save_config(enabled=body.enabled)
    return public_view(await get_config())


@router.delete("/source/{source_id}")
async def llm_usage_delete_source(source_id: str, username: str = Depends(verify_auth_token)):
    """소스 하나의 사용량을 지금 지운다 — 보관 기간을 기다리지 않는다. 되돌릴 수 없다.

    호스트가 아직 등록돼 있으면 거절한다. 살아 있는 호스트의 기록을 지워봐야 다음
    수집이 다시 채우므로, 눌러도 아무 일도 안 일어난 것처럼 보이는 버튼이 된다.
    """
    if not is_safe_id(source_id) and source_id != "local":
        raise HTTPException(status_code=400, detail="잘못된 소스 id 입니다")
    if source_id != "local" and await storage.get_host(source_id, username):
        raise HTTPException(
            status_code=409,
            detail="아직 등록된 호스트입니다. 호스트를 먼저 삭제하세요.",
        )
    removed = await purge_source(username, source_id)
    return {"source_id": source_id, "removed": removed}
