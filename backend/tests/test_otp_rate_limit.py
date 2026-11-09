"""OTP login rate limits must not let a stranger lock the real user out.

The per-token bucket was keyed by `pending_token[:32]`. Every pending token is a JWT
and they all start with the same base64 header (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`),
so the first 32 characters were identical for everyone: five bogus requests filled
the one shared bucket and the real user got 429 for five minutes. Requests with an
invalid pending token also counted against the per-IP bucket, which behind a tunnel
without TRUST_PROXY_HEADERS is shared by every client.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import rate_limit
from routes import auth as auth_routes

JWT_HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
VALID_TOKEN = f"{JWT_HEADER}.eyJzdWIiOiJhZG1pbiIsIm90cF9wZW5kaW5nIjp0cnVlfQ.real-signature"
GOOD_CODE = "123456"


class FakeAuthManager:
    async def verify_otp_pending_token(self, token: str) -> str | None:
        return "admin" if token == VALID_TOKEN else None

    async def verify_otp_code(self, username: str, code: str) -> bool:
        return code == GOOD_CODE

    async def consume_backup_code(self, username: str, code: str) -> bool:
        return False

    async def create_access_token(self, username: str) -> str:
        return "access-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(rate_limit, "_buckets", {})
    monkeypatch.setattr(auth_routes, "get_auth_manager", lambda: FakeAuthManager())
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    app = FastAPI()
    app.include_router(auth_routes.router)
    with TestClient(app) as test_client:
        yield test_client


def _otp(client, token: str, code: str):
    return client.post("/api/auth/login/otp", json={"pending_token": token, "code": code})


def test_bogus_tokens_do_not_lock_out_the_real_user(client):
    for i in range(10):
        bogus = f"{JWT_HEADER}.forged-payload-{i}.forged-signature"
        assert _otp(client, bogus, "000000").status_code == 401

    res = _otp(client, VALID_TOKEN, GOOD_CODE)

    assert res.status_code == 200
    assert res.json()["access_token"] == "access-token"


def test_wrong_codes_on_a_valid_token_are_still_limited(client):
    statuses = [_otp(client, VALID_TOKEN, f"{i:06d}").status_code for i in range(6)]

    assert statuses[:5] == [401] * 5
    assert statuses[5] == 429
    # Brute-force protection must hold even when the right code finally arrives.
    assert _otp(client, VALID_TOKEN, GOOD_CODE).status_code == 429
