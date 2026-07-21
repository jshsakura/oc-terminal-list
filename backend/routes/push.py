"""웹 푸시 구독 관리 — 공개키 조회 / 구독 등록 / 해제.

구독 등록 자체가 사용자의 opt-in 이다(브라우저 알림 권한 + 구독 생성).
별도 설정 토글은 두지 않는다 — 끄려면 해제하면 된다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from _deps import verify_auth_token
from push_keys import get_public_key
from sqlite_storage import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/push", tags=["push"])


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=2000)
    p256dh: str = Field(..., min_length=1, max_length=200)
    auth: str = Field(..., min_length=1, max_length=100)


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=2000)


@router.get("/public-key")
async def push_public_key(username: str = Depends(verify_auth_token)):
    """구독을 만들 때 브라우저에 넘길 VAPID 공개키."""
    return {"publicKey": get_public_key()}


@router.get("/status")
async def push_status(username: str = Depends(verify_auth_token)):
    return {"subscriptions": await storage.count_push_subscriptions(username)}


@router.post("/subscribe")
async def push_subscribe(
    request: PushSubscribeRequest,
    user_agent: str | None = Header(None),
    username: str = Depends(verify_auth_token),
):
    if not request.endpoint.startswith("https://"):
        # 푸시 서비스 endpoint 는 항상 https 다. 아니면 위조된 요청이다.
        raise HTTPException(status_code=400, detail="유효하지 않은 푸시 endpoint 입니다")
    await storage.save_push_subscription(
        username, request.endpoint, request.p256dh, request.auth, (user_agent or "")[:300],
    )
    return {"status": "subscribed"}


@router.delete("/subscribe")
async def push_unsubscribe(
    request: PushUnsubscribeRequest,
    username: str = Depends(verify_auth_token),
):
    await storage.delete_push_subscription(request.endpoint)
    return {"status": "unsubscribed"}
