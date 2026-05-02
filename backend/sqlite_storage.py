"""
SQLite 저장소 — 사용자/세션 메타/시스템 설정만 보관

세션 출력 히스토리는 tmux 스크롤백이 담당하므로 여기서는 다루지 않는다.
"""
import asyncio
import os
import sqlite3
from datetime import datetime
from typing import Dict, List, Optional


DEFAULT_DB_PATH = os.getenv("DB_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "iterminallist.db",
)


class SQLiteStorage:
    """SQLite 기반 저장소 (admin / sessions / system_config)"""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        self._ensure_directory()
        self._init_db()

    def _ensure_directory(self) -> None:
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT,
                cwd TEXT,
                created_at TEXT NOT NULL,
                last_active TEXT NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username)")

        # 기존 DB 호환 마이그레이션 (name/cwd 컬럼 누락 케이스)
        cursor.execute("PRAGMA table_info(sessions)")
        columns = {row[1] for row in cursor.fetchall()}
        if "name" not in columns:
            cursor.execute("ALTER TABLE sessions ADD COLUMN name TEXT")
        if "cwd" not in columns:
            cursor.execute("ALTER TABLE sessions ADD COLUMN cwd TEXT")

        # 과거 버전의 history 테이블이 있으면 정리
        cursor.execute("DROP TABLE IF EXISTS session_history")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        conn.commit()
        conn.close()

    # -------- admin --------

    async def admin_exists(self) -> bool:
        def _check():
            conn = self._get_connection()
            try:
                count = conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0]
                return count > 0
            finally:
                conn.close()
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
                conn.close()
        return await asyncio.to_thread(_create)

    async def get_admin(self) -> Optional[Dict[str, str]]:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT username, password, created_at FROM admin LIMIT 1"
                ).fetchone()
                if not row:
                    return None
                return {
                    "username": row["username"],
                    "password": row["password"],
                    "created_at": row["created_at"],
                }
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    # -------- sessions --------

    async def create_session(self, session_id: str, username: str, cwd: Optional[str] = None, name: Optional[str] = None) -> None:
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
                conn.close()
        await asyncio.to_thread(_create)

    async def get_user_sessions(self, username: str) -> List[Dict[str, str]]:
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
                conn.close()
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
                conn.close()
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
                conn.close()
        await asyncio.to_thread(_update)

    async def delete_session(self, session_id: str) -> None:
        def _delete():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_delete)

    # -------- system config --------

    async def get_config(self, key: str) -> Optional[str]:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT value FROM system_config WHERE key = ?", (key,)
                ).fetchone()
                return row["value"] if row else None
            finally:
                conn.close()
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
                conn.close()
        return await asyncio.to_thread(_set)

    # -------- lifecycle --------

    async def connect(self) -> None:
        """no-op (호환성 유지)"""
        return

    async def close(self) -> None:
        """no-op (호환성 유지)"""
        return


storage = SQLiteStorage()
