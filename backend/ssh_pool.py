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
import os
import time
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

_DEFAULT_IDLE = 300.0  # 5min

# ⚠️ **상한 없는 대기를 두지 않는다** — 이 저장소가 종료·SFTP 풀·원격 브리지에서 이미
# 정한 규칙인데 이 풀만 빠져 있었다(2026-08-27 사고).
#
# 특히 위험한 자리는 `get()` 이다: **per-host 잠금을 쥔 채** opener 를 기다리므로, 거기서
# 멈추면 그 호스트로 가는 **모든 후속 요청이 잠금 뒤에 쌓인다.** 홈 화면의 tmux 세션
# 폴링이 그 호스트를 주기적으로 두드리니 폴링마다 태스크가 하나씩 영구히 늘어난다.
#
# 그리고 멈춤은 **예외가 아니라서** 실패 캐시에도 안 걸린다 — 캐시는 예외에만 반응한다.
# 상한을 두면 멈춤이 예외가 되고, 그 순간 캐시가 받아 다음 폴링을 막는다.
_CONNECT_TIMEOUT = float(os.getenv("SSH_POOL_CONNECT_SEC", "20"))
# 이 풀을 쓰는 명령은 전부 짧다(tmux list-sessions, ss). 긴 작업은 run_remote_cmd 를 쓴다.
_COMMAND_TIMEOUT = float(os.getenv("SSH_POOL_COMMAND_SEC", "20"))
# 끊긴 망에서 wait_closed() 는 안 돌아올 수 있다(host_manager 와 같은 값).
_CLOSE_TIMEOUT = 5.0


async def _close_bounded(conn) -> None:
    """연결을 닫되 **정리를 기다리다 매달리지 않는다.** 끊긴 망에서 `wait_closed()` 는
    돌아오지 않을 수 있다(host_manager 가 같은 상한을 갖는 이유)."""
    try:
        conn.close()
        await asyncio.wait_for(conn.wait_closed(), timeout=_CLOSE_TIMEOUT)
    except Exception as e:
        logger.debug("ssh_pool: close bounded (%s)", e)


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
            try:
                new_conn = await asyncio.wait_for(opener(), timeout=_CONNECT_TIMEOUT)
            except TimeoutError as exc:
                # 잠금은 이 블록을 나가며 풀린다. 항목도 지워 다음 시도가 깨끗하게 시작하게.
                entry["conn"] = None
                # ⚠️ **경고로 남긴다.** 이 사고는 조용해서 오래갔다 — 요청이 잠금 뒤에
                # 쌓이는 동안 로그에는 아무것도 안 찍혔고, 종료할 때의
                # `Cancel N running task(s)` 로만 뒤늦게 드러났다.
                logger.warning(
                    "ssh_pool: connect timed out after %ss host=%s — 이 호스트로 가는 "
                    "요청이 쌓이지 않도록 포기합니다", _CONNECT_TIMEOUT, host_id,
                )
                raise ConnectionError(
                    f"SSH 연결이 {_CONNECT_TIMEOUT}초 안에 열리지 않았습니다: {host_id}"
                ) from exc
            entry["conn"] = new_conn
            entry["last_used"] = time.monotonic()
            return new_conn

    async def run(self, host_id: str, opener: Callable[[], Awaitable[Any]], cmd: str, **kwargs) -> Any:
        """conn.run(cmd) 한 번 시도 → 실패 시 invalidate + 1회 재시도."""
        for attempt in range(2):
            conn = await self.get(host_id, opener)
            try:
                # ⚠️ 반쯤 죽은 연결에서 `conn.run` 은 오지 않을 답을 기다린다. keepalive 가
                # 결국 끊어 주지만(60s) 그 사이의 대기가 그대로 쌓인다.
                return await asyncio.wait_for(conn.run(cmd, **kwargs), timeout=_COMMAND_TIMEOUT)
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
            await _close_bounded(entry["conn"])

    async def close_all(self) -> None:
        async with self._global_lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            if entry["conn"] is not None:
                await _close_bounded(entry["conn"])

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
