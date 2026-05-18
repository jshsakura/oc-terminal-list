"""
SSH 연결 풀 — host_id 당 asyncssh.SSHClientConnection 1개 재사용.

호스트당 매 요청마다 SSH handshake (200~500ms TLS+auth) 하던 걸 없앤다.
asyncssh 의 conn 은 thread/concurrent channel-safe 라 여러 coroutine 이 동시에 .run() 가능.
연결이 끊어지면 lazy 재생성 + 1회 retry.

API:
    await ssh_pool.run(host_id, opener, cmd, **kwargs)  # 실행 + auto retry
    await ssh_pool.get(host_id, opener)                 # raw conn 필요할 때
    await ssh_pool.invalidate(host_id)                  # 강제 무효화 (kill-tmux 등)
    await ssh_pool.close_all()                          # 앱 종료 시
    await ssh_pool.start_janitor(idle_timeout=300)      # idle 청소 background task
"""
import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

_DEFAULT_IDLE = 300.0  # 5min


class _Pool:
    def __init__(self) -> None:
        self._entries: dict[str, dict] = {}  # host_id -> {conn, last_used, lock}
        self._global_lock = asyncio.Lock()
        self._janitor_task: Optional[asyncio.Task] = None
        self._idle_timeout = _DEFAULT_IDLE

    async def _get_or_create_entry_lock(self, host_id: str) -> asyncio.Lock:
        async with self._global_lock:
            entry = self._entries.get(host_id)
            if entry is None:
                entry = {"conn": None, "last_used": 0.0, "lock": asyncio.Lock()}
                self._entries[host_id] = entry
            return entry["lock"]

    def _conn_alive(self, conn: Any) -> bool:
        if conn is None:
            return False
        try:
            # asyncssh.SSHClientConnection 은 is_closing() 제공.
            if hasattr(conn, "is_closing") and conn.is_closing():
                return False
            return True
        except Exception:
            return False

    async def get(self, host_id: str, opener: Callable[[], Awaitable[Any]]) -> Any:
        entry_lock = await self._get_or_create_entry_lock(host_id)
        async with entry_lock:
            entry = self._entries[host_id]
            conn = entry["conn"]
            if self._conn_alive(conn):
                entry["last_used"] = time.monotonic()
                return conn
            # 죽었거나 없음 — close 후 새로 생성
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            new_conn = await opener()
            entry["conn"] = new_conn
            entry["last_used"] = time.monotonic()
            return new_conn

    async def run(self, host_id: str, opener: Callable[[], Awaitable[Any]], cmd: str, **kwargs) -> Any:
        """conn.run(cmd) 한 번 시도 → 실패 시 invalidate + 1회 재시도."""
        for attempt in range(2):
            conn = await self.get(host_id, opener)
            try:
                return await conn.run(cmd, **kwargs)
            except Exception as e:
                if attempt == 0:
                    logger.debug("ssh_pool: conn died for host=%s, retrying once (%s)", host_id, e)
                    await self.invalidate(host_id)
                    continue
                raise

    async def invalidate(self, host_id: str) -> None:
        async with self._global_lock:
            entry = self._entries.pop(host_id, None)
        if entry and entry["conn"] is not None:
            try:
                entry["conn"].close()
                await entry["conn"].wait_closed()
            except Exception:
                pass

    async def close_all(self) -> None:
        async with self._global_lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            if entry["conn"] is not None:
                try:
                    entry["conn"].close()
                except Exception:
                    pass

    async def _janitor_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(60)
                now = time.monotonic()
                to_close: list[tuple[str, Any]] = []
                async with self._global_lock:
                    for host_id, entry in list(self._entries.items()):
                        if entry["conn"] is None:
                            continue
                        if now - entry["last_used"] > self._idle_timeout:
                            to_close.append((host_id, entry["conn"]))
                            entry["conn"] = None
                for host_id, conn in to_close:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    logger.debug("ssh_pool: closed idle conn host=%s", host_id)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("ssh_pool janitor error: %s", e)

    def start_janitor(self, idle_timeout: float = _DEFAULT_IDLE) -> None:
        self._idle_timeout = idle_timeout
        if self._janitor_task is None or self._janitor_task.done():
            self._janitor_task = asyncio.create_task(self._janitor_loop())

    def stop_janitor(self) -> None:
        if self._janitor_task and not self._janitor_task.done():
            self._janitor_task.cancel()


ssh_pool = _Pool()
