"""The app's LoginAlert, wired to the session store. Kept apart so login_alert stays pure."""
from __future__ import annotations

import logging

import jwt

from auth_sessions import revoke_connections
from login_alert import from_env
from sqlite_storage import storage

logger = logging.getLogger(__name__)


async def _admin_username() -> str | None:
    admin = await storage.get_admin()
    return admin.get("username") if admin else None


async def _logout_session(session_id: str) -> bool:
    found = await storage.revoke_auth_session(session_id)
    username = await _admin_username()
    if username:
        await revoke_connections(username, session_id)
    return found


async def _logout_all() -> None:
    username = await _admin_username()
    if not username:
        return
    await storage.revoke_all_auth_sessions(username)
    await revoke_connections(username)


login_alert = from_env(logout_session=_logout_session, logout_all=_logout_all)


def alert_login(access_token: str, *, method: str, ip: str, user_agent: str) -> None:
    """Called right after a login issued `access_token`. Never raises."""
    if not login_alert.enabled:
        return
    try:
        # Our own freshly signed token; only the session id is read from it.
        session_id = jwt.decode(access_token, options={"verify_signature": False}).get("sid", "")
    except jwt.PyJWTError as exc:
        logger.warning("login alert skipped, unreadable token: %s", exc)
        return
    login_alert.notify(session_id=session_id, method=method, ip=ip, user_agent=user_agent)
