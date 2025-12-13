"""
Authentication Manager
Handles password hashing, JWT token generation, and user authentication
SQLite 기반 저장
"""
from datetime import datetime, timedelta
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
import secrets
import asyncio

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


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

    async def verify_token(self, token: str) -> Optional[str]:
        """Verify JWT token and return username"""
        try:
            secret_key = await self.ensure_secret_key()
            payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
            username: str = payload.get("sub")
            if username is None:
                return None
            return username
        except JWTError:
            return None
