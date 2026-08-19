"""SFTP 연결 풀 + 경로 검증 + 전송 상한.

host_sftp / sftp_tailscale 이 공유한다. 연결은 host_id 기준으로 풀링해서
매 요청마다 SSH 핸드셰이크를 하지 않게 하고, idle TTL 이 지나면 닫는다.
"""
from __future__ import annotations

import asyncio
import time

import asyncssh

from host_manager import HostConnectError, open_connection

CONNECTION_IDLE_TTL = 300  # 5분
# 종료 시 풀 전체를 닫고 기다리는 상한(초). systemd TimeoutStopSec(15s) 안에서
# uvicorn graceful(5s) 뒤에 남는 몫을 넘지 않아야 한다.
POOL_CLOSE_TIMEOUT_SEC = 3
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10MB 읽기 상한
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024  # 원격 폴더 zip 안전 상한
MAX_DOWNLOAD_FILES = 10000
MAX_REMOTE_PATH_LEN = 4096

# 스트리밍 청크 — 너무 작으면 SFTP 왕복이 늘고, 너무 크면 메모리를 잡는다.
# asyncssh 기본 윈도우와 맞물려 256KB 부근이 실측상 무난하다.
CHUNK_BYTES = 256 * 1024

# host_id → (conn, last_used_ts)
_pool: dict[str, tuple[asyncssh.SSHClientConnection, float]] = {}
_pool_lock = asyncio.Lock()


async def get_or_open(host: dict, secrets: dict) -> asyncssh.SSHClientConnection:
    """풀에서 연결 꺼내거나 새로 연다. idle TTL 만료된 건 close 후 재연결."""
    host_id = host["id"]
    now = time.monotonic()
    async with _pool_lock:
        cached = _pool.get(host_id)
        if cached:
            conn, last = cached
            if (now - last) < CONNECTION_IDLE_TTL and not conn.is_closed():
                _pool[host_id] = (conn, now)
                return conn
            # 만료/닫힘 → 정리
            try:
                conn.close()
            except Exception:
                pass
            _pool.pop(host_id, None)

        conn = await open_connection(
            host,
            private_key=secrets.get("private_key"),
            passphrase=secrets.get("passphrase"),
            password=secrets.get("password"),
        )
        _pool[host_id] = (conn, now)
        return conn


def touch(host_id: str) -> None:
    """장시간 전송 중 idle 판정으로 회수되지 않게 last_used 를 갱신한다.

    대용량 업/다운로드는 `run()` 을 거치지 않아 아무도 타임스탬프를 올려주지 않는다 —
    5분 넘는 전송이 도중에 끊기던 원인이다.
    """
    cached = _pool.get(host_id)
    if cached:
        _pool[host_id] = (cached[0], time.monotonic())


def drop(host_id: str) -> None:
    cached = _pool.pop(host_id, None)
    if cached:
        try:
            cached[0].close()
        except Exception:
            pass


def validate_remote_path(path: str) -> str:
    """원격(SFTP) 경로 최소 검증. 널바이트 거부 + 길이 상한(defense-in-depth).

    원격 파일시스템은 절대경로 사용이 정상이라 절대경로 자체는 막지 않는다 —
    호스트 소유자가 이미 신뢰된 대상이므로 여기서는 명백히 잘못된 입력만 거른다.
    """
    if not isinstance(path, str) or not path.strip():
        raise HostConnectError("path is required")
    if "\x00" in path:
        raise HostConnectError("invalid path: null byte")
    if len(path) > MAX_REMOTE_PATH_LEN:
        raise HostConnectError(f"path too long (>{MAX_REMOTE_PATH_LEN} chars)")
    return path


async def close_pool() -> None:
    """앱 종료 시 모든 풀 연결 정리.

    ⚠️ `wait_closed()` 에 상한이 **반드시** 있어야 한다. 끊긴 망(꺼진 호스트·죽은
    터널)에서는 무한히 붙잡히는데, 이 함수는 lifespan 종료에서 불리므로 여기서
    막히면 uvicorn 의 timeout_graceful_shutdown 이 이미 지난 뒤다 — 즉 아무도 안
    구해주고 systemd 가 SIGKILL 한다. host_manager 의 CONN_CLOSE_TIMEOUT_SEC 이
    같은 이유로 존재한다.

    상한은 연결마다가 아니라 **전체**에 건다. 호스트 N 개가 전부 죽어 있으면
    직렬 대기가 N 배로 늘어나므로, 동시에 닫고 한 번만 기다린다.
    """
    async with _pool_lock:
        entries = list(_pool.values())
        _pool.clear()

    waiters = []
    for conn, _ in entries:
        try:
            conn.close()
            waiters.append(conn.wait_closed())
        except Exception:
            pass
    if not waiters:
        return
    try:
        await asyncio.wait_for(
            asyncio.gather(*waiters, return_exceptions=True),
            timeout=POOL_CLOSE_TIMEOUT_SEC,
        )
    except Exception:
        # TimeoutError 포함. close() 는 이미 걸었고 프로세스가 곧 죽으므로 회수는 OS 가 한다.
        pass
