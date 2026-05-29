"""
Authentication Manager
Handles password hashing, JWT token generation, and user authentication
SQLite 기반 저장
"""
import asyncio
import base64
import hashlib
import hmac
import logging
import os
import secrets
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import pyotp
from jose import JWTError, jwt

from vault import decrypt_str, encrypt_str, enforce_secret_file_permissions

logger = logging.getLogger(__name__)

# JWT 비밀키 파일 경로 — vault key 와 동일 디렉토리. 환경변수로 override 가능.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_JWT_KEY_PATH = _PROJECT_ROOT / "data" / ".jwt-secret"


def _jwt_key_path() -> Path:
    return Path(os.getenv("JWT_SECRET_PATH") or _DEFAULT_JWT_KEY_PATH)


def _read_jwt_key_file() -> str | None:
    path = _jwt_key_path()
    if not path.exists():
        return None
    enforce_secret_file_permissions(path)
    try:
        raw = path.read_text(encoding="utf-8").strip()
        return raw or None
    except OSError:
        return None


def _write_jwt_key_file(key: str) -> None:
    path = _jwt_key_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # 0600 — 같은 호스트의 다른 사용자에게 노출 방지.
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, key.encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(str(path), 0o600)
    except OSError:
        pass

# JWT settings
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
OTP_PENDING_TOKEN_EXPIRE_MINUTES = 5

# TOTP settings
TOTP_ISSUER = "Terminal List"
TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_VALID_WINDOW = 1  # 앞뒤 1 step (±30s) 허용 — 시계 오차 보정

# Backup code settings
BACKUP_CODE_COUNT = 10
BACKUP_CODE_BYTES = 5  # ≈ 8 base32 chars
PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 390_000
PBKDF2_PREFIX = "pbkdf2_sha256"


def _hash_secret(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(PBKDF2_ALGORITHM, value.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "$".join(
        [
            PBKDF2_PREFIX,
            str(PBKDF2_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
            base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="),
        ]
    )


# 타이밍 사이드채널 방지용 더미 해시 — admin 부재/username 불일치 시에도 동일한
# PBKDF2 비용을 치르게 해서 응답 시간으로 username 을 추론할 수 없게 한다.
_DUMMY_PASSWORD_HASH = _hash_secret(secrets.token_urlsafe(32))


def _verify_secret(value: str, hashed_value: str) -> bool:
    if hashed_value.startswith(f"{PBKDF2_PREFIX}$"):
        try:
            _, iterations, salt_b64, digest_b64 = hashed_value.split("$", 3)
            salt = base64.urlsafe_b64decode(salt_b64 + "=" * (-len(salt_b64) % 4))
            expected = base64.urlsafe_b64decode(digest_b64 + "=" * (-len(digest_b64) % 4))
            actual = hashlib.pbkdf2_hmac(PBKDF2_ALGORITHM, value.encode("utf-8"), salt, int(iterations))
            return hmac.compare_digest(actual, expected)
        except (TypeError, ValueError):
            return False
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="'crypt' is deprecated.*", category=DeprecationWarning)
            from passlib.context import CryptContext

        return CryptContext(schemes=["bcrypt"], deprecated="auto").verify(value, hashed_value)
    except Exception:
        return False


class AuthManager:
    """Manages authentication operations"""

    def __init__(self, storage):
        self.storage = storage
        self.secret_key = None
        # SECRET_KEY를 동기적으로 초기화 (비동기 컨텍스트에서 호출됨)
        asyncio.create_task(self._init_secret_key())

    async def _init_secret_key(self):
        """JWT SECRET_KEY 초기화.

        우선순위:
          1) data/.jwt-secret 파일 — 권장 위치 (0600). DB 백업 유출 시에도 토큰 위조 차단.
          2) SQLite system_config 'jwt_secret_key' — 레거시. 발견 시 파일로 마이그레이션 후 DB에서 제거.
          3) 모두 없으면 새로 생성하여 파일에 저장.
        """
        file_key = _read_jwt_key_file()
        if file_key:
            self.secret_key = file_key
            return

        legacy_key = await self.storage.get_config("jwt_secret_key")
        if legacy_key:
            try:
                _write_jwt_key_file(legacy_key)
                # 마이그레이션 성공 — DB 에서 평문 키 제거. 실패해도 동작에는 영향 없음.
                try:
                    await self.storage.delete_config("jwt_secret_key")
                except Exception as e:
                    logger.warning("legacy jwt key DB delete failed: %s", e)
                logger.info("JWT secret migrated from DB to file: %s", _jwt_key_path())
            except OSError as e:
                # 파일 쓰기 실패 — DB 키 그대로 사용 (서비스 죽지 않게).
                logger.error("JWT secret file write failed, keeping DB-backed key: %s", e)
            self.secret_key = legacy_key
            return

        new_key = secrets.token_urlsafe(32)
        try:
            _write_jwt_key_file(new_key)
            logger.info("JWT secret created at %s", _jwt_key_path())
        except OSError as e:
            # 파일 시스템 안 되면 DB 로 폴백 (예: ro 파일시스템). 보안 약하지만 동작은 유지.
            logger.error("JWT secret file write failed, falling back to DB: %s", e)
            await self.storage.set_config("jwt_secret_key", new_key)
        self.secret_key = new_key

    async def ensure_secret_key(self):
        """SECRET_KEY가 초기화될 때까지 대기"""
        while self.secret_key is None:
            await asyncio.sleep(0.01)
        return self.secret_key

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt"""
        return _hash_secret(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return _verify_secret(plain_password, hashed_password)

    async def is_setup_complete(self) -> bool:
        """Check if initial admin setup is complete"""
        return await self.storage.admin_exists()

    async def create_admin(self, username: str, password: str) -> bool:
        """Create admin user (only if not already exists)"""
        if await self.is_setup_complete():
            return False

        hashed_password = self.hash_password(password)
        return await self.storage.create_admin(username, hashed_password)

    async def verify_admin(self, username: str, password: str) -> bool:
        """Verify admin credentials.

        상수 시간 비교 — username 불일치나 admin 부재 시에도 항상 PBKDF2 해시를
        계산해서 응답 시간으로 valid username 을 추론하지 못하게 한다.
        """
        admin_data = await self.storage.get_admin()
        stored_username = admin_data["username"] if admin_data else ""
        stored_hash = admin_data["password"] if admin_data else _DUMMY_PASSWORD_HASH

        # 항상 해시 검증을 수행 (불일치여도 동일 비용).
        password_ok = self.verify_password(password, stored_hash)
        username_ok = hmac.compare_digest(stored_username, username)
        return bool(admin_data) and username_ok and password_ok

    async def change_password(
        self, username: str, current_password: str, new_password: str
    ) -> bool:
        """현재 비밀번호 확인 후 새 비밀번호로 교체. 실패 시 False."""
        if not await self.verify_admin(username, current_password):
            return False
        hashed = self.hash_password(new_password)
        return await self.storage.update_admin_password(username, hashed)

    async def create_access_token(self, username: str) -> str:
        """Create JWT access token"""
        secret_key = await self.ensure_secret_key()
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
        to_encode = {
            "sub": username,
            "exp": expire,
            "iat": datetime.utcnow(),
        }
        encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)
        return encoded_jwt

    async def verify_token(self, token: str) -> str | None:
        """Verify JWT token and return username (단, otp_pending 토큰은 거부)."""
        try:
            secret_key = await self.ensure_secret_key()
            payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
            if payload.get("otp_pending"):
                # 2FA 가 끝나지 않은 토큰으로는 일반 API 접근 불가
                return None
            username: str = payload.get("sub")
            if username is None:
                return None
            return username
        except JWTError:
            return None

    # ------------------------------ OTP ------------------------------

    async def is_otp_enabled(self) -> bool:
        admin = await self.storage.get_admin()
        return bool(admin and admin.get("otp_enabled"))

    async def get_otp_status(self) -> dict:
        admin = await self.storage.get_admin()
        if not admin:
            return {"enabled": False, "configured": False}
        configured = bool(admin.get("otp_secret_enc"))
        username = admin.get("username") or ""
        backup_codes_remaining = (
            await self.storage.count_unused_backup_codes(username) if configured else 0
        )
        return {
            "enabled": bool(admin.get("otp_enabled")),
            "configured": configured,
            "enabled_at": admin.get("otp_enabled_at"),
            "backup_codes_remaining": backup_codes_remaining,
        }

    async def begin_otp_setup(self, username: str) -> dict:
        """새 비밀키 생성 후 (DB 저장하지만 enabled=0). provisioning URI 반환."""
        secret = pyotp.random_base32()
        secret_enc = encrypt_str(secret)
        await self.storage.set_admin_otp(username, secret_enc, enabled=False)
        # 등록 시점 기준 백업코드는 enable 단계에서 발급
        provisioning_uri = pyotp.TOTP(
            secret, digits=TOTP_DIGITS, interval=TOTP_PERIOD
        ).provisioning_uri(name=username, issuer_name=TOTP_ISSUER)
        return {
            "secret": secret,  # 수동 입력용 — 한 번만 노출
            "provisioning_uri": provisioning_uri,
            "issuer": TOTP_ISSUER,
            "username": username,
            "digits": TOTP_DIGITS,
            "period": TOTP_PERIOD,
        }

    async def _load_otp_secret(self, username: str) -> str | None:
        admin = await self.storage.get_admin()
        if not admin or admin.get("username") != username:
            return None
        return decrypt_str(admin.get("otp_secret_enc"))

    def _verify_totp(self, secret: str, code: str) -> bool:
        if not code or not code.strip().isdigit() or len(code.strip()) != TOTP_DIGITS:
            return False
        totp = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_PERIOD)
        return totp.verify(code.strip(), valid_window=TOTP_VALID_WINDOW)

    async def verify_otp_code(self, username: str, code: str) -> bool:
        """TOTP 6자리 코드 검증."""
        secret = await self._load_otp_secret(username)
        if not secret:
            return False
        return self._verify_totp(secret, code)

    async def consume_backup_code(self, username: str, code: str) -> bool:
        """백업코드 매칭되면 사용 처리하고 True. 일회용."""
        normalized = (code or "").replace("-", "").replace(" ", "").upper().strip()
        if not normalized:
            return False
        codes = await self.storage.list_unused_backup_codes(username)
        for entry in codes:
            if _verify_secret(normalized, entry["code_hash"]):
                return await self.storage.consume_backup_code(entry["id"])
        return False

    @staticmethod
    def _generate_backup_code() -> str:
        """8자리 영숫자 코드 (Base32, 헷갈리는 0/1 없음)."""
        raw = secrets.token_bytes(BACKUP_CODE_BYTES)
        import base64
        return base64.b32encode(raw).decode("ascii").rstrip("=")[:8]

    async def issue_backup_codes(self, username: str) -> list[str]:
        """평문 코드 리스트 반환 (한 번만 사용자에게 노출). 해시는 DB 에 저장."""
        plain_codes = [self._generate_backup_code() for _ in range(BACKUP_CODE_COUNT)]
        hashes = [_hash_secret(c) for c in plain_codes]
        await self.storage.replace_backup_codes(username, hashes)
        return plain_codes

    async def enable_otp(self, username: str, code: str) -> list[str] | None:
        """begin_otp_setup 으로 받은 비밀키로 첫 코드 검증 후 활성화. 백업코드 반환."""
        secret = await self._load_otp_secret(username)
        if not secret:
            return None
        if not self._verify_totp(secret, code):
            return None
        secret_enc = encrypt_str(secret)
        await self.storage.set_admin_otp(username, secret_enc, enabled=True)
        return await self.issue_backup_codes(username)

    async def disable_otp(self, username: str) -> None:
        """OTP 비활성화 + 비밀키 삭제 + 백업코드 모두 삭제."""
        await self.storage.set_admin_otp(username, secret_enc=None, enabled=False)
        await self.storage.clear_backup_codes(username)

    async def create_otp_pending_token(self, username: str) -> str:
        """1차 (비밀번호) 통과 후 2차 (OTP) 대기용 단명 토큰."""
        secret_key = await self.ensure_secret_key()
        expire = datetime.utcnow() + timedelta(minutes=OTP_PENDING_TOKEN_EXPIRE_MINUTES)
        to_encode = {
            "sub": username,
            "exp": expire,
            "iat": datetime.utcnow(),
            "otp_pending": True,
        }
        return jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)

    async def verify_otp_pending_token(self, token: str) -> str | None:
        """otp_pending 토큰만 받아 username 반환."""
        try:
            secret_key = await self.ensure_secret_key()
            payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
            if not payload.get("otp_pending"):
                return None
            return payload.get("sub")
        except JWTError:
            return None

    # ----------------------- 패스키 (WebAuthn) -----------------------
    # Challenge 는 짧은 수명(5분) in-memory dict. Redis 폴백 안 함 — 잠깐 사이의 가벼운 상태.
    # 같은 서버 인스턴스에서 begin → complete 가 일어난다고 가정 (single-instance 배포).

    _PASSKEY_CHALLENGE_TTL_SECONDS = 300
    # 인스턴스별 임시 challenge 저장소: { (kind, key): (challenge_bytes, expires_at) }
    # kind: 'register' | 'authenticate'. key: register=username, authenticate=session_id.
    _passkey_challenges: dict = {}

    @classmethod
    def _purge_passkey_challenges(cls) -> None:
        now = datetime.utcnow().timestamp()
        expired = [k for k, (_, exp) in cls._passkey_challenges.items() if exp <= now]
        for k in expired:
            cls._passkey_challenges.pop(k, None)

    @classmethod
    def _store_passkey_challenge(cls, kind: str, key: str, challenge: bytes) -> None:
        cls._purge_passkey_challenges()
        exp = datetime.utcnow().timestamp() + cls._PASSKEY_CHALLENGE_TTL_SECONDS
        cls._passkey_challenges[(kind, key)] = (challenge, exp)

    @classmethod
    def _consume_passkey_challenge(cls, kind: str, key: str) -> bytes | None:
        cls._purge_passkey_challenges()
        item = cls._passkey_challenges.pop((kind, key), None)
        return item[0] if item else None
