"""JWT issuance and persistent browser-session validation."""
from __future__ import annotations

import secrets
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anyio
from fastapi import HTTPException
import jwt
from jwt import PyJWTError as JWTError

if TYPE_CHECKING:
    from sqlite_storage import SQLiteStorage


class AuthTokenMixin(ABC):
    """Shared token behavior; AuthManager owns the signing-key lifecycle."""

    storage: SQLiteStorage
    _auth_session_lock: anyio.Lock
    token_expire_hours: int
    token_algorithm: str

    @abstractmethod
    async def ensure_secret_key(self) -> str:
        """Return the initialized JWT signing key."""

    async def create_access_token(self, username: str) -> str:
        """Create JWT access token"""
        secret_key = await self.ensure_secret_key()
        expire = datetime.now(UTC) + timedelta(hours=self.token_expire_hours)
        session_id = secrets.token_urlsafe(32)
        from auth_sessions import verified_credentials
        credentials = verified_credentials.get()
        admin = await self.storage.get_admin()
        if admin is None or admin["username"] != username:
            raise HTTPException(status_code=401, detail="유효하지 않은 사용자입니다")
        version = credentials[1] if credentials and credentials[0] == username else admin["auth_version"]
        if not await self.storage.create_auth_session(session_id, username, expire.timestamp(), version):
            raise HTTPException(status_code=401, detail="유효하지 않은 사용자입니다")
        to_encode = {
            "sub": username,
            "sid": session_id,
            "exp": expire,
            "iat": datetime.now(UTC),
        }
        encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=self.token_algorithm)
        return encoded_jwt

    async def refresh_access_token(self, username: str) -> str:
        """Refresh within the same revocable login session."""
        from auth_sessions import current_session
        session = current_session.get()
        expire = datetime.now(UTC) + timedelta(hours=self.token_expire_hours)
        if (session is None or session.username != username or not session.active
                or not await self.storage.refresh_auth_session(session.session_id, expire.timestamp())):
            raise HTTPException(status_code=401, detail="인증 세션이 만료되었습니다")
        session.expires_at = expire.timestamp()
        return jwt.encode({"sub": username, "sid": session.session_id, "exp": expire,
                           "iat": datetime.now(UTC)}, await self.ensure_secret_key(), algorithm=self.token_algorithm)

    async def logout_session(self) -> None:
        """Revoke the authenticated browser and its derived streaming credentials."""
        from auth_sessions import current_session, revoke_connections
        session = current_session.get()
        if session is not None:
            async with self._auth_session_lock:
                await self.storage.revoke_auth_session(session.session_id)
                await revoke_connections(session.username, session.session_id)

    async def verify_token(self, token: str) -> str | None:
        """Verify JWT token and return username (단, otp_pending / scoped 토큰은 거부)."""
        from auth_sessions import bind_session, current_session
        current_session.set(None)
        try:
            secret_key = await self.ensure_secret_key()
            payload = jwt.decode(token, secret_key, algorithms=[self.token_algorithm])
            if payload.get("otp_pending"):
                # Pending second-factor credentials cannot access ordinary APIs.
                return None
            if payload.get("scope"):
                # Reject legacy scoped ITL credentials until they expire.
                return None
            username: str = payload.get("sub")
            if username is None:
                return None
            session_id = payload.get("sid")
            if not isinstance(session_id, str):
                return None
            async with self._auth_session_lock:
                expires_at = await self.storage.auth_session_expiry(session_id, username)
                if expires_at is None:
                    return None
                session = bind_session(session_id, username, expires_at)
                if not session.active:
                    return None
            return username
        except JWTError:
            return None
