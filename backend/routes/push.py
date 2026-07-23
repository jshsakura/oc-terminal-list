"""웹 푸시 구독 관리 — 공개키 조회 / 구독 등록 / 해제.

구독 등록 자체가 사용자의 opt-in 이다(브라우저 알림 권한 + 구독 생성).
별도 설정 토글은 두지 않는다 — 끄려면 해제하면 된다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from _deps import verify_auth_token
import telegram_client
import telegram_service
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


# ---------------------- 텔레그램 ----------------------
# 웹푸시 액션 버튼이 iOS 에서 안 뜨는 문제 때문에, 버튼이 필요한 알림은 텔레그램이 맡는다.


class TelegramConfigRequest(BaseModel):
    token: str = Field(default="", max_length=200)
    chat_id: str = Field(default="", max_length=64)
    # 알림 "열기" 링크의 기준 주소(예: https://term.example.com). 비우면 버튼 없음.
    base_url: str = Field(default="", max_length=300)


@router.get("/telegram")
async def telegram_status(username: str = Depends(verify_auth_token)):
    """토큰 자체는 절대 돌려주지 않는다 — 설정됐는지만 알린다."""
    config = await telegram_service.get_config()
    return {
        "configured": bool(config["token"] and config["chat_id"]),
        "chat_id": config["chat_id"] or "",
        # env 로 넣었으면 화면에서 토큰을 물어볼 이유가 없다.
        "from_env": bool(config.get("from_env")),
        # 알림 "열기" 링크의 기준 주소 — env 로 왔으면 화면에서 편집 불가로 표시.
        "base_url": config.get("base_url") or "",
        "base_url_from_env": bool(config.get("base_url_from_env")),
    }


@router.put("/telegram")
async def telegram_save(
    request: TelegramConfigRequest,
    username: str = Depends(verify_auth_token),
):
    """저장 전에 토큰을 검증한다 — 잘못된 토큰을 저장해두면 알림이 조용히 안 온다."""
    token = request.token.strip()
    chat_id = request.chat_id.strip()

    # 기준 주소는 토큰/chat 과 독립적으로 저장한다 — env 로 온 값은 env 가 이기므로
    # 덮어쓰지 않는다.
    current = await telegram_service.get_config()
    if not current.get("base_url_from_env"):
        await telegram_service.save_public_base_url(request.base_url)

    if not token and not chat_id:
        await telegram_service.save_config(None, None)
        return {"configured": False}

    if not token:
        # 토큰을 비운 채 chat 만 바꾸는 경우 — 기존 토큰을 유지한다.
        token = (await telegram_service.get_config())["token"] or ""
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="봇 토큰과 chat ID 가 모두 필요합니다")

    try:
        me = await telegram_client.get_me(token)
    except telegram_client.TelegramError as e:
        raise HTTPException(status_code=400, detail=f"봇 토큰 확인 실패: {e}")

    await telegram_service.save_config(token, chat_id)
    return {"configured": True, "bot": me.get("username") or ""}


@router.post("/telegram/test")
async def telegram_test(username: str = Depends(verify_auth_token)):
    """설정 화면의 '테스트 전송' — 버튼까지 실제로 보내본다."""
    config = await telegram_service.get_config()
    if not (config["token"] and config["chat_id"]):
        raise HTTPException(status_code=400, detail="먼저 봇 토큰과 chat ID 를 저장하세요")
    try:
        await telegram_client.send_message(
            config["token"], config["chat_id"],
            "🐳 Terminal List 연결 확인 — 알림이 이 방으로 옵니다.",
        )
    except telegram_client.TelegramError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "sent"}


@router.post("/telegram/discover")
async def telegram_discover(username: str = Depends(verify_auth_token)):
    """봇에게 말을 건 대화방을 찾아 chat ID 를 알려준다.

    사용법: 텔레그램에서 봇에게 아무 메시지나 한 번 보낸 뒤 이걸 부른다.
    토큰이 env 로 들어온 경우에도 동작한다.
    """
    config = await telegram_service.get_config()
    if not config["token"]:
        raise HTTPException(status_code=400, detail="먼저 봇 토큰을 설정하세요")
    try:
        chats = await telegram_client.discover_chats(config["token"])
    except telegram_client.TelegramError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"chats": chats}
