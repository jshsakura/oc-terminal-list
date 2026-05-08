"""
민감 데이터 (SSH private key, 저장된 비밀번호, OTP 비밀키) 암호화 레이어.

마스터 키는 `data/.vault-key` 파일에서 읽는다 — 없으면 새로 생성.
JWT_SECRET_KEY 와 분리되어 있어서 JWT 회전 시에도 vault 데이터가 무효화되지 않는다.

레거시 호환:
    예전 (v1) 정책에서 JWT_SECRET_KEY 파생 키로 암호화된 데이터가 있을 수 있다.
    decrypt_str 은 vault key → 실패 시 JWT-derived 키 순으로 시도해 자동 복호화한다.
    완전한 마이그레이션은 backend/migrate_vault.py 로.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_VAULT_KEY_PATH = _PROJECT_ROOT / "data" / ".vault-key"


def _vault_key_path() -> Path:
    return Path(os.getenv("VAULT_KEY_PATH") or _DEFAULT_VAULT_KEY_PATH)


def _load_or_create_vault_key() -> bytes:
    """data/.vault-key 에서 읽기, 없으면 새로 만들어 저장. 반환은 Fernet base64 url-safe 키."""
    path = _vault_key_path()
    if path.exists():
        raw = path.read_bytes().strip()
        if raw:
            return raw
    # 없거나 빈 파일이면 새로 생성
    path.parent.mkdir(parents=True, exist_ok=True)
    new_key = Fernet.generate_key()
    # 0600 으로 저장 — 다른 사용자에게 노출 방지
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, new_key)
    finally:
        os.close(fd)
    try:
        os.chmod(str(path), 0o600)
    except OSError:
        pass
    return new_key


def _legacy_jwt_derived_key() -> bytes:
    """v1 정책 호환 — JWT_SECRET_KEY 파생 키. 신규 암호화에는 절대 쓰지 않는다."""
    secret = os.getenv("JWT_SECRET_KEY") or "change-this-to-a-strong-secret"
    digest = hashlib.sha256(b"iterminallist-vault-v1::" + secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet: Optional[Fernet] = None
_legacy_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_or_create_vault_key())
    return _fernet


def _get_legacy_fernet() -> Fernet:
    global _legacy_fernet
    if _legacy_fernet is None:
        _legacy_fernet = Fernet(_legacy_jwt_derived_key())
    return _legacy_fernet


def encrypt_str(plaintext: Optional[str]) -> Optional[str]:
    """평문 → urlsafe base64 인코딩된 암호문. None/빈문자열 → None."""
    if plaintext is None or plaintext == "":
        return None
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt_str(ciphertext: Optional[str]) -> Optional[str]:
    """암호문 → 평문. v2(vault key) → v1(JWT-derived) 순으로 시도."""
    if not ciphertext:
        return None
    token = ciphertext.encode("ascii")
    try:
        return _get_fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        pass
    # 레거시 fallback — 예전 JWT-derived 키로 만들어진 암호문 호환
    try:
        return _get_legacy_fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        return None


def reencrypt_legacy(ciphertext: Optional[str]) -> Optional[str]:
    """레거시 JWT-derived 키로만 풀리는 암호문이면 새 vault 키로 재암호화한 결과 반환.
    이미 새 키 형식이거나 손상된 경우 None.
    """
    if not ciphertext:
        return None
    token = ciphertext.encode("ascii")
    # 이미 새 키로 풀리면 마이그레이션 불필요
    try:
        _get_fernet().decrypt(token)
        return None
    except InvalidToken:
        pass
    try:
        plaintext = _get_legacy_fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        return None
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
