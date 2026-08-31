"""SSH 호스트 등록·정렬·마지막 cwd 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class HostMixin:
    async def list_hosts(self, username: str) -> list[dict]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    """SELECT id, name, hostname, port, ssh_user, auth_method, key_id,
                              color_index, group_name, use_remote_tmux, remote_tmux_session,
                              start_path, last_cwd, icon, theme, sort_index, created_at, last_used
                       FROM hosts WHERE username = ?
                       ORDER BY sort_index IS NULL, sort_index ASC,
                                group_name NULLS LAST, last_used DESC, name ASC""",
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_host(self, host_id: str, username: str) -> dict | None:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    """SELECT id, name, hostname, port, ssh_user, auth_method, key_id,
                              password_enc, color_index, group_name, use_remote_tmux,
                              remote_tmux_session, start_path, last_cwd, icon, theme, created_at,
                              last_used, cred_epoch
                       FROM hosts WHERE id = ? AND username = ?""",
                    (host_id, username),
                ).fetchone()
                return dict(row) if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def upsert_host(self, host_id: str, username: str, **fields) -> None:
        """호스트 생성/수정. fields 에 들어있는 키만 갱신 (PATCH 시맨틱)."""
        allowed = {
            "name", "hostname", "port", "ssh_user", "auth_method", "key_id",
            "password_enc", "color_index", "group_name", "use_remote_tmux",
            "remote_tmux_session", "start_path", "icon", "theme",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}

        def _upsert():
            conn = self._get_connection()
            try:
                now = datetime.utcnow().isoformat()
                existing = conn.execute("SELECT id FROM hosts WHERE id = ? AND username = ?", (host_id, username)).fetchone()
                if existing:
                    if not updates:
                        return
                    cols = ", ".join([f"{k} = ?" for k in updates.keys()])
                    conn.execute(
                        f"UPDATE hosts SET {cols} WHERE id = ? AND username = ?",
                        (*updates.values(), host_id, username),
                    )
                else:
                    conn.execute(
                        """INSERT INTO hosts (id, username, name, hostname, port, ssh_user,
                                              auth_method, key_id, password_enc, color_index,
                                              group_name, use_remote_tmux, remote_tmux_session,
                                              start_path, icon, theme, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            host_id, username,
                            updates.get("name", "Unnamed"),
                            updates.get("hostname", ""),
                            int(updates.get("port", 22)),
                            updates.get("ssh_user", "root"),
                            updates.get("auth_method", "key"),
                            updates.get("key_id"),
                            updates.get("password_enc"),
                            int(updates.get("color_index", 0)),
                            updates.get("group_name"),
                            int(updates.get("use_remote_tmux", 1)),
                            updates.get("remote_tmux_session", "mobile"),
                            updates.get("start_path"),
                            updates.get("icon"),
                            updates.get("theme"),
                            now,
                        ),
                    )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_upsert)

    async def touch_host(self, host_id: str, username: str) -> None:
        def _touch():
            conn = self._get_connection()
            try:
                conn.execute(
                    "UPDATE hosts SET last_used = ? WHERE id = ? AND username = ?",
                    (datetime.utcnow().isoformat(), host_id, username),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_touch)

    async def reorder_hosts(self, username: str, ids: list[str]) -> None:
        """주어진 id 순서대로 sort_index 0..N-1 으로 갱신. 목록에 없는 호스트는 그대로."""
        def _reorder():
            conn = self._get_connection()
            try:
                for idx, host_id in enumerate(ids):
                    conn.execute(
                        "UPDATE hosts SET sort_index = ? WHERE id = ? AND username = ?",
                        (idx, host_id, username),
                    )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_reorder)

    async def update_host_last_cwd(self, host_id: str, username: str, cwd: str | None) -> None:
        """호스트의 마지막 cwd 갱신. 빈 문자열은 None 으로 정규화."""
        normalized = (cwd or "").strip() or None
        def _update():
            conn = self._get_connection()
            try:
                conn.execute(
                    "UPDATE hosts SET last_cwd = ? WHERE id = ? AND username = ?",
                    (normalized, host_id, username),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def delete_host(self, host_id: str, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM hosts WHERE id = ? AND username = ?", (host_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- user settings (UI 환경설정 — 테마/폰트 등) --------
