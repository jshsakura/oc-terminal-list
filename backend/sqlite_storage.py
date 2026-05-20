"""
SQLite 저장소 — 사용자/세션 메타/시스템 설정만 보관

세션 출력 히스토리는 tmux 스크롤백이 담당하므로 여기서는 다루지 않는다.
"""
import asyncio
import json
import os
import queue
import sqlite3
import threading
import time
from datetime import datetime

DEFAULT_DB_PATH = os.getenv("DB_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "iterminallist.db",
)

# 풀 크기 — WAL 은 동시 read 가능 / write 는 직렬화. 5 면 잦은 폴링 + 가끔 write 에
# 충분하고 더 키워도 의미 없음. 환경변수로 튠 가능.
_POOL_SIZE = int(os.getenv("SQLITE_POOL_SIZE", "5"))


class SQLiteStorage:
    """SQLite 기반 저장소 (admin / sessions / system_config).

    연결 풀: 매 쿼리 connect/close 의 setup 비용(파일 open + WAL 메타 + PRAGMA 적용)
    제거. 풀 크기 만큼 미리 열어두고 빌림/반납. asyncio.to_thread 가 ThreadPoolExecutor
    위에서 돌므로 check_same_thread=False 로 cross-thread 재사용 허용 (한 시점에
    한 스레드만 빌림 → cursor 경합 없음).
    """

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or DEFAULT_DB_PATH
        self._ensure_directory()
        self._pool: queue.Queue[sqlite3.Connection] = queue.Queue(maxsize=_POOL_SIZE)
        self._pool_lock = threading.Lock()
        self._pool_size = 0  # 현재 만들어진 총 conn 수 (in-use + idle)
        self._closed = False
        self._init_db()

    def _ensure_directory(self) -> None:
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

    def _make_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # WAL — 동시 읽기/쓰기 락 충돌 최소화. settings/tab-state 같은 debounced write 가
        # eviction polling 등 동시 read 와 부딪쳐 latency spike 내는 걸 막는다.
        # synchronous=NORMAL — WAL 모드에서 안전하면서 ~30% 빠름 (fsync 빈도 ↓).
        # busy_timeout — 락 잡혔을 때 즉시 죽지 않고 5s 까지 재시도.
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
        except sqlite3.OperationalError:
            pass  # 일부 PRAGMA 가 디스크/OS 제약으로 실패해도 작동은 계속.
        return conn

    def _get_connection(self) -> sqlite3.Connection:
        """풀에서 conn 을 빌린다. 풀이 비어있으면 만든다 (최대 _POOL_SIZE 까지)."""
        try:
            return self._pool.get_nowait()
        except queue.Empty:
            pass
        with self._pool_lock:
            if self._pool_size < _POOL_SIZE:
                conn = self._make_connection()
                self._pool_size += 1
                return conn
        # 풀이 가득 차고 모두 사용 중 — 다음 반납을 블로킹 대기.
        return self._pool.get()

    def _release_connection(self, conn: sqlite3.Connection) -> None:
        """conn 을 풀에 반납. 풀이 닫혔거나 풀이 가득 차면 실제로 close."""
        if self._closed:
            try:
                conn.close()
            except Exception:
                pass
            return
        try:
            self._pool.put_nowait(conn)
        except queue.Full:
            try:
                conn.close()
            except Exception:
                pass
            with self._pool_lock:
                self._pool_size = max(0, self._pool_size - 1)

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
        # 마이그레이션: 호스트별 기본 테마 — 연결 시 자동으로 pane.themeOverride 에 적용.
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN theme TEXT")
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

        # 사용 통계 — 세션 attach/detach 1건당 row 1개. 가벼운 이벤트 로그.
        # target_type: 'local' | 'host', target_id: 'local' 고정 또는 host_id.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usage_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                session_id TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                duration_seconds INTEGER
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_usage_user_start ON usage_sessions(username, started_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_usage_target ON usage_sessions(username, target_type, target_id)")

        # 명령 히스토리 — 사용자/터미널별 명령 모음. 디바이스 간 공유 (서버 영속).
        # 같은 (username, terminal_key, text) 중복은 updated_at 만 갱신 → 최신으로 승격.
        # 30일 이상된 row 는 별도 cleanup 작업이 삭제 (storage 클래스 메서드).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS command_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                terminal_key TEXT NOT NULL,
                text TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(username, terminal_key, text)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cmdhist_user_term_ts ON command_history(username, terminal_key, updated_at DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cmdhist_updated ON command_history(updated_at)")

        # 패스키 (WebAuthn) 자격증명 — 한 username 에 여러 디바이스 가능.
        # credential_id 는 unique (WebAuthn 표준). public_key 는 cbor 인코딩된 COSE key.
        # sign_count 는 재생 공격 방어용. transports 는 CSV (예: "internal,hybrid").
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS passkey_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                credential_id BLOB NOT NULL UNIQUE,
                public_key BLOB NOT NULL,
                sign_count INTEGER NOT NULL DEFAULT 0,
                transports TEXT,
                label TEXT,
                aaguid BLOB,
                backup_eligible INTEGER NOT NULL DEFAULT 0,
                backup_state INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_used_at TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_passkey_user ON passkey_credentials(username)")

        conn.commit()
        self._release_connection(conn)

    # -------- admin --------

    async def admin_exists(self) -> bool:
        def _check():
            conn = self._get_connection()
            try:
                count = conn.execute("SELECT COUNT(*) FROM admin").fetchone()[0]
                return count > 0
            finally:
                self._release_connection(conn)
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
                self._release_connection(conn)
        return await asyncio.to_thread(_create)

    async def get_admin(self) -> dict[str, str] | None:
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
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def set_admin_otp(self, username: str, secret_enc: str | None, enabled: bool) -> None:
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
                self._release_connection(conn)
        await asyncio.to_thread(_set)

    async def replace_backup_codes(self, username: str, code_hashes: list[str]) -> None:
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
                self._release_connection(conn)
        await asyncio.to_thread(_replace)

    async def list_unused_backup_codes(self, username: str) -> list[dict[str, str]]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, code_hash FROM admin_backup_codes WHERE username = ? AND used = 0",
                    (username,),
                ).fetchall()
                return [{"id": row["id"], "code_hash": row["code_hash"]} for row in rows]
            finally:
                self._release_connection(conn)
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
                self._release_connection(conn)
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
                self._release_connection(conn)
        return await asyncio.to_thread(_consume)

    async def clear_backup_codes(self, username: str) -> None:
        def _clear():
            conn = self._get_connection()
            try:
                conn.execute("DELETE FROM admin_backup_codes WHERE username = ?", (username,))
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_clear)

    # -------- sessions --------

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

    async def list_ssh_keys(self, username: str) -> list[dict]:
        def _get():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    "SELECT id, name, public_key, created_at FROM ssh_keys WHERE username = ? ORDER BY created_at DESC",
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_ssh_key(self, key_id: str, username: str) -> dict | None:
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT id, name, public_key, private_key_enc, passphrase_enc, created_at FROM ssh_keys WHERE id = ? AND username = ?",
                    (key_id, username),
                ).fetchone()
                return dict(row) if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def create_ssh_key(
        self,
        key_id: str,
        username: str,
        name: str,
        public_key: str | None,
        private_key_enc: str,
        passphrase_enc: str | None,
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
                self._release_connection(conn)
        await asyncio.to_thread(_create)

    async def update_ssh_key(
        self,
        key_id: str,
        username: str,
        name: str | None = None,
        public_key: str | None = None,
        private_key_enc: str | None = None,
        passphrase_enc: str | None = None,
        clear_passphrase: bool = False,
    ) -> bool:
        """필드별 부분 업데이트. None 은 미변경, clear_passphrase=True 면 passphrase 제거."""
        def _update():
            sets = []
            params: list = []
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
                self._release_connection(conn)
        return await asyncio.to_thread(_update)

    async def delete_ssh_key(self, key_id: str, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute("DELETE FROM ssh_keys WHERE id = ? AND username = ?", (key_id, username))
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- hosts --------

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
                              remote_tmux_session, start_path, last_cwd, icon, theme, created_at, last_used
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

    async def get_user_settings(self, username: str) -> dict | None:
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
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def save_user_settings(self, username: str, settings: dict) -> None:
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
                self._release_connection(conn)
        await asyncio.to_thread(_save)

    # -------- tab state (탭 순서/레이아웃 전체 — 기기 간 완전 복원) --------

    async def get_tab_state(self, username: str) -> dict | None:
        """저장된 탭 전체 상태. 없으면 None.
        updatedAt 은 다른 기기에서의 변경 감지를 위한 ETag 역할.
        """
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT tabs_json, active_tab_id, updated_at FROM tab_state WHERE username = ?",
                    (username,),
                ).fetchone()
                if not row:
                    return None
                try:
                    return {
                        "tabs": json.loads(row["tabs_json"]),
                        "activeTabId": row["active_tab_id"],
                        "updatedAt": row["updated_at"],
                    }
                except (TypeError, ValueError):
                    return None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_tab_state_updated_at(self, username: str) -> str | None:
        """탭 상태의 마지막 수정 시각만 가볍게 조회 (폴링용)."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT updated_at FROM tab_state WHERE username = ?",
                    (username,),
                ).fetchone()
                return row["updated_at"] if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def save_tab_state(self, username: str, tabs: list, active_tab_id: str | None) -> str:
        """탭 전체 상태 upsert. 새 updated_at 을 반환 — 호출자가 자기 변경의 버전을 기억하게."""
        tabs_json = json.dumps(tabs, ensure_ascii=False)
        new_updated_at = datetime.utcnow().isoformat()
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO tab_state (username, tabs_json, active_tab_id, updated_at) VALUES (?, ?, ?, ?)",
                    (username, tabs_json, active_tab_id, new_updated_at),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_save)
        return new_updated_at

    # -------- system config --------

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

    async def record_usage_start(
        self,
        username: str,
        target_type: str,
        target_id: str,
        session_id: str | None = None,
    ) -> int | None:
        """세션 attach 시점 row 생성. 반환된 event_id 를 record_usage_end 에 전달."""
        started_at = datetime.utcnow().isoformat()
        def _insert():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    """
                    INSERT INTO usage_sessions
                        (username, target_type, target_id, session_id, started_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (username, target_type, target_id, session_id, started_at),
                )
                conn.commit()
                return int(cur.lastrowid)
            except Exception:
                return None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_insert)

    async def record_usage_end(self, event_id: int) -> None:
        """detach 시점 — duration 계산해서 update. id 가 None 이면 no-op."""
        if not event_id:
            return
        ended_at = datetime.utcnow().isoformat()
        def _update():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT started_at FROM usage_sessions WHERE id = ?",
                    (event_id,),
                ).fetchone()
                if not row:
                    return
                try:
                    started = datetime.fromisoformat(row["started_at"])
                    delta = (datetime.fromisoformat(ended_at) - started).total_seconds()
                    duration = max(0, int(delta))
                except (TypeError, ValueError):
                    duration = None
                conn.execute(
                    "UPDATE usage_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?",
                    (ended_at, duration, event_id),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def close_orphan_usage_sessions(self) -> int:
        """서버 재시작 시 ended_at 가 비어있는 모든 row 를 닫는다.
        Duration 은 started_at 기준으로 계산하지만, 부정확할 수 있어 NULL 로 표시."""
        ended_at = datetime.utcnow().isoformat()
        def _close():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "UPDATE usage_sessions SET ended_at = ? WHERE ended_at IS NULL",
                    (ended_at,),
                )
                conn.commit()
                return int(cur.rowcount or 0)
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_close)

    async def get_usage_summary(self, username: str, days: int = 7) -> dict:
        """최근 N일 사용 통계 집계.

        반환 구조:
          {
            "window_days": 7,
            "total_seconds": int, "session_count": int, "active_targets": int,
            "by_target": [{ target_type, target_id, total_seconds, session_count, last_used }, ...],
            "by_type": { "local": int_seconds, "host": int_seconds },
            "avg_session_seconds": int,
          }

        ended_at NULL row 도 (지금 진행중) 포함시켜 started_at 기준으로 계산.
        """
        window = max(1, min(int(days or 7), 365))
        cutoff = datetime.utcnow().timestamp() - window * 86400

        def _query():
            conn = self._get_connection()
            try:
                # 모든 윈도우 내 row 조회 — 라이브 row 포함 (ended_at IS NULL 도 잡음)
                rows = conn.execute(
                    """
                    SELECT target_type, target_id, started_at, ended_at, duration_seconds
                    FROM usage_sessions
                    WHERE username = ?
                    ORDER BY started_at DESC
                    """,
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                self._release_connection(conn)

        rows = await asyncio.to_thread(_query)
        now_ts = datetime.utcnow().timestamp()
        total_seconds = 0
        session_count = 0
        by_type: dict[str, int] = {"local": 0, "host": 0}
        by_target_acc: dict[tuple[str, str], dict] = {}

        for r in rows:
            try:
                started_ts = datetime.fromisoformat(r["started_at"]).timestamp()
            except (TypeError, ValueError):
                continue
            if started_ts < cutoff:
                continue
            # duration: ended_at 있으면 그 값, 없으면 now - started
            dur = r.get("duration_seconds")
            if dur is None:
                if r.get("ended_at"):
                    try:
                        dur = int(
                            (datetime.fromisoformat(r["ended_at"]).timestamp() - started_ts)
                        )
                    except (TypeError, ValueError):
                        dur = 0
                else:
                    dur = int(now_ts - started_ts)
            dur = max(0, int(dur or 0))
            total_seconds += dur
            session_count += 1
            ttype = r["target_type"] or "host"
            if ttype not in by_type:
                by_type[ttype] = 0
            by_type[ttype] += dur
            key = (ttype, r["target_id"] or "")
            slot = by_target_acc.setdefault(
                key,
                {
                    "target_type": ttype,
                    "target_id": r["target_id"] or "",
                    "total_seconds": 0,
                    "session_count": 0,
                    "last_used": r["started_at"],
                },
            )
            slot["total_seconds"] += dur
            slot["session_count"] += 1
            if (slot["last_used"] or "") < (r["started_at"] or ""):
                slot["last_used"] = r["started_at"]

        by_target = sorted(
            by_target_acc.values(),
            key=lambda x: x["total_seconds"],
            reverse=True,
        )
        avg = int(total_seconds / session_count) if session_count else 0
        return {
            "window_days": window,
            "total_seconds": total_seconds,
            "session_count": session_count,
            "active_targets": len(by_target_acc),
            "by_target": by_target,
            "by_type": by_type,
            "avg_session_seconds": avg,
        }

    # -------- command history (터미널별 명령 히스토리) --------

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

    async def add_passkey_credential(
        self,
        username: str,
        credential_id: bytes,
        public_key: bytes,
        sign_count: int,
        transports: list[str] | None = None,
        label: str | None = None,
        aaguid: bytes | None = None,
        backup_eligible: bool = False,
        backup_state: bool = False,
    ) -> int:
        transports_csv = ",".join(transports) if transports else None
        now = datetime.utcnow().isoformat()
        def _add():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    """
                    INSERT INTO passkey_credentials
                    (username, credential_id, public_key, sign_count, transports, label,
                     aaguid, backup_eligible, backup_state, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        username, credential_id, public_key, int(sign_count),
                        transports_csv, label, aaguid,
                        1 if backup_eligible else 0,
                        1 if backup_state else 0,
                        now,
                    ),
                )
                conn.commit()
                return cur.lastrowid
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_add)

    async def list_passkey_credentials(self, username: str) -> list[dict]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    """
                    SELECT id, credential_id, sign_count, transports, label, aaguid,
                           backup_eligible, backup_state, created_at, last_used_at
                    FROM passkey_credentials
                    WHERE username = ?
                    ORDER BY created_at DESC
                    """,
                    (username,),
                ).fetchall()
                return [
                    {
                        "id": r["id"],
                        "credential_id": bytes(r["credential_id"]),
                        "sign_count": int(r["sign_count"]),
                        "transports": (r["transports"] or "").split(",") if r["transports"] else [],
                        "label": r["label"],
                        "aaguid": bytes(r["aaguid"]) if r["aaguid"] else None,
                        "backup_eligible": bool(r["backup_eligible"]),
                        "backup_state": bool(r["backup_state"]),
                        "created_at": r["created_at"],
                        "last_used_at": r["last_used_at"],
                    }
                    for r in rows
                ]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def get_passkey_credential(self, credential_id: bytes) -> dict | None:
        """username 무관 조회 — passkey 로그인은 username-less 로 들어올 수도 있다."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    """
                    SELECT id, username, credential_id, public_key, sign_count, transports,
                           backup_eligible, backup_state
                    FROM passkey_credentials WHERE credential_id = ?
                    """,
                    (credential_id,),
                ).fetchone()
                if not row:
                    return None
                return {
                    "id": row["id"],
                    "username": row["username"],
                    "credential_id": bytes(row["credential_id"]),
                    "public_key": bytes(row["public_key"]),
                    "sign_count": int(row["sign_count"]),
                    "transports": (row["transports"] or "").split(",") if row["transports"] else [],
                    "backup_eligible": bool(row["backup_eligible"]),
                    "backup_state": bool(row["backup_state"]),
                }
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def update_passkey_after_use(
        self, credential_id: bytes, sign_count: int, backup_state: bool | None = None,
    ) -> None:
        now = datetime.utcnow().isoformat()
        def _update():
            conn = self._get_connection()
            try:
                if backup_state is None:
                    conn.execute(
                        "UPDATE passkey_credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ?",
                        (int(sign_count), now, credential_id),
                    )
                else:
                    conn.execute(
                        "UPDATE passkey_credentials SET sign_count = ?, backup_state = ?, last_used_at = ? WHERE credential_id = ?",
                        (int(sign_count), 1 if backup_state else 0, now, credential_id),
                    )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def rename_passkey_credential(self, row_id: int, username: str, label: str) -> bool:
        def _rename():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "UPDATE passkey_credentials SET label = ? WHERE id = ? AND username = ?",
                    (label, row_id, username),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_rename)

    async def delete_passkey_credential(self, row_id: int, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM passkey_credentials WHERE id = ? AND username = ?",
                    (row_id, username),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- lifecycle --------

    async def connect(self) -> None:
        """no-op (호환성 유지)"""
        return

    async def close(self) -> None:
        """풀에 남은 모든 idle conn close. 서비스 종료 시 호출."""
        self._closed = True
        drained: list[sqlite3.Connection] = []
        while True:
            try:
                drained.append(self._pool.get_nowait())
            except queue.Empty:
                break
        for conn in drained:
            try:
                conn.close()
            except Exception:
                pass


storage = SQLiteStorage()
