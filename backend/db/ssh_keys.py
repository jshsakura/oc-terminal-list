"""SSH 개인키(암호화 저장) 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class SshKeyMixin:
    async def list_ssh_keys(self, username: str) -> list[dict]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, name, public_key, created_at FROM ssh_keys WHERE username = ? ORDER BY created_at DESC",
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_ssh_key(self, key_id: str, username: str) -> dict | None:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT id, name, public_key, private_key_enc, passphrase_enc, created_at FROM ssh_keys WHERE id = ? AND username = ?",
                    (key_id, username),
                ).fetchone()
                return dict(row) if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def create_ssh_key(
        self,
        key_id: str,
        username: str,
        name: str,
        public_key: str | None,
        private_key_enc: str,
        passphrase_enc: str | None,
    ) -> None:
        def _create():
            now = datetime.utcnow().isoformat()
            conn = self._get_connection()
            try:
                conn.execute(
                    """INSERT INTO ssh_keys (id, username, name, public_key, private_key_enc, passphrase_enc, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (key_id, username, name, public_key, private_key_enc, passphrase_enc, now),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_create)

    async def update_ssh_key(
        self,
        key_id: str,
        username: str,
        name: str | None = None,
        public_key: str | None = None,
        private_key_enc: str | None = None,
        passphrase_enc: str | None = None,
        clear_passphrase: bool = False,
    ) -> bool:
        """필드별 부분 업데이트. None 은 미변경, clear_passphrase=True 면 passphrase 제거."""
        def _update():
            sets = []
            params: list = []
            if name is not None:
                sets.append("name = ?")
                params.append(name)
            if public_key is not None:
                sets.append("public_key = ?")
                params.append(public_key)
            if private_key_enc is not None:
                sets.append("private_key_enc = ?")
                params.append(private_key_enc)
            if clear_passphrase:
                sets.append("passphrase_enc = NULL")
            elif passphrase_enc is not None:
                sets.append("passphrase_enc = ?")
                params.append(passphrase_enc)
            if not sets:
                return False
            params.extend([key_id, username])
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    f"UPDATE ssh_keys SET {', '.join(sets)} WHERE id = ? AND username = ?",
                    tuple(params),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_update)

    async def delete_ssh_key(self, key_id: str, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM ssh_keys WHERE id = ? AND username = ?", (key_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- hosts --------
