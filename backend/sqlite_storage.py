"""
SQLite 저장소 — 사용자/세션 메타/시스템 설정만 보관

세션 출력 히스토리는 tmux 스크롤백이 담당하므로 여기서는 다루지 않는다.
"""
import os
import queue
import sqlite3
import threading

DEFAULT_DB_PATH = os.getenv("DB_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "iterminallist.db",
)

# 풀 크기 — WAL 은 동시 read 가능 / write 는 직렬화. 풀이 가득 차면 _get_connection 이
# 다음 반납까지 블로킹하므로(이벤트 루프 stall), 동시 폴링/탭복원이 겹치는 순간을 위해
# 10 으로 헤드룸을 둔다. SQLite 커넥션은 가벼워 메모리 부담 미미. 환경변수로 튠 가능.
_POOL_SIZE = int(os.getenv("SQLITE_POOL_SIZE", "10"))
# 풀이 빌 때까지 기다리는 상한. 정상 쿼리는 밀리초 단위라 여기 걸린다면 그건 경합이
# 아니라 **버그**다(반납 누락). 그럴 때 조용히 멈추는 대신 시끄럽게 실패해야 한다.
_POOL_WAIT_TIMEOUT = float(os.getenv("SQLITE_POOL_WAIT_SEC", "10"))


from db import schema
from db import admin
from db import sessions
from db import ssh_keys
from db import hosts
from db import user_prefs
from db import app_config
from db import usage
from db import llm_usage
from db import command_history
from db import passkeys
from db import snippets
from db import tools


class SQLiteStorage(
    # 도메인별 믹스인 — 구현은 db/ 아래 각 모듈이 소유한다. 호출부는 이 합성 덕분에
    # 예전 그대로 `storage.list_hosts(...)` 처럼 쓴다(호출부 200여 곳 무변경).
    schema.SchemaMixin,
    admin.AdminMixin,
    sessions.SessionMixin,
    ssh_keys.SshKeyMixin,
    hosts.HostMixin,
    user_prefs.UserPrefsMixin,
    app_config.AppConfigMixin,
    usage.UsageMixin,
    llm_usage.LlmUsageMixin,
    command_history.CommandHistoryMixin,
    passkeys.PasskeyMixin,
    snippets.SnippetMixin,
    tools.ToolMixin,
):
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
        # 풀이 가득 차고 모두 사용 중 — 다음 반납을 기다린다.
        #
        # ⚠️ **상한 없이 기다리지 않는다.** 반납을 빠뜨린 코드가 하나만 있어도(예:
        # `_release_connection` 대신 `conn.close()`) 슬롯이 영영 안 돌아오고, 그때
        # 무한 대기는 그것을 **조용한 전면 정지**로 키운다 — 이 호출은 to_thread 안에서
        # 돌아 실행기 스레드까지 잡아먹으므로 저장소를 쓰는 모든 요청이 함께 멈춘다
        # (2026-08-27 실제 사고: 종료 로그에 `Cancel 97 running task(s)`).
        #
        # 상한을 두면 같은 버그가 **시끄럽게** 드러난다. 이 저장소의 규칙 그대로 —
        # 끝나지 않는 대기를 두지 않는다.
        try:
            return self._pool.get(timeout=_POOL_WAIT_TIMEOUT)
        except queue.Empty as exc:
            raise RuntimeError(
                f"SQLite 연결 풀이 {_POOL_WAIT_TIMEOUT}초 동안 비어 있었습니다 — "
                "반납되지 않은 연결이 있는지 확인하세요(_release_connection)."
            ) from exc

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
