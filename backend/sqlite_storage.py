"""
SQLite Storage Manager
로컬 파일 기반 데이터 저장 (Redis 대체)
"""
import sqlite3
import asyncio
from typing import List, Optional, Dict
from datetime import datetime
import os


class SQLiteStorage:
    """SQLite 기반 저장소"""

    def __init__(self, db_path: str = None):
        if db_path is None:
            # 환경 변수 또는 기본값 사용
            db_path = os.getenv("DB_PATH", "./data/iterminallist.db")
        self.db_path = db_path
        self._ensure_directory()
        self._init_db()

    def _ensure_directory(self):
        """데이터 디렉토리 생성"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _get_connection(self) -> sqlite3.Connection:
        """SQLite 연결 반환"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """데이터베이스 초기화"""
        conn = self._get_connection()
        cursor = conn.cursor()

        # 관리자 계정 테이블
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        # 세션 테이블 (사용자별 세션 관리)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_active TEXT NOT NULL
            )
        """)

        # 세션 히스토리 테이블
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS session_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                chunk TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                UNIQUE(session_id, id)
            )
        """)

        # 인덱스 생성
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_session_id
            ON session_history(session_id)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sessions_username
            ON sessions(username)
        """)

        # 시스템 설정 테이블 (JWT SECRET_KEY 저장용)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        conn.commit()
        conn.close()

    # ==================== 관리자 계정 관리 ====================

    async def admin_exists(self) -> bool:
        """관리자 계정 존재 여부 확인"""
        def _check():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM admin")
            count = cursor.fetchone()[0]
            conn.close()
            return count > 0

        return await asyncio.to_thread(_check)

    async def create_admin(self, username: str, password_hash: str) -> bool:
        """관리자 계정 생성"""
        def _create():
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO admin (username, password, created_at) VALUES (?, ?, ?)",
                    (username, password_hash, datetime.utcnow().isoformat())
                )
                conn.commit()
                conn.close()
                return True
            except sqlite3.IntegrityError:
                return False

        return await asyncio.to_thread(_create)

    async def get_admin(self) -> Optional[Dict[str, str]]:
        """관리자 정보 조회"""
        def _get():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT username, password, created_at FROM admin LIMIT 1")
            row = cursor.fetchone()
            conn.close()

            if row:
                return {
                    "username": row["username"],
                    "password": row["password"],
                    "created_at": row["created_at"]
                }
            return None

        return await asyncio.to_thread(_get)

    # ==================== 세션 히스토리 관리 ====================

    async def append_history(self, session_id: str, data: str):
        """세션 히스토리 추가"""
        def _append():
            conn = self._get_connection()
            cursor = conn.cursor()

            # 새 청크 추가
            cursor.execute(
                "INSERT INTO session_history (session_id, chunk, timestamp) VALUES (?, ?, ?)",
                (session_id, data, datetime.utcnow().isoformat())
            )

            # 최근 10,000개만 유지 (오래된 것 삭제)
            cursor.execute("""
                DELETE FROM session_history
                WHERE session_id = ?
                AND id NOT IN (
                    SELECT id FROM session_history
                    WHERE session_id = ?
                    ORDER BY id DESC
                    LIMIT 10000
                )
            """, (session_id, session_id))

            conn.commit()
            conn.close()

        await asyncio.to_thread(_append)

    async def get_history(self, session_id: str) -> List[str]:
        """세션 히스토리 조회"""
        def _get():
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                "SELECT chunk FROM session_history WHERE session_id = ? ORDER BY id ASC",
                (session_id,)
            )
            rows = cursor.fetchall()
            conn.close()

            return [row["chunk"] for row in rows]

        return await asyncio.to_thread(_get)

    async def delete_history(self, session_id: str):
        """세션 히스토리 삭제"""
        def _delete():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM session_history WHERE session_id = ?", (session_id,))
            conn.commit()
            conn.close()

        await asyncio.to_thread(_delete)

    async def cleanup_old_sessions(self, older_than_hours: int = 24):
        """오래된 세션 정리"""
        def _cleanup():
            conn = self._get_connection()
            cursor = conn.cursor()

            # 24시간 이상 된 세션 삭제
            cutoff = datetime.utcnow().timestamp() - (older_than_hours * 3600)
            cutoff_iso = datetime.fromtimestamp(cutoff).isoformat()

            cursor.execute(
                "DELETE FROM session_history WHERE timestamp < ?",
                (cutoff_iso,)
            )

            deleted = cursor.rowcount
            conn.commit()
            conn.close()
            return deleted

        return await asyncio.to_thread(_cleanup)

    # ==================== 세션 관리 ====================

    async def create_session(self, session_id: str, username: str):
        """세션 생성"""
        def _create():
            conn = self._get_connection()
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat()
            cursor.execute(
                "INSERT OR REPLACE INTO sessions (session_id, username, created_at, last_active) VALUES (?, ?, ?, ?)",
                (session_id, username, now, now)
            )
            conn.commit()
            conn.close()

        await asyncio.to_thread(_create)

    async def get_user_sessions(self, username: str) -> List[Dict[str, str]]:
        """사용자의 세션 목록 조회"""
        def _get():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT session_id, created_at, last_active FROM sessions WHERE username = ? ORDER BY last_active DESC",
                (username,)
            )
            rows = cursor.fetchall()
            conn.close()

            return [
                {
                    "id": row["session_id"],
                    "created_at": row["created_at"],
                    "last_active": row["last_active"]
                }
                for row in rows
            ]

        return await asyncio.to_thread(_get)

    async def update_session_activity(self, session_id: str):
        """세션 마지막 활동 시간 업데이트"""
        def _update():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE sessions SET last_active = ? WHERE session_id = ?",
                (datetime.utcnow().isoformat(), session_id)
            )
            conn.commit()
            conn.close()

        await asyncio.to_thread(_update)

    async def delete_session(self, session_id: str):
        """세션 삭제"""
        def _delete():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM session_history WHERE session_id = ?", (session_id,))
            conn.commit()
            conn.close()

        await asyncio.to_thread(_delete)

    # ==================== 시스템 설정 관리 ====================

    async def get_config(self, key: str) -> Optional[str]:
        """시스템 설정 값 조회"""
        def _get():
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM system_config WHERE key = ?", (key,))
            row = cursor.fetchone()
            conn.close()
            return row["value"] if row else None

        return await asyncio.to_thread(_get)

    async def set_config(self, key: str, value: str) -> bool:
        """시스템 설정 값 저장"""
        def _set():
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO system_config (key, value, created_at) VALUES (?, ?, ?)",
                    (key, value, datetime.utcnow().isoformat())
                )
                conn.commit()
                conn.close()
                return True
            except Exception:
                return False

        return await asyncio.to_thread(_set)

    # ==================== 연결 관리 ====================

    async def connect(self):
        """연결 초기화 (호환성)"""
        pass

    async def close(self):
        """연결 종료 (호환성)"""
        pass


# 싱글톤 인스턴스
storage = SQLiteStorage()
