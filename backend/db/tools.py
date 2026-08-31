"""사용자가 직접 쓴 설치 도구 목록.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.

내장 목록(host_tools.BUILTIN_TOOLS)은 여기 저장하지 않는다. 저장하면 사용자마다 사본이
생겨 우리가 명령을 고쳐도 옛 사본이 남는다 — 내장은 코드가, 사용자 것은 이 표가 소유한다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime


class ToolMixin:
    async def list_tools(self, username: str) -> list[dict]:
        def _list():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "SELECT id, name, description, url, check_command, install_command, "
                    "sort_index, created_at, updated_at "
                    "FROM tools WHERE username=? ORDER BY sort_index ASC, created_at ASC",
                    (username,),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def create_tool(self, username: str, tool_id: str, name: str,
                          install_command: str, check_command: str = '',
                          description: str = '', url: str = '',
                          sort_index: int = 0) -> dict:
        def _create():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT INTO tools(id,username,name,description,url,check_command,"
                    "install_command,sort_index) VALUES(?,?,?,?,?,?,?,?)",
                    (tool_id, username, name, description, url, check_command,
                     install_command, sort_index),
                )
                conn.commit()
                cur = conn.execute(
                    "SELECT id,name,description,url,check_command,install_command,"
                    "sort_index,created_at,updated_at FROM tools WHERE id=?",
                    (tool_id,),
                )
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, cur.fetchone()))
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_create)

    async def update_tool(self, username: str, tool_id: str, **fields) -> bool:
        allowed = {'name', 'description', 'url', 'check_command', 'install_command', 'sort_index'}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return False

        def _update():
            conn = self._get_connection()
            try:
                sets = ', '.join(f"{k}=?" for k in updates)
                vals = [*updates.values(),
                        datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), tool_id, username]
                cur = conn.execute(
                    f"UPDATE tools SET {sets}, updated_at=? WHERE id=? AND username=?", vals
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_update)

    async def delete_tool(self, username: str, tool_id: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM tools WHERE id=? AND username=?", (tool_id, username)
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)
