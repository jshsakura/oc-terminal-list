"""LLM 사용량 API — 각 호스트의 llm-watcher 를 읽어 합쳐서 돌려준다.

폴러가 없으므로 이 라우터가 유일한 진입점이다. 캐시가 살아있으면 네트워크를 타지
않고, `refresh` 를 줘야만 실제로 호스트들을 다시 찌른다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _deps import verify_auth_token
from llm_usage.config import get_config, public_view, save_config
from llm_usage.service import DEFAULT_DAYS, get_usage

router = APIRouter(prefix="/api/llm-usage", tags=["llm-usage"])

# 사용자가 붙일 수 있는 URL 길이 상한 — 경계에서 막는다.
MAX_URL_LEN = 500
MAX_KEY_LEN = 500


@router.get("/summary")
async def llm_usage_summary(
    days: int = Query(DEFAULT_DAYS, description="0=전체, 7/30/90 만 허용"),
    username: str = Depends(verify_auth_token),
):
    """합산 사용량 + 호스트별 내역 + 최근 세션.

    watcher 가 한 대도 없으면 `ok_count: 0` 으로 돌아온다 — 프론트는 그때 이 섹션을
    아예 그리지 않는다(에이전트 기능은 옵트인).
    """
    return await get_usage(username, days=days)


@router.post("/refresh")
async def llm_usage_refresh(
    days: int = Query(DEFAULT_DAYS),
    username: str = Depends(verify_auth_token),
):
    """캐시를 무시하고 호스트들을 다시 조회한다 — 사용자가 누를 때만."""
    return await get_usage(username, days=days, force=True)


@router.get("/config")
async def llm_usage_config(username: str = Depends(verify_auth_token)):
    """연동 설정 조회. **API 키 자체는 절대 나가지 않는다** — 있는지만 알려준다."""
    return public_view(await get_config())


class WatcherConfigUpdate(BaseModel):
    enabled: bool | None = None
    url: str | None = None
    # None = 그대로 두기, "" = 지우기. 저장 후에도 응답에 실리지 않는다.
    api_key: str | None = None


@router.put("/config")
async def update_llm_usage_config(
    body: WatcherConfigUpdate,
    username: str = Depends(verify_auth_token),
):
    url = body.url
    if url is not None:
        url = url.strip()
        if len(url) > MAX_URL_LEN:
            raise HTTPException(status_code=400, detail="주소가 너무 깁니다")
        if url and not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="주소는 http:// 또는 https:// 로 시작해야 합니다")
    if body.api_key is not None and len(body.api_key) > MAX_KEY_LEN:
        raise HTTPException(status_code=400, detail="API 키가 너무 깁니다")

    await save_config(enabled=body.enabled, url=url, api_key=body.api_key)
    return public_view(await get_config())
