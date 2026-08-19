"""종료 경로에는 상한이 있어야 한다 — 없으면 systemd 가 SIGKILL 한다.

`KillMode=process` 라 tmux 세션은 어느 쪽이든 살아남지만, SIGKILL 이 오면 lifespan 의
정리(SQLite close, SSH/SFTP 풀 정리)가 통째로 건너뛰어진다. 실측(7일): 재시작 23회 중
**13회**가 `stop-sigterm timed out → SIGKILL` 이었고, 그때마다 uvicorn 로그가
"Waiting for connections to close" 에서 멈춰 있었다.

두 겹으로 막는다:
1. uvicorn `timeout_graceful_shutdown` — 멈춘 피어에 물린 WS 를 강제로 끊는다.
2. `sftp_pool.close_pool` 의 `wait_closed` 상한 — 이건 lifespan **안**이라 1번 뒤에
   돌고, 여기서 막히면 아무도 안 구해준다.
"""
from __future__ import annotations

import asyncio

import pytest

import sftp_pool


class _DeadConn:
    """끊긴 망의 asyncssh 연결 — close() 는 돌아오지만 wait_closed() 는 안 돌아온다."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        await asyncio.sleep(3600)


@pytest.mark.asyncio
async def test_close_pool_gives_up_instead_of_hanging(monkeypatch):
    monkeypatch.setattr(sftp_pool, "POOL_CLOSE_TIMEOUT_SEC", 0.05)
    conns = [_DeadConn() for _ in range(3)]
    sftp_pool._pool.clear()
    for i, c in enumerate(conns):
        sftp_pool._pool[f"h{i}"] = (c, 0.0)

    loop = asyncio.get_running_loop()
    started = loop.time()
    await asyncio.wait_for(sftp_pool.close_pool(), timeout=2)
    elapsed = loop.time() - started

    # 호스트마다 상한을 걸면 N 배가 된다 — 전체에 한 번만 걸어야 한다.
    assert elapsed < 0.5, f"{elapsed:.2f}s 걸렸다 — 연결마다 따로 기다리고 있다"
    assert all(c.closed for c in conns), "포기하더라도 close() 는 걸어야 한다"
    assert sftp_pool._pool == {}


@pytest.mark.asyncio
async def test_close_pool_is_fine_when_empty():
    sftp_pool._pool.clear()
    await asyncio.wait_for(sftp_pool.close_pool(), timeout=1)


def test_uvicorn_shutdown_has_a_deadline_that_fits_inside_systemds():
    """상한 두 개는 같이 움직인다 — graceful 이 TimeoutStopSec 를 넘으면 의미가 없다.

    deploy/iterminallist.service 의 TimeoutStopSec=15s 안에서
    uvicorn graceful + lifespan 정리(SFTP 풀 등)가 모두 끝나야 한다.
    """
    import re
    from pathlib import Path

    main_src = (Path(__file__).resolve().parents[1] / "main.py").read_text()
    m = re.search(r"timeout_graceful_shutdown\s*=\s*(\d+)", main_src)
    assert m, "uvicorn.run 에 timeout_graceful_shutdown 이 없다 — 종료가 무한히 기다린다"
    graceful = int(m.group(1))

    unit = Path(__file__).resolve().parents[2] / "deploy" / "iterminallist.service"
    stop_limit = 15
    if unit.exists():
        u = re.search(r"TimeoutStopSec\s*=\s*(\d+)", unit.read_text())
        if u:
            stop_limit = int(u.group(1))

    assert graceful + sftp_pool.POOL_CLOSE_TIMEOUT_SEC < stop_limit, (
        f"graceful({graceful}s) + 풀 정리({sftp_pool.POOL_CLOSE_TIMEOUT_SEC}s) 가 "
        f"TimeoutStopSec({stop_limit}s) 를 넘는다 — 여전히 SIGKILL 이다"
    )
