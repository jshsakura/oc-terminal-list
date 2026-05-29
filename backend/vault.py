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
import logging
import os
import stat
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_VAULT_KEY_PATH = _PROJECT_ROOT / "data" / ".vault-key"

# 키 파일에 허용되는 최대 권한 — 소유자 rw 만. group/other 비트가 있으면 위험.
_SECRET_FILE_MODE = 0o600


def enforce_secret_file_permissions(path: Path) -> None:
    """비밀 파일의 권한이 0600 보다 느슨하면 경고 후 0600 으로 조인다.

    배포 후 누군가 chmod 644 로 풀어둔 경우를 런타임에 감지/교정한다.
    Windows 등 chmod 가 의미 없는 플랫폼은 조용히 무시한다.
    """
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except OSError:
        return
    if mode & 0o077:  # group/other 비트가 하나라도 켜져 있으면
        logger.warning(
            "비밀 파일 권한이 느슨합니다 (%o) — %s, 0600 으로 조입니다.", mode, path
        )
        try:
            os.chmod(str(path), _SECRET_FILE_MODE)
        except OSError:
            logger.error("비밀 파일 권한 교정 실패: %s", path)


def _vault_key_path() -> Path:
    return Path(os.getenv("VAULT_KEY_PATH") or _DEFAULT_VAULT_KEY_PATH)


def _load_or_create_vault_key() -> bytes:
    """data/.vault-key 에서 읽기, 없으면 새로 만들어 저장. 반환은 Fernet base64 url-safe 키."""
    path = _vault_key_path()
    if path.exists():
        enforce_secret_file_permissions(path)
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


def _legacy_jwt_derived_key() -> bytes | None:
    """v1 정책 호환 — JWT_SECRET_KEY 파생 키. 신규 암호화에는 절대 쓰지 않는다.

    JWT_SECRET_KEY 가 명시적으로 설정된 경우에만 동작한다. 미설정 시 None 을
    반환해 레거시 복호화를 비활성화한다 — 알려진 약한 기본 키로 vault 데이터를
    푸는 일이 절대 없도록 한다.
    """
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        return None
    digest = hashlib.sha256(b"iterminallist-vault-v1::" + secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet: Fernet | None = None
_legacy_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_or_create_vault_key())
    return _fernet


def _get_legacy_fernet() -> Fernet | None:
    global _legacy_fernet
    if _legacy_fernet is None:
        key = _legacy_jwt_derived_key()
        if key is None:
            return None
        _legacy_fernet = Fernet(key)
    return _legacy_fernet


def encrypt_str(plaintext: str | None) -> str | None:
    """평문 → urlsafe base64 인코딩된 암호문. None/빈문자열 → None."""
    if plaintext is None or plaintext == "":
        return None
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt_str(ciphertext: str | None) -> str | None:
    """암호문 → 평문. v2(vault key) → v1(JWT-derived) 순으로 시도."""
    if not ciphertext:
        return None
    token = ciphertext.encode("ascii")
    try:
        return _get_fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        pass
    # 레거시 fallback — 예전 JWT-derived 키로 만들어진 암호문 호환.
    # JWT_SECRET_KEY 미설정 시 legacy fernet 은 None → 시도하지 않음.
    legacy = _get_legacy_fernet()
    if legacy is None:
        return None
    try:
        return legacy.decrypt(token).decode("utf-8")
    except InvalidToken:
        return None


# 모듈 임포트 시점에 Fernet 워밍업 — 첫 실제 요청에서 키 파일 IO 가 latency spike 내지
# 않게 한다. 호스트 목록 + 키 다발 복호화처럼 호출 빈도가 높은 경로에서 효과.
try:
    _get_fernet()
except Exception:
    # 키 파일이 없는 초기 부팅 경로면 첫 encrypt_str 호출 때 만들어진다.
    pass


def reencrypt_legacy(ciphertext: str | None) -> str | None:
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
    legacy = _get_legacy_fernet()
    if legacy is None:
        return None
    try:
        plaintext = legacy.decrypt(token).decode("utf-8")
    except InvalidToken:
        return None
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
