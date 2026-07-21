"""단명 티켓 3종 — WebSocket / 원본파일 / SSE.

셋 다 같은 문제를 푼다: 커스텀 헤더를 못 보내는 클라이언트(EventSource, <img src>,
WebSocket 핸드셰이크)를 인증하는 일회용 토큰. TTL·단일사용·경로 바인딩 규칙이
서로 어긋나면 곧바로 인증 구멍이 되므로 한 파일에 모아 나란히 둔다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets as secrets_mod
import time

from fastapi import HTTPException

from _deps import validate_path

logger = logging.getLogger(__name__)


# ---------------------- WebSocket ticket ----------------------

# 30s — 재연결용 사전 발급 티켓이 끊김~재접속 사이 유효하도록 약간 길게(단일 사용).
WS_TICKET_TTL_SECONDS = 30
# 연결된 WS 위로 다음 재연결용 티켓을 미리 밀어주는 주기. 클라가 stash 해 두면 재연결 때
# HTTP fetch 없이 바로 WebSocket 을 연다(= Jupyter 처럼 fresh TCP, wedge 된 연결 풀 우회).
WS_TICKET_PUSH_INTERVAL_SECONDS = 10
_ws_tickets: dict[str, dict] = {}
FILE_TICKET_TTL_SECONDS = 30
_file_tickets: dict[str, dict] = {}


def _cleanup_ws_tickets(now: float | None = None) -> None:
    now = now or time.time()
    expired = [ticket for ticket, meta in _ws_tickets.items() if meta.get("expires_at", 0) <= now]
    for ticket in expired:
        _ws_tickets.pop(ticket, None)


def _normalize_ws_path(path: str) -> str:
    path = (path or "").split("?", 1)[0].strip()
    if not path.startswith("/ws/"):
        raise HTTPException(status_code=400, detail="유효하지 않은 WebSocket 경로입니다")
    return path


def _create_ws_ticket(username: str, path: str) -> tuple[str, float]:
    now = time.time()
    _cleanup_ws_tickets(now)
    ticket = secrets_mod.token_urlsafe(32)
    expires_at = now + WS_TICKET_TTL_SECONDS
    _ws_tickets[ticket] = {"username": username, "path": _normalize_ws_path(path), "expires_at": expires_at}
    return ticket, expires_at


def _consume_ws_ticket(ticket: str | None, path: str) -> str | None:
    if not ticket:
        return None
    now = time.time()
    _cleanup_ws_tickets(now)
    meta = _ws_tickets.pop(ticket, None)
    if not meta or meta.get("expires_at", 0) <= now:
        return None
    if meta.get("path") != _normalize_ws_path(path):
        return None
    return meta.get("username")


async def _push_ws_tickets(bridge, username: str, ws_path: str) -> None:
    """연결된 WS 위로 다음 재연결용 단일사용 티켓을 주기적으로 밀어준다.

    클라가 이걸 stash 해 두면, 재연결 시 /api/ws-ticket fetch(공유 HTTP/2 연결을 재사용 —
    모바일 네트워크 전환 시 wedge 되는 주범) 없이 곧바로 새 WebSocket 을 연다. 새 WebSocket 은
    항상 fresh TCP 라 wedge 된 연결 풀을 우회한다(= JupyterLab 의 직접 연결과 동일한 회복력).
    """
    import json as _json
    try:
        while True:
            tk, exp = _create_ws_ticket(username, ws_path)
            await bridge.send_control(_json.dumps({"type": "ws_ticket", "ticket": tk, "expires_at": exp}))
            await asyncio.sleep(WS_TICKET_PUSH_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        # 티켓 payload(JSON) 를 보내다 실패한 예외라 str(e) 에 값이 실릴 수 있음 —
        # 로그에는 타입명만 남기고 티켓 자체는 절대 남기지 않는다.
        logger.debug("ws ticket push stopped (%s): %s", ws_path, type(e).__name__)


def _cleanup_file_tickets(now: float | None = None) -> None:
    now = now or time.time()
    expired = [ticket for ticket, meta in _file_tickets.items() if meta.get("expires_at", 0) <= now]
    for ticket in expired:
        _file_tickets.pop(ticket, None)


def _create_file_ticket(username: str, path: str) -> tuple[str, float]:
    now = time.time()
    _cleanup_file_tickets(now)
    safe = validate_path(path)
    ticket = secrets_mod.token_urlsafe(32)
    expires_at = now + FILE_TICKET_TTL_SECONDS
    _file_tickets[ticket] = {"username": username, "path": str(safe), "expires_at": expires_at}
    return ticket, expires_at


def _consume_file_ticket(ticket: str | None) -> str | None:
    if not ticket:
        return None
    now = time.time()
    _cleanup_file_tickets(now)
    meta = _file_tickets.pop(ticket, None)
    if not meta or meta.get("expires_at", 0) <= now:
        return None
    return meta.get("path")


# ---------------------- SSE ticket (tab-state EventSource 인증) ----------------------
# EventSource 는 커스텀 헤더 불가 → 일회용 티켓으로 초기 인증 후 스트림 유지.

SSE_TICKET_TTL_SECONDS = 30
_sse_tickets: dict[str, dict] = {}


def _create_sse_ticket(username: str) -> str:
    now = time.time()
    expired = [t for t, m in list(_sse_tickets.items()) if m["expires_at"] <= now]
    for t in expired:
        _sse_tickets.pop(t, None)
    ticket = secrets_mod.token_urlsafe(32)
    _sse_tickets[ticket] = {"username": username, "expires_at": now + SSE_TICKET_TTL_SECONDS}
    return ticket


def _consume_sse_ticket(ticket: str | None) -> str | None:
    if not ticket:
        return None
    meta = _sse_tickets.pop(ticket, None)
    if not meta or meta["expires_at"] <= time.time():
        return None
    return meta["username"]

