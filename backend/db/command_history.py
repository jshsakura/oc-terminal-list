"""명령 히스토리 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

import asyncio
import time



class CommandHistoryMixin:
    async def push_command_history(self, username: str, terminal_key: str, text: str) -> None:
        """동일 (user, terminal, text) 가 있으면 updated_at 만 갱신 (위로 승격),
        없으면 새 row 삽입. text 는 호출 측이 trim/길이 제한 했다고 가정.
        """
        now_ms = int(time.time() * 1000)
        def _upsert():
            conn = self._get_connection()
            try:
                # SQLite 의 UPSERT (ON CONFLICT) — UNIQUE(username, terminal_key, text) 충돌 시 ts 갱신.
                conn.execute(
                    """
                    INSERT INTO command_history (username, terminal_key, text, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(username, terminal_key, text)
                    DO UPDATE SET updated_at = excluded.updated_at
                    """,
                    (username, terminal_key, text, now_ms),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_upsert)

    async def get_command_history(
        self, username: str, terminal_key: str, *, before_ms: int | None = None, limit: int = 20,
    ) -> list[dict]:
        """최신 → 과거 순서로 limit 개. before_ms 가 있으면 그 시각보다 더 오래된 것만 (cursor 페이지)."""
        limit = max(1, min(int(limit or 20), 100))
        def _get():
            conn = self._get_connection()
            try:
                if before_ms is not None:
                    rows = conn.execute(
                        """
                        SELECT text, updated_at FROM command_history
                        WHERE username = ? AND terminal_key = ? AND updated_at < ?
                        ORDER BY updated_at DESC
                        LIMIT ?
                        """,
                        (username, terminal_key, int(before_ms), limit),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT text, updated_at FROM command_history
                        WHERE username = ? AND terminal_key = ?
                        ORDER BY updated_at DESC
                        LIMIT ?
                        """,
                        (username, terminal_key, limit),
                    ).fetchall()
                return [{"text": r["text"], "ts": int(r["updated_at"])} for r in rows]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def delete_command_history_entry(self, username: str, terminal_key: str, text: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM command_history WHERE username = ? AND terminal_key = ? AND text = ?",
                    (username, terminal_key, text),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    async def clear_command_history(self, username: str, terminal_key: str) -> int:
        def _clear():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM command_history WHERE username = ? AND terminal_key = ?",
                    (username, terminal_key),
                )
                conn.commit()
                return cur.rowcount
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_clear)

    async def cleanup_command_history(self, *, retention_days: int = 30) -> int:
        """retention_days 보다 오래된 row 삭제. 백엔드 startup / 주기적으로 호출."""
        cutoff_ms = int((time.time() - retention_days * 86400) * 1000)
        def _cleanup():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM command_history WHERE updated_at < ?", (cutoff_ms,),
                )
                conn.commit()
                return cur.rowcount
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_cleanup)

    # -------- passkey credentials (WebAuthn) --------
