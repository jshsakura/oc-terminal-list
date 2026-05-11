"""
Authentication Manager
Handles password hashing, JWT token generation, and user authentication
SQLite 기반 저장
"""
import asyncio
import secrets
from datetime import datetime, timedelta

import pyotp
from jose import JWTError, jwt
from passlib.context import CryptContext

from vault import decrypt_str, encrypt_str

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
OTP_PENDING_TOKEN_EXPIRE_MINUTES = 5

# TOTP settings
TOTP_ISSUER = "iTerminaLlist"
TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_VALID_WINDOW = 1  # 앞뒤 1 step (±30s) 허용 — 시계 오차 보정

# Backup code settings
BACKUP_CODE_COUNT = 10
BACKUP_CODE_BYTES = 5  # ≈ 8 base32 chars


class AuthManager:
    """Manages authentication operations"""

    def __init__(self, storage):
        self.storage = storage
        self.secret_key = None
        # SECRET_KEY를 동기적으로 초기화 (비동기 컨텍스트에서 호출됨)
        asyncio.create_task(self._init_secret_key())

    async def _init_secret_key(self):
        """JWT SECRET_KEY 초기화 (SQLite에서 가져오거나 생성)"""
        # SQLite에서 SECRET_KEY 가져오기
        stored_key = await self.storage.get_config("jwt_secret_key")

        if stored_key:
            # 기존 키 사용
            self.secret_key = stored_key
        else:
            # 새로운 키 생성 및 저장
            new_key = secrets.token_urlsafe(32)
            await self.storage.set_config("jwt_secret_key", new_key)
            self.secret_key = new_key

    async def ensure_secret_key(self):
        """SECRET_KEY가 초기화될 때까지 대기"""
        while self.secret_key is None:
            await asyncio.sleep(0.01)
        return self.secret_key

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt"""
        return pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return pwd_context.verify(plain_password, hashed_password)

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
        """Verify admin credentials"""
        admin_data = await self.storage.get_admin()
        if not admin_data:
            return False

        if admin_data["username"] != username:
            return False

        return self.verify_password(password, admin_data["password"])

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
            if pwd_context.verify(normalized, entry["code_hash"]):
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
        hashes = [pwd_context.hash(c) for c in plain_codes]
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
