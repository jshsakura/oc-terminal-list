"""WebSocket 인증 — 티켓 우선, 실패 시 same-origin 쿠키 폴백.

**왜 쿠키 폴백인가 (근본 수정):**
재연결은 원래 `/api/ws-ticket` HTTP fetch 로 티켓을 받아야 WebSocket 을 열 수 있었다.
그 fetch 는 브라우저의 **공유 HTTP/2 연결**(모바일 네트워크 전환·Cloudflare 단일 터널에서
wedge 되는 주범)을 재사용한다. 연결 풀이 wedge 되면 티켓을 못 받아 재연결이 통째로 막히고,
**새로고침(=새 연결 풀) 전엔 회복이 안 됐다** — 여러 pane 이 동시에 "다시 연결 중" 에서
영영 멈추는 증상의 근원.

WebSocket 핸드셰이크는 항상 **fresh TCP** 라 wedge 된 풀을 우회하고, same-origin 인증
쿠키(`iterm_auth`)는 핸드셰이크에 자동으로 실린다. 따라서 티켓이 없어도 쿠키로 인증하면
재연결이 HTTP fetch 에 의존하지 않는다 — 티켓은 최적화(첫 연결·프리푸시)로 남고, 인증의
하드 디펜던시에서 빠진다.

**CSWSH(교차 사이트 WebSocket 하이재킹) 방어:**
쿠키가 `SameSite=Strict` 라 교차 사이트 핸드셰이크엔 애초에 실리지 않는다(브라우저가 강제).
그 위에 Origin 을 한 번 더 검사한다(방어 심화) — Origin 헤더가 없거나(비브라우저) 허용
목록 밖이면 쿠키 폴백을 거부한다. 티켓 경로는 이 검사와 무관하다(티켓 자체가 단일사용 보증).
"""
from __future__ import annotations

import logging
import os
from urllib.parse import urlsplit

from fastapi import WebSocket

from _deps import AUTH_COOKIE_NAME, get_auth_manager
from tickets import _consume_ws_ticket

logger = logging.getLogger(__name__)


def _allowed_origins() -> list[str]:
    """ALLOWED_ORIGINS env 를 정규화한 목록. 와일드카드/미설정이면 빈 목록."""
    out: list[str] = []
    for part in (os.getenv("ALLOWED_ORIGINS", "") or "").split(","):
        s = part.strip().rstrip("/")
        if not s or s == "*" or "://" not in s:
            continue
        scheme, rest = s.split("://", 1)
        host = rest.split("/", 1)[0]
        if host:
            out.append(f"{scheme}://{host}")
    return out


def _origin_ok(websocket: WebSocket) -> bool:
    """쿠키 폴백을 허용할 Origin 인가. 티켓 인증엔 적용되지 않는다."""
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    if not origin:
        # Origin 헤더가 없는 클라이언트(비브라우저) — 쿠키 폴백은 브라우저 재연결 전용.
        return False
    allowed = _allowed_origins()
    if allowed:
        return origin in allowed
    # ALLOWED_ORIGINS 미설정(와일드카드) — same-origin(Origin netloc == Host) 으로 판정.
    host = websocket.headers.get("host") or ""
    try:
        return bool(host) and urlsplit(origin).netloc == host
    except Exception:
        return False


async def authenticate_ws(websocket: WebSocket, ws_path: str, ticket: str | None) -> str | None:
    """WS 인증 → username, 실패 시 None.

    1) 티켓이 유효하면 소비하고 그 username.
    2) 아니면 Origin 검사를 통과한 경우에 한해 same-origin 쿠키(iterm_auth)로 인증.
    """
    username = _consume_ws_ticket(ticket, ws_path) if ticket else None
    if username:
        return username

    if not _origin_ok(websocket):
        return None
    token = websocket.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return None
    mgr = get_auth_manager()
    if not mgr:
        return None
    try:
        # verify_token 은 scoped(ITL 등)·otp_pending 토큰을 거부한다 — 일반 쿠키 인증과
        # 동일 신뢰수준. 티켓이 새는 것보다 나쁘지 않다.
        return await mgr.verify_token(token)
    except Exception as e:
        logger.debug("WS 쿠키 폴백 인증 실패 (%s): %s", ws_path, type(e).__name__)
        return None
