"""서버 키/값 설정 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class AppConfigMixin:
    async def get_config(self, key: str) -> str | None:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT value FROM system_config WHERE key = ?", (key,)
                ).fetchone()
                return row["value"] if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def set_config(self, key: str, value: str) -> bool:
        def _set():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO system_config (key, value, created_at) VALUES (?, ?, ?)",
                    (key, value, datetime.utcnow().isoformat()),
                )
                conn.commit()
                return True
            except Exception:
                return False
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_set)

    async def delete_config(self, key: str) -> bool:
        def _del():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM system_config WHERE key = ?", (key,))
                conn.commit()
                return True
            except Exception:
                return False
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_del)

    # -------- usage tracking --------
