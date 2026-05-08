"""
SQLite 저장소 — 사용자/세션 메타/시스템 설정만 보관

세션 출력 히스토리는 tmux 스크롤백이 담당하므로 여기서는 다루지 않는다.
"""
import asyncio
import json
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
                created_at TEXT NOT NULL,
                otp_secret_enc TEXT,
                otp_enabled INTEGER NOT NULL DEFAULT 0,
                otp_enabled_at TEXT
            )
        """)
        # 마이그레이션: 기존 admin 테이블에 OTP 컬럼 없으면 추가
        cursor.execute("PRAGMA table_info(admin)")
        admin_cols = {row[1] for row in cursor.fetchall()}
        if "otp_secret_enc" not in admin_cols:
            cursor.execute("ALTER TABLE admin ADD COLUMN otp_secret_enc TEXT")
        if "otp_enabled" not in admin_cols:
            cursor.execute("ALTER TABLE admin ADD COLUMN otp_enabled INTEGER NOT NULL DEFAULT 0")
        if "otp_enabled_at" not in admin_cols:
            cursor.execute("ALTER TABLE admin ADD COLUMN otp_enabled_at TEXT")

        # 일회용 백업 코드 (bcrypt 해시로만 저장 — 평문은 발급 시점에만 노출)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin_backup_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                used_at TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON admin_backup_codes(username)")

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

        # SSH 키 (개인키는 vault 암호화 후 보관)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                public_key TEXT,
                private_key_enc TEXT NOT NULL,
                passphrase_enc TEXT,
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON ssh_keys(username)")

        # SSH 호스트 (즐겨찾기)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                hostname TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                ssh_user TEXT NOT NULL,
                auth_method TEXT NOT NULL DEFAULT 'key',
                key_id TEXT,
                password_enc TEXT,
                color_index INTEGER DEFAULT 0,
                group_name TEXT,
                use_remote_tmux INTEGER DEFAULT 1,
                remote_tmux_session TEXT DEFAULT 'mobile',
                start_path TEXT,
                last_cwd TEXT,
                icon TEXT,
                created_at TEXT NOT NULL,
                last_used TEXT,
                FOREIGN KEY (key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts(username)")
        # 마이그레이션: 기존 hosts 테이블에 start_path 컬럼 없으면 추가
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN start_path TEXT")
        except sqlite3.OperationalError:
            pass
        # 마이그레이션: 기존 hosts 테이블에 icon 컬럼 없으면 추가
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN icon TEXT")
        except sqlite3.OperationalError:
            pass
        # 마이그레이션: 호스트 마지막 cwd (브라우저로 폴더 골라 들어간 경로 — start_path 보다 우선)
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN last_cwd TEXT")
        except sqlite3.OperationalError:
            pass
        # 마이그레이션: 사용자 정의 정렬 순서 (DnD 결과 영속). NULL 이면 last_used 폴백.
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN sort_index INTEGER")
        except sqlite3.OperationalError:
            pass

        # 사용자별 UI 설정 — 단일 JSON blob 으로 모두 보관 (테마, 폰트 등)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                username TEXT PRIMARY KEY,
                settings_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # 탭 레이아웃 전체 상태 — 기기 간 완전한 탭 복원을 위해 서버에 영속
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tab_state (
                username TEXT PRIMARY KEY,
                tabs_json TEXT NOT NULL,
                active_tab_id TEXT,
                updated_at TEXT NOT NULL
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
                    "SELECT username, password, created_at, otp_secret_enc, otp_enabled, otp_enabled_at FROM admin LIMIT 1"
                ).fetchone()
                if not row:
                    return None
                return {
                    "username": row["username"],
                    "password": row["password"],
                    "created_at": row["created_at"],
                    "otp_secret_enc": row["otp_secret_enc"],
                    "otp_enabled": bool(row["otp_enabled"]),
                    "otp_enabled_at": row["otp_enabled_at"],
                }
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def set_admin_otp(self, username: str, secret_enc: Optional[str], enabled: bool) -> None:
        def _set():
            conn = self._get_connection()
            try:
                enabled_at = datetime.utcnow().isoformat() if enabled else None
                conn.execute(
                    "UPDATE admin SET otp_secret_enc = ?, otp_enabled = ?, otp_enabled_at = ? WHERE username = ?",
                    (secret_enc, 1 if enabled else 0, enabled_at, username),
                )
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_set)

    async def replace_backup_codes(self, username: str, code_hashes: List[str]) -> None:
        """기존 코드 모두 삭제하고 새 코드로 교체."""
        def _replace():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM admin_backup_codes WHERE username = ?", (username,))
                now = datetime.utcnow().isoformat()
                conn.executemany(
                    "INSERT INTO admin_backup_codes (username, code_hash, used, created_at) VALUES (?, ?, 0, ?)",
                    [(username, h, now) for h in code_hashes],
                )
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_replace)

    async def list_unused_backup_codes(self, username: str) -> List[Dict[str, str]]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, code_hash FROM admin_backup_codes WHERE username = ? AND used = 0",
                    (username,),
                ).fetchall()
                return [{"id": row["id"], "code_hash": row["code_hash"]} for row in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_list)

    async def count_unused_backup_codes(self, username: str) -> int:
        def _count():
            conn = self._get_connection()
            try:
                return conn.execute(
                    "SELECT COUNT(*) FROM admin_backup_codes WHERE username = ? AND used = 0",
                    (username,),
                ).fetchone()[0]
            finally:
                conn.close()
        return await asyncio.to_thread(_count)

    async def consume_backup_code(self, code_id: int) -> bool:
        def _consume():
            conn = self._get_connection()
            try:
                now = datetime.utcnow().isoformat()
                cur = conn.execute(
                    "UPDATE admin_backup_codes SET used = 1, used_at = ? WHERE id = ? AND used = 0",
                    (now, code_id),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_consume)

    async def clear_backup_codes(self, username: str) -> None:
        def _clear():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM admin_backup_codes WHERE username = ?", (username,))
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_clear)

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

    # -------- ssh keys --------

    async def list_ssh_keys(self, username: str) -> List[Dict]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, name, public_key, created_at FROM ssh_keys WHERE username = ? ORDER BY created_at DESC",
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def get_ssh_key(self, key_id: str, username: str) -> Optional[Dict]:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT id, name, public_key, private_key_enc, passphrase_enc, created_at FROM ssh_keys WHERE id = ? AND username = ?",
                    (key_id, username),
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def create_ssh_key(
        self,
        key_id: str,
        username: str,
        name: str,
        public_key: Optional[str],
        private_key_enc: str,
        passphrase_enc: Optional[str],
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
                conn.close()
        await asyncio.to_thread(_create)

    async def update_ssh_key(
        self,
        key_id: str,
        username: str,
        name: Optional[str] = None,
        public_key: Optional[str] = None,
        private_key_enc: Optional[str] = None,
        passphrase_enc: Optional[str] = None,
        clear_passphrase: bool = False,
    ) -> bool:
        """필드별 부분 업데이트. None 은 미변경, clear_passphrase=True 면 passphrase 제거."""
        def _update():
            sets = []
            params: List = []
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
                conn.close()
        return await asyncio.to_thread(_update)

    async def delete_ssh_key(self, key_id: str, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM ssh_keys WHERE id = ? AND username = ?", (key_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_delete)

    # -------- hosts --------

    async def list_hosts(self, username: str) -> List[Dict]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    """SELECT id, name, hostname, port, ssh_user, auth_method, key_id,
                              color_index, group_name, use_remote_tmux, remote_tmux_session,
                              start_path, last_cwd, icon, sort_index, created_at, last_used
                       FROM hosts WHERE username = ?
                       ORDER BY sort_index IS NULL, sort_index ASC,
                                group_name NULLS LAST, last_used DESC, name ASC""",
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def get_host(self, host_id: str, username: str) -> Optional[Dict]:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    """SELECT id, name, hostname, port, ssh_user, auth_method, key_id,
                              password_enc, color_index, group_name, use_remote_tmux,
                              remote_tmux_session, start_path, last_cwd, icon, created_at, last_used
                       FROM hosts WHERE id = ? AND username = ?""",
                    (host_id, username),
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def upsert_host(self, host_id: str, username: str, **fields) -> None:
        """호스트 생성/수정. fields 에 들어있는 키만 갱신 (PATCH 시맨틱)."""
        allowed = {
            "name", "hostname", "port", "ssh_user", "auth_method", "key_id",
            "password_enc", "color_index", "group_name", "use_remote_tmux",
            "remote_tmux_session", "start_path", "icon",
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
                                              start_path, icon, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                            now,
                        ),
                    )
                conn.commit()
            finally:
                conn.close()
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
                conn.close()
        await asyncio.to_thread(_touch)

    async def reorder_hosts(self, username: str, ids: List[str]) -> None:
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
                conn.close()
        await asyncio.to_thread(_reorder)

    async def update_host_last_cwd(self, host_id: str, username: str, cwd: Optional[str]) -> None:
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
                conn.close()
        await asyncio.to_thread(_update)

    async def delete_host(self, host_id: str, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM hosts WHERE id = ? AND username = ?", (host_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()
        return await asyncio.to_thread(_delete)

    # -------- user settings (UI 환경설정 — 테마/폰트 등) --------

    async def get_user_settings(self, username: str) -> Optional[Dict]:
        """사용자의 저장된 UI 설정. 없으면 None."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT settings_json FROM user_settings WHERE username = ?", (username,)
                ).fetchone()
                if not row:
                    return None
                try:
                    return json.loads(row["settings_json"])
                except (TypeError, ValueError):
                    return None
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def save_user_settings(self, username: str, settings: Dict) -> None:
        """사용자 설정 upsert. 단일 JSON blob 으로 보관."""
        payload = json.dumps(settings, ensure_ascii=False)
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO user_settings (username, settings_json, updated_at) VALUES (?, ?, ?)",
                    (username, payload, datetime.utcnow().isoformat()),
                )
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_save)

    # -------- tab state (탭 순서/레이아웃 전체 — 기기 간 완전 복원) --------

    async def get_tab_state(self, username: str) -> Optional[Dict]:
        """저장된 탭 전체 상태. 없으면 None."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT tabs_json, active_tab_id FROM tab_state WHERE username = ?",
                    (username,),
                ).fetchone()
                if not row:
                    return None
                try:
                    return {
                        "tabs": json.loads(row["tabs_json"]),
                        "activeTabId": row["active_tab_id"],
                    }
                except (TypeError, ValueError):
                    return None
            finally:
                conn.close()
        return await asyncio.to_thread(_get)

    async def save_tab_state(self, username: str, tabs: list, active_tab_id: Optional[str]) -> None:
        """탭 전체 상태 upsert."""
        tabs_json = json.dumps(tabs, ensure_ascii=False)
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO tab_state (username, tabs_json, active_tab_id, updated_at) VALUES (?, ?, ?, ?)",
                    (username, tabs_json, active_tab_id, datetime.utcnow().isoformat()),
                )
                conn.commit()
            finally:
                conn.close()
        await asyncio.to_thread(_save)

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
