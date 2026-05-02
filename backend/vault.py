"""
민감 데이터 (SSH private key, 저장된 비밀번호) 암호화 레이어.

⚠️  v1 정책: 서버측 마스터 키 (JWT_SECRET_KEY 파생) 로 AES-Fernet 암호화.
    백엔드 침해 시 노출되므로 v2 에서 사용자 비밀번호 파생 키로 이전 예정.
    그때까지 호스트 저장된 SSH 키는 \"이 서버 신뢰 = 키 신뢰\" 모델.
"""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


def _master_key() -> bytes:
    """JWT_SECRET_KEY 에서 32바이트 키를 결정적으로 파생 → Fernet base64 url-safe 키."""
    secret = os.getenv("JWT_SECRET_KEY") or "change-this-to-a-strong-secret"
    digest = hashlib.sha256(b"iterminallist-vault-v1::" + secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_master_key())
    return _fernet


def encrypt_str(plaintext: Optional[str]) -> Optional[str]:
    """평문 → urlsafe base64 인코딩된 암호문. None → None."""
    if plaintext is None or plaintext == "":
        return None
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt_str(ciphertext: Optional[str]) -> Optional[str]:
    """암호문 → 평문. 손상되거나 다른 키로 만든 데이터면 None."""
    if not ciphertext:
        return None
    try:
        return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None
