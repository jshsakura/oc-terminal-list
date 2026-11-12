"""Optional Cloudflare Access gate; unsigned headers and local tokens never bypass it."""
from __future__ import annotations

import hashlib
import os
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

import anyio
import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette._utils import get_route_path
from starlette.datastructures import Headers
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from auth_sessions import BrowserSession, bind_session, current_session


class AccessConfigurationError(RuntimeError):
    def __init__(self, setting: str) -> None:
        super().__init__(f"Invalid Cloudflare Access configuration: {setting}")
        self.setting = setting


class AccessDeniedError(Exception):
    """The assertion cannot establish a trusted Access identity."""


@dataclass(frozen=True, slots=True)
class AccessSettings:
    issuer: str
    audience: str
    allowed_emails: frozenset[str] = frozenset()

    @classmethod
    def from_env(cls) -> AccessSettings | None:
        domain = os.getenv("CF_ACCESS_TEAM_DOMAIN", "").strip()
        audience = os.getenv("CF_ACCESS_AUD", "").strip()
        if not domain and not audience:
            return None
        if not domain or not audience:
            raise AccessConfigurationError("CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must both be set")
        parsed = urlsplit(domain if "://" in domain else "https://" + domain)
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".cloudflareaccess.com")
                or parsed.username or parsed.password or parsed.port
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise AccessConfigurationError("CF_ACCESS_TEAM_DOMAIN")
        emails = frozenset(item.strip().casefold() for item in
                           os.getenv("CF_ACCESS_ALLOWED_EMAILS", "").split(",") if item.strip())
        return cls("https://" + parsed.hostname, audience, emails)


class AccessClaims(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    expires_at: float = Field(alias="exp", allow_inf_nan=False)
    email: str | None = None


class AccessSigningKey(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    kty: Literal["RSA"]
    kid: str
    n: str
    e: str
    alg: Literal["RS256"] = "RS256"
    use: Literal["sig"] = "sig"


class AccessSigningKeys(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    keys: tuple[AccessSigningKey, ...]


@dataclass(frozen=True, slots=True)
class AccessIdentity:
    username: str
    session_id: str
    expires_at: float
    email: str | None


current_access: ContextVar[AccessIdentity | None] = ContextVar("cloudflare_access", default=None)


def access_configured() -> bool:
    return bool(os.getenv("CF_ACCESS_TEAM_DOMAIN", "").strip() or os.getenv("CF_ACCESS_AUD", "").strip())


def restore_access_session() -> BrowserSession | None:
    identity = current_access.get()
    if identity is None:
        return None
    return bind_session(identity.session_id, identity.username, identity.expires_at)


async def _admin_username() -> str:
    from sqlite_storage import storage
    admin = await storage.get_admin()
    return admin["username"] if admin else "admin"


class AccessVerifier:
    def __init__(self, settings: AccessSettings, *, transport: httpx.AsyncBaseTransport | None = None,
                 resolve_username: Callable[[], Awaitable[str]] = _admin_username) -> None:
        self.settings = settings
        self.transport = transport
        self.resolve_username = resolve_username
        self._username: str | None = None
        self._keys: dict[str, RSAPublicKey] = {}
        self._expires_at = 0.0
        self._last_miss_refresh = float("-inf")
        self._lock = anyio.Lock()

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=5, transport=self.transport, trust_env=False) as client:
            response = await client.get(self.settings.issuer + "/cdn-cgi/access/certs")
            response.raise_for_status()
            document = AccessSigningKeys.model_validate(response.json())
            key_set = jwt.PyJWKSet.from_dict(document.model_dump(mode="json"))
        keys = {key.key_id: key.key for key in key_set.keys
                if isinstance(key.key_id, str) and isinstance(key.key, RSAPublicKey)
                and key.public_key_use in (None, "sig") and key.algorithm_name == "RS256"}
        if not keys:
            raise AccessDeniedError
        self._keys = keys
        self._expires_at = time.monotonic() + 300

    async def _key(self, kid: str) -> RSAPublicKey:
        async with self._lock:
            if time.monotonic() >= self._expires_at:
                await self._refresh()
            if kid not in self._keys:
                # One immediate rotation refresh, then bound unauthenticated unknown-kid traffic.
                now = time.monotonic()
                if now - self._last_miss_refresh < 5:
                    raise AccessDeniedError
                self._last_miss_refresh = now
                await self._refresh()
            key = self._keys.get(kid)
            if key is None:
                raise AccessDeniedError
            return key

    async def verify(self, token: str) -> AccessIdentity:
        if not token or len(token) > 32_768:
            raise AccessDeniedError
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            if header.get("alg") != "RS256" or not isinstance(kid, str) or not 1 <= len(kid) <= 256:
                raise AccessDeniedError
            key = await self._key(kid)
            claims = AccessClaims.model_validate(jwt.decode(
                token, key, algorithms=["RS256"], audience=self.settings.audience,
                issuer=self.settings.issuer, options={"require": ["exp", "iss", "aud"]},
            ))
        except (jwt.PyJWTError, httpx.HTTPError, ValidationError, ValueError, TypeError) as exc:
            raise AccessDeniedError from exc
        email = claims.email.casefold().strip() if claims.email else None
        if self.settings.allowed_emails and email not in self.settings.allowed_emails:
            raise AccessDeniedError
        if self._username is None:
            async with self._lock:
                if self._username is None:
                    self._username = await self.resolve_username()
        return AccessIdentity(self._username, "cf:" + hashlib.sha256(token.encode()).hexdigest(),
                              claims.expires_at, email)


class CloudflareAccessMiddleware:
    def __init__(self, app: ASGIApp, *, verifier: AccessVerifier | None = None) -> None:
        self.app = app
        settings = AccessSettings.from_env() if verifier is None else verifier.settings
        self.verifier = verifier or (AccessVerifier(settings) if settings else None)

    @staticmethod
    async def _deny(scope: Scope, receive: Receive, send: Send, status: int = 401) -> None:
        response = JSONResponse({"detail": "Cloudflare Access authentication required",
                                 "auth_mode": "cloudflare_access"}, status_code=status,
                                headers={"Cache-Control": "no-store"})
        if scope["type"] == "http":
            await response(scope, receive, send)
        elif "websocket.http.response" in scope.get("extensions", {}):
            await send({"type": "websocket.http.response.start", "status": status,
                        "headers": response.raw_headers})
            await send({"type": "websocket.http.response.body", "body": response.body})
        else:
            await send({"type": "websocket.close", "code": 1008})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.verifier is None or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        connection = HTTPConnection(scope)
        headers = Headers(scope=scope)
        token = (headers["cf-access-jwt-assertion"] if "cf-access-jwt-assertion" in headers
                 else connection.cookies.get("CF_Authorization", ""))
        try:
            identity = await self.verifier.verify(token)
        except AccessDeniedError:
            await self._deny(scope, receive, send)
            return
        if headers.get("origin") and (scope["type"] == "websocket"
                                     or scope.get("method") not in ("GET", "HEAD", "OPTIONS")):
            from ws_auth import _origin_ok
            if not _origin_ok(connection):
                await self._deny(scope, receive, send, 403)
                return
        path = get_route_path(scope).rstrip("/")
        if path.startswith("/api/auth/") and path not in {
            "/api/auth/status", "/api/auth/verify", "/api/auth/refresh", "/api/auth/logout",
        }:
            await self._deny(scope, receive, send, 403)
            return
        identity_context = current_access.set(identity)
        session_context = current_session.set(None)
        restore_access_session()
        try:
            if scope["type"] == "http":
                await self.app(scope, receive, send)
                return
            closed = False
            accepted = False

            async def tracked_send(message: Message) -> None:
                nonlocal closed, accepted
                if message["type"] == "websocket.accept":
                    accepted = True
                elif message["type"] == "websocket.close":
                    closed = True
                await send(message)

            with anyio.move_on_after(max(0, identity.expires_at - time.time())) as timeout:
                await self.app(scope, receive, tracked_send)
            if timeout.cancel_called and not closed:
                if accepted:
                    await send({"type": "websocket.close", "code": 1008, "reason": "Access session expired"})
                else:
                    await self._deny(scope, receive, send)
        finally:
            current_session.reset(session_context)
            current_access.reset(identity_context)
