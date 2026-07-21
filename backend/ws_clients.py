"""WebSocket 클라이언트 신원 레지스트리.

tmux 의 client count 만 보면 같은 폰이 와이파이↔LTE 전환 중 남긴 낡은 attach 도
"다른 기기"로 보인다. 브라우저가 보내는 안정 client_id 로 같은 기기의 stale 연결과
진짜 다른 기기를 갈라낸다. 프로세스 로컬이라 백엔드 단일 프로세스를 전제한다.

세션·호스트·WS 라우트가 모두 참조하므로 독립 모듈로 둔다.
"""
from __future__ import annotations

import logging
import re
import secrets as secrets_mod
import time

from fastapi import Request, WebSocket

from rate_limit import client_ip_from_request, trust_proxy_headers

logger = logging.getLogger(__name__)


# WebSocket client identity registry.
# tmux 의 client count 만 보면 같은 폰이 와이파이/LTE 전환 중 만든 오래된 attach 도
# "다른 기기"처럼 보인다. 브라우저가 보낸 안정 client_id 로 같은 기기 stale 연결과
# 진짜 다른 기기를 분리한다. 프로세스 로컬 registry 이므로 백엔드 단일 프로세스 기준이다.
_ws_client_registry: dict[tuple[str, str], dict[str, dict]] = {}


def _clean_client_id(client_id: str | None) -> str | None:
    if not client_id:
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9._:-]", "", client_id.strip())[:96]
    return cleaned or None


def _client_ip_from_websocket(websocket: WebSocket) -> str:
    xff = websocket.headers.get("x-forwarded-for", "").split(",")[0].strip() if trust_proxy_headers() else ""
    if xff:
        return xff
    try:
        return websocket.client.host if websocket.client else "unknown"
    except Exception:
        return "unknown"


def _register_ws_client(kind: str, session_key: str, client_id: str | None, websocket: WebSocket) -> str | None:
    clean_id = _clean_client_id(client_id)
    if not clean_id:
        return None
    token = secrets_mod.token_urlsafe(12)
    key = (kind, session_key)
    bucket = _ws_client_registry.setdefault(key, {})
    bucket[token] = {
        "client_id": clean_id,
        "ip": _client_ip_from_websocket(websocket),
        "ua": websocket.headers.get("user-agent", "")[:160],
        "connected_at": time.time(),
    }
    return token


def _unregister_ws_client(kind: str, session_key: str, token: str | None) -> None:
    if not token:
        return
    key = (kind, session_key)
    bucket = _ws_client_registry.get(key)
    if not bucket:
        return
    bucket.pop(token, None)
    if not bucket:
        _ws_client_registry.pop(key, None)


def _client_identity_payload(kind: str, session_key: str, client_id: str | None, request: Request) -> dict:
    clean_id = _clean_client_id(client_id)
    entries = list(_ws_client_registry.get((kind, session_key), {}).values())
    if not clean_id:
        return {
            "same_client_count": 0,
            "other_client_count": len(entries),
            "same_client_active": False,
            "other_client_active": bool(entries),
            "network_changed": False,
        }
    same = [e for e in entries if e.get("client_id") == clean_id]
    other = [e for e in entries if e.get("client_id") != clean_id]
    current_ip = client_ip_from_request(request)
    same_ips = sorted({e.get("ip") or "unknown" for e in same})
    return {
        "same_client_count": len(same),
        "other_client_count": len(other),
        "same_client_active": bool(same),
        "other_client_active": bool(other),
        "network_changed": bool(same and current_ip not in same_ips),
        "client_ip": current_ip,
        "same_client_ips": same_ips,
    }

