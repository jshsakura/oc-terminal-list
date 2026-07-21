"""명령 스니펫 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class SnippetMixin:
    async def list_snippets(self, username: str) -> list[dict]:
        def _list():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "SELECT id, name, command, tags, sort_index, created_at, updated_at "
                    "FROM snippets WHERE username=? ORDER BY sort_index ASC, created_at ASC",
                    (username,)
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def create_snippet(self, username: str, snippet_id: str, name: str, command: str, tags: str = '', sort_index: int = 0) -> dict:
        def _create():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT INTO snippets(id,username,name,command,tags,sort_index) VALUES(?,?,?,?,?,?)",
                    (snippet_id, username, name, command, tags, sort_index)
                )
                conn.commit()
                cur = conn.execute("SELECT id,name,command,tags,sort_index,created_at,updated_at FROM snippets WHERE id=?", (snippet_id,))
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, cur.fetchone()))
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_create)

    async def update_snippet(self, username: str, snippet_id: str, **fields) -> bool:
        allowed = {'name', 'command', 'tags', 'sort_index'}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False
        def _update():
            conn = self._get_connection()
            try:
                sets = ', '.join(f"{k}=?" for k in updates)
                vals = list(updates.values()) + [datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), snippet_id, username]
                cur = conn.execute(
                    f"UPDATE snippets SET {sets}, updated_at=? WHERE id=? AND username=?", vals
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_update)

    async def delete_snippet(self, username: str, snippet_id: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM snippets WHERE id=? AND username=?", (snippet_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- lifecycle --------
