"""관리자 계정 · OTP · 백업코드 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

import asyncio
import sqlite3
import time
from datetime import datetime
from typing import TypedDict

import anyio


class AdminRecord(TypedDict):
    username: str
    password: str
    created_at: str
    otp_secret_enc: str | None
    otp_enabled: bool
    otp_enabled_at: str | None
    auth_version: int


class AdminMixin:
    async def admin_exists(self) -> bool:
        def _check():
            conn = self._get_connection()
            try:
                count = conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0]
                return count > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_check)

    async def create_admin(self, username: str, password_hash: str) -> bool:
        def _create():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT INTO admin (username, password, created_at) VALUES (?, ?, ?)",
                    (username, password_hash, datetime.utcnow().isoformat()),
                )
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_create)

    async def get_admin(self) -> AdminRecord | None:
        def _get() -> AdminRecord | None:
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT username, password, created_at, otp_secret_enc, otp_enabled, otp_enabled_at, "
                    "auth_version FROM admin LIMIT 1"
                ).fetchone()
                if not row:
                    return None
                return {
                    "username": row["username"],
                    "password": row["password"],
                    "created_at": row["created_at"],
                    "otp_secret_enc": row["otp_secret_enc"],
                    "otp_enabled": bool(row["otp_enabled"]),
                    "otp_enabled_at": row["otp_enabled_at"],
                    "auth_version": row["auth_version"],
                }
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def update_admin_password(self, username: str, password_hash: str) -> bool:
        def _update():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "UPDATE admin SET password = ?, auth_version = auth_version + 1 WHERE username = ?",
                    (password_hash, username),
                )
                conn.execute("DELETE FROM auth_sessions WHERE username = ?", (username,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_update)

    async def create_auth_session(
        self, session_id: str, username: str, expires_at: float, version: int
    ) -> bool:
        """Create a login session with the current credential generation."""
        def _create() -> bool:
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (time.time(),))
                result = conn.execute(
                    "INSERT INTO auth_sessions SELECT ?, username, auth_version, ? FROM admin "
                    "WHERE username = ? AND auth_version = ?",
                    (session_id, expires_at, username, version),
                )
                conn.commit()
                return result.rowcount == 1
            finally:
                self._release_connection(conn)
        return await anyio.to_thread.run_sync(_create)

    async def auth_session_expiry(self, session_id: str, username: str) -> float | None:
        """Check generation, ownership and expiry together on every authenticated request."""
        def _read() -> float | None:
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT s.expires_at FROM auth_sessions s JOIN admin a ON a.username = s.username "
                    "WHERE s.session_id = ? AND s.username = ? AND s.auth_version = a.auth_version "
                    "AND s.expires_at > ?", (session_id, username, time.time()),
                ).fetchone()
                return float(row[0]) if row else None
            finally:
                self._release_connection(conn)
        return await anyio.to_thread.run_sync(_read)

    async def refresh_auth_session(self, session_id: str, expires_at: float) -> bool:
        """Extend an existing valid session without recreating a revoked one."""
        def _refresh() -> bool:
            conn = self._get_connection()
            try:
                result = conn.execute(
                    "UPDATE auth_sessions SET expires_at = ? WHERE session_id = ? AND expires_at > ? "
                    "AND auth_version = (SELECT auth_version FROM admin WHERE username = auth_sessions.username)",
                    (expires_at, session_id, time.time()),
                )
                conn.commit()
                return result.rowcount == 1
            finally:
                self._release_connection(conn)
        return await anyio.to_thread.run_sync(_refresh)

    async def revoke_auth_session(self, session_id: str) -> bool:
        """Persist logout so every token in this refresh family stays invalid after restart.

        Returns whether the session was still live."""
        def _revoke() -> bool:
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM auth_sessions WHERE session_id = ?", (session_id,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await anyio.to_thread.run_sync(_revoke)

    async def revoke_all_auth_sessions(self, username: str) -> None:
        """Log out every device: bumping auth_version also voids tokens issued before now."""
        def _revoke_all() -> None:
            conn = self._get_connection()
            try:
                conn.execute("UPDATE admin SET auth_version = auth_version + 1 WHERE username = ?", (username,))
                conn.execute("DELETE FROM auth_sessions WHERE username = ?", (username,))
                conn.commit()
            finally:
                self._release_connection(conn)
        await anyio.to_thread.run_sync(_revoke_all)

    async def set_admin_otp(self, username: str, secret_enc: str | None, enabled: bool) -> None:
        def _set():
            conn = self._get_connection()
            try:
                enabled_at = datetime.utcnow().isoformat() if enabled else None
                conn.execute(
                    "UPDATE admin SET otp_secret_enc = ?, otp_enabled = ?, otp_enabled_at = ? WHERE username = ?",
                    (secret_enc, 1 if enabled else 0, enabled_at, username),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_set)

    async def replace_backup_codes(self, username: str, code_hashes: list[str]) -> None:
        """기존 코드 모두 삭제하고 새 코드로 교체."""
        def _replace():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM admin_backup_codes WHERE username = ?", (username,))
                now = datetime.utcnow().isoformat()
                conn.executemany(
                    "INSERT INTO admin_backup_codes (username, code_hash, used, created_at) VALUES (?, ?, 0, ?)",
                    [(username, h, now) for h in code_hashes],
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_replace)

    async def list_unused_backup_codes(self, username: str) -> list[dict[str, str]]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, code_hash FROM admin_backup_codes WHERE username = ? AND used = 0",
                    (username,),
                ).fetchall()
                return [{"id": row["id"], "code_hash": row["code_hash"]} for row in rows]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def count_unused_backup_codes(self, username: str) -> int:
        def _count():
            conn = self._get_connection()
            try:
                return conn.execute(
                    "SELECT COUNT(*) FROM admin_backup_codes WHERE username = ? AND used = 0",
                    (username,),
                ).fetchone()[0]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_count)

    async def consume_backup_code(self, code_id: int) -> bool:
        def _consume():
            conn = self._get_connection()
            try:
                now = datetime.utcnow().isoformat()
                cur = conn.execute(
                    "UPDATE admin_backup_codes SET used = 1, used_at = ? WHERE id = ? AND used = 0",
                    (now, code_id),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_consume)

    async def clear_backup_codes(self, username: str) -> None:
        def _clear():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM admin_backup_codes WHERE username = ?", (username,))
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_clear)

    # -------- sessions --------
