"""웹 푸시 구독 저장.

SQLiteStorage 에 믹스인으로 합류한다. endpoint 가 브라우저가 발급한 고유 주소라
그대로 PK 로 쓴다 — 같은 기기가 다시 구독하면 같은 endpoint 로 덮어써진다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime


class PushSubscriptionMixin:
    async def save_push_subscription(self, username: str, endpoint: str, p256dh: str,
                                     auth: str, user_agent: str | None = None) -> None:
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    """INSERT INTO push_subscriptions (endpoint, username, p256dh, auth, user_agent, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(endpoint) DO UPDATE SET
                         username=excluded.username, p256dh=excluded.p256dh,
                         auth=excluded.auth, user_agent=excluded.user_agent""",
                    (endpoint, username, p256dh, auth, user_agent, datetime.utcnow().isoformat()),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_save)

    async def list_push_subscriptions(self, username: str) -> list[dict]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT endpoint, p256dh, auth, user_agent FROM push_subscriptions WHERE username = ?",
                    (username,),
                ).fetchall()
                return [
                    {"endpoint": r[0], "keys": {"p256dh": r[1], "auth": r[2]}, "user_agent": r[3]}
                    for r in rows
                ]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def delete_push_subscription(self, endpoint: str) -> bool:
        """구독 취소, 또는 푸시 서비스가 404/410 으로 '죽었다' 고 알려줬을 때 정리."""
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    async def count_push_subscriptions(self, username: str) -> int:
        def _count():
            conn = self._get_connection()
            try:
                return conn.execute(
                    "SELECT COUNT(*) FROM push_subscriptions WHERE username = ?", (username,)
                ).fetchone()[0]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_count)
