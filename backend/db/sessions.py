"""터미널 세션 메타(소유자·이름·마지막 활동) 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class SessionMixin:
    async def create_session(self, session_id: str, username: str, cwd: str | None = None, name: str | None = None) -> None:
        def _create():
            now = datetime.utcnow().isoformat()
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO sessions (session_id, username, name, cwd, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?)",
                    (session_id, username, name, cwd, now, now),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_create)

    async def get_session_owner(self, session_id: str) -> str | None:
        """세션의 소유자 username. 없으면 None — WS attach 시 소유권 검증용."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT username FROM sessions WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                return row["username"] if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_user_sessions(self, username: str) -> list[dict[str, str]]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT session_id, name, cwd, created_at, last_active FROM sessions WHERE username = ? ORDER BY last_active DESC",
                    (username,),
                ).fetchall()
                return [
                    {
                        "id": row["session_id"],
                        "name": row["name"],
                        "cwd": row["cwd"],
                        "created_at": row["created_at"],
                        "last_active": row["last_active"],
                    }
                    for row in rows
                ]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def update_session_activity(self, session_id: str) -> None:
        def _update():
            conn = self._get_connection()
            try:
                conn.execute(
                    "UPDATE sessions SET last_active = ? WHERE session_id = ?",
                    (datetime.utcnow().isoformat(), session_id),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def update_session_name(self, session_id: str, name: str) -> None:
        def _update():
            conn = self._get_connection()
            try:
                conn.execute(
                    "UPDATE sessions SET name = ? WHERE session_id = ?",
                    (name, session_id),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def prune_sessions_not_in(self, live_ids: set[str]) -> int:
        """tmux 에 없는 세션 행을 지운다. 지운 개수를 돌려준다.

        왜 필요한가: 세션 행은 `DELETE /api/sessions/{id}` 로만 지워진다. 그런데 세션은 그
        경로를 **안 거치고도** 죽는다 — 기계 재부팅, tmux 서버 종료, OOM kill. 그때 행은
        영원히 남고 아무도 치우지 않는다. 실측으로 5~6월치 45개가 그렇게 쌓여 있었다.

        ⚠️ **호출자가 live_ids 가 믿을 만한지 먼저 판단해야 한다.** 빈 목록은 "전부 죽었다"
        와 "tmux 를 못 물어봤다" 가 같은 모습이고, 살아있는 세션의 행을 지우면 소유권 조회가
        None 이 되어 그 세션에 **다시 붙지 못한다**(행이 사라지는 것보다 나쁘다).
        그래서 이 함수는 빈 집합을 받으면 아무것도 하지 않는다.
        """
        if not live_ids:
            return 0

        def _prune():
            conn = self._get_connection()
            try:
                rows = conn.execute("SELECT session_id FROM sessions").fetchall()
                dead = [r["session_id"] for r in rows if r["session_id"] not in live_ids]
                if dead:
                    conn.executemany(
                        "DELETE FROM sessions WHERE session_id = ?", [(d,) for d in dead]
                    )
                    conn.commit()
                return len(dead)
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_prune)

    async def delete_session(self, session_id: str) -> None:
        def _delete():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_delete)

    # -------- ssh keys --------
