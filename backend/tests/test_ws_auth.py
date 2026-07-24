"""WS 인증 — 티켓 우선, same-origin 쿠키 폴백, CSWSH 방어.

근본 문제: 재연결이 wedge 되는 HTTP 티켓 fetch 에 순환 의존해서, 공유 HTTP/2 풀이
막히면 새로고침 전엔 회복이 안 됐다. 쿠키 폴백으로 티켓 없이도 부트스트랩되게 한다.
경계는 두 가지: (1) 쿠키가 통하는 건 허용 Origin 뿐 (2) scoped 토큰은 거부.
"""
from unittest.mock import AsyncMock, patch

import pytest

import ws_auth


class FakeWS:
    def __init__(self, headers=None, cookies=None):
        self.headers = headers or {}
        self.cookies = cookies or {}


@pytest.mark.anyio
async def test_valid_ticket_wins_without_touching_cookie():
    ws = FakeWS()
    with patch.object(ws_auth, "_consume_ws_ticket", return_value="alice"):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", "tk") == "alice"


@pytest.mark.anyio
async def test_cookie_fallback_when_ticket_missing_and_origin_allowed(monkeypatch):
    """티켓이 없어도(=wedge 로 발급 실패) 허용 Origin + 쿠키면 인증된다."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://term.example.com")
    ws = FakeWS(
        headers={"origin": "https://term.example.com", "host": "term.example.com"},
        cookies={"iterm_auth": "cookietok"},
    )
    mgr = AsyncMock()
    mgr.verify_token = AsyncMock(return_value="bob")
    with patch.object(ws_auth, "_consume_ws_ticket", return_value=None), \
         patch.object(ws_auth, "get_auth_manager", return_value=mgr):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", None) == "bob"
    mgr.verify_token.assert_awaited_once_with("cookietok")


@pytest.mark.anyio
async def test_cookie_rejected_when_origin_not_in_allowlist(monkeypatch):
    """다른 사이트가 쿠키를 실어 보내도(SameSite 우회 가정) Origin 검사가 막는다."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://term.example.com")
    ws = FakeWS(
        headers={"origin": "https://evil.com", "host": "term.example.com"},
        cookies={"iterm_auth": "cookietok"},
    )
    mgr = AsyncMock()
    mgr.verify_token = AsyncMock(return_value="bob")
    with patch.object(ws_auth, "_consume_ws_ticket", return_value=None), \
         patch.object(ws_auth, "get_auth_manager", return_value=mgr):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", None) is None
    mgr.verify_token.assert_not_awaited()


@pytest.mark.anyio
async def test_cookie_rejected_without_origin_header(monkeypatch):
    """Origin 헤더가 없는 비브라우저 클라이언트는 쿠키 폴백 불가."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://term.example.com")
    ws = FakeWS(headers={}, cookies={"iterm_auth": "cookietok"})
    with patch.object(ws_auth, "_consume_ws_ticket", return_value=None):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", None) is None


@pytest.mark.anyio
async def test_no_ticket_no_cookie_is_unauthenticated(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://term.example.com")
    ws = FakeWS(headers={"origin": "https://term.example.com"}, cookies={})
    with patch.object(ws_auth, "_consume_ws_ticket", return_value=None):
        assert await ws_auth.authenticate_ws(ws, "/ws/s1", None) is None


@pytest.mark.anyio
async def test_wildcard_origins_fall_back_to_same_origin_host_match(monkeypatch):
    """ALLOWED_ORIGINS 미설정이면 Origin netloc == Host 로 same-origin 확인."""
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    mgr = AsyncMock()
    mgr.verify_token = AsyncMock(return_value="carol")
    same = FakeWS(headers={"origin": "https://box.local", "host": "box.local"},
                  cookies={"iterm_auth": "tok"})
    cross = FakeWS(headers={"origin": "https://other.local", "host": "box.local"},
                   cookies={"iterm_auth": "tok"})
    with patch.object(ws_auth, "_consume_ws_ticket", return_value=None), \
         patch.object(ws_auth, "get_auth_manager", return_value=mgr):
        assert await ws_auth.authenticate_ws(same, "/ws/s1", None) == "carol"
        assert await ws_auth.authenticate_ws(cross, "/ws/s1", None) is None
