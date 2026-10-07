"""Preserve existing HS256 sessions when replacing python-jose with PyJWT."""
import base64
import hashlib
import hmac
import json
import time

import pytest

from auth_manager import JWTError, jwt

KEY = "test-only-jwt-secret-with-at-least-32-bytes"


def legacy_token(claims):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
    signing = encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode(claims)
    signature = base64.urlsafe_b64encode(hmac.new(KEY.encode(), signing, hashlib.sha256).digest()).rstrip(b"=")
    return (signing + b"." + signature).decode()


@pytest.mark.parametrize("extra", [{}, {"otp_pending": True}, {"scope": "test"}])
def test_existing_hs256_claims_are_preserved(extra):
    claims = {"sub": "test-user", "exp": int(time.time()) + 600, **extra}
    assert jwt.decode(legacy_token(claims), KEY, algorithms=["HS256"]) == claims


def test_expired_and_wrong_key_tokens_remain_rejected():
    with pytest.raises(JWTError):
        jwt.decode(legacy_token({"sub": "test-user", "exp": 1}), KEY, algorithms=["HS256"])
    with pytest.raises(JWTError):
        jwt.decode(legacy_token({"sub": "test-user", "exp": int(time.time()) + 600}),
                   "different-test-key-with-at-least-32-bytes", algorithms=["HS256"])
