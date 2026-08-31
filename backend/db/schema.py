"""테이블 정의와 마이그레이션 — 스키마의 단일 진실 공급원.

부팅 때마다 idempotent 하게 돈다(CREATE TABLE IF NOT EXISTS / 컬럼 존재 확인 후 ADD).
DDL 이 코드와 섞여 있으면 "이 컬럼 언제 생겼나"를 추적할 수 없어서 따로 뺐다.
"""
from __future__ import annotations

import sqlite3


class SchemaMixin:
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
        # 마이그레이션: 자격증명 세대. (리모트·ITL 층과 함께 쓰이던 값 — 지금은 아무도
        # 읽지 않는다. 열은 남긴다: SQLite 에서 열 제거는 표 재작성이고, 비어 있는
        # 열 하나가 그 위험보다 싸다.) 이 호스트로 발급한 토큰이 이 값을
        # 청구로 달고 다니며, 검증 때 대조한다. 값을 올리면 **그 호스트 것만** 즉시 죽는다.
        # JWT 는 그냥은 폐기가 안 되므로(서버가 서명만 확인한다) 세대가 폐기 장치다.
        try:
            cursor.execute("ALTER TABLE hosts ADD COLUMN cred_epoch INTEGER NOT NULL DEFAULT 1")
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

        # LLM 사용량 누적 — 수집기가 읽어온 하루치를 **우리 DB 에 쌓는다.**
        #
        # 원본(에이전트 로그)은 영원하지 않다: Claude Code 는 오래된 프로젝트 로그를
        # 스스로 정리하고, 호스트를 폐기하면 그 이력은 통째로 사라진다. 매번 원본을
        # 다시 읽는 방식은 "지금 남아 있는 것" 만 볼 수 있다.
        #
        # PK 가 (사용자, 소스, 날짜, 에이전트, 모델, 프로젝트) 인 이유: 같은 날을 다시
        # 수집하면 그 날짜만 덮어써야 한다. INSERT 만 하면 하루에 두 번 갱신할 때마다
        # 사용량이 두 배가 된다.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_usage_daily (
                username TEXT NOT NULL,
                source_id TEXT NOT NULL,
                day TEXT NOT NULL,
                agent TEXT NOT NULL,
                model TEXT NOT NULL,
                project TEXT NOT NULL,
                input INTEGER NOT NULL DEFAULT 0,
                output INTEGER NOT NULL DEFAULT 0,
                cache_read INTEGER NOT NULL DEFAULT 0,
                cache_creation INTEGER NOT NULL DEFAULT 0,
                cost REAL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (username, source_id, day, agent, model, project)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_llm_daily_user_day ON llm_usage_daily(username, day)")

        # 세션 목록 — "최근 에이전트 세션" 카드용. 세션 하나가 여러 날에 걸칠 수 있어
        # 날짜가 아니라 세션 id 가 키다. 오래된 것은 정리한다(cleanup).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_usage_session (
                username TEXT NOT NULL,
                source_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                agent TEXT,
                model TEXT,
                project TEXT,
                cwd TEXT,
                title TEXT,
                last_activity TEXT,
                input INTEGER NOT NULL DEFAULT 0,
                output INTEGER NOT NULL DEFAULT 0,
                cache_read INTEGER NOT NULL DEFAULT 0,
                cache_creation INTEGER NOT NULL DEFAULT 0,
                cost REAL,
                PRIMARY KEY (username, source_id, session_id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_llm_sess_user_act ON llm_usage_session(username, last_activity DESC)")

        # 소스별 마지막 수집 결과 — 하루 한 번 제한과 "그 호스트는 왜 비었나" 를 함께 답한다.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS llm_usage_source (
                username TEXT NOT NULL,
                source_id TEXT NOT NULL,
                name TEXT,
                last_ok_at TEXT,
                last_try_at TEXT,
                last_error TEXT,
                PRIMARY KEY (username, source_id)
            )
        """)
        # 마이그레이션: 호스트가 삭제된 시각. 여기 값이 있으면 "은퇴한 소스" 다 —
        # 데이터는 보관 기간 동안 남겨두고, 지나면 자동으로 지운다. 호스트를 지웠다고
        # 지난달 비용까지 즉시 증발하면 그건 되돌릴 수 없는 손실이다.
        try:
            cursor.execute("ALTER TABLE llm_usage_source ADD COLUMN retired_at TEXT")
        except sqlite3.OperationalError:
            pass

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

        # 커맨드 스니펫 — 사용자별 저장 명령 목록. Ctrl+Shift+P 팔레트에서 검색·실행.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                command TEXT NOT NULL,
                tags TEXT DEFAULT '',
                sort_index INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_snippets_user ON snippets(username, sort_index)")

        # 설치 도구 — 사용자가 "이 호스트에 이걸 깔겠다" 고 적어 둔 명령.
        # 내장 목록(host_tools.BUILTIN_TOOLS)은 여기 넣지 않는다: 저장하면 사용자마다
        # 사본이 생겨 우리가 명령을 고쳐도 옛 사본이 남는다.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                url TEXT DEFAULT '',
                check_command TEXT DEFAULT '',
                install_command TEXT NOT NULL,
                sort_index INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tools_user ON tools(username, sort_index)")


        conn.commit()
        self._release_connection(conn)

    # -------- admin --------
