"""연결 풀을 새게 하는 코드가 다시 들어오지 못하게 한다.

⚠️ **실측 사고(2026-08-27).** 호스트를 읽는 함수 하나가 반납 대신 `conn.close()` 를
불렀다. 그러면 연결은 닫히지만 `_pool_size` 는 줄지 않고 큐에도 안 돌아간다 — 풀 크기
(10)만큼 부르고 나면 그 다음 `_get_connection()` 이 `self._pool.get()` 에서 **영원히**
막힌다. 그 호출은 `asyncio.to_thread` 안에서 도므로 실행기 스레드까지 함께 잡아먹고,
결국 저장소를 쓰는 모든 요청이 멈춘다.

증상은 "세션이 데드락" 이었고, 종료 로그에 `Cancel 97 running task(s)` 와
`record_usage_end` 가 to_thread 에서 취소된 트레이스가 남았다.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from sqlite_storage import SQLiteStorage

DB_DIR = Path(__file__).resolve().parent.parent / "db"


@pytest.fixture
def storage(tmp_path):
    return SQLiteStorage(str(tmp_path / "t.db"))


async def _seed_host(storage, host_id="h1", username="u"):
    def _insert():
        conn = storage._get_connection()
        try:
            conn.execute(
                "INSERT INTO hosts (id, username, name, hostname, ssh_user, port,"
                " auth_method, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
                (host_id, username, "n", "h", "u", 22, "password"),
            )
            conn.commit()
        finally:
            storage._release_connection(conn)
    _insert()


async def test_repeated_reads_do_not_exhaust_the_pool(storage):
    """풀 크기보다 많이 불러도 멈추지 않아야 한다 — 새면 여기서 영영 안 돌아온다."""
    await _seed_host(storage)
    import asyncio
    for _ in range(25):                      # 풀(10)의 두 배 넘게
        got = await asyncio.wait_for(storage.get_host("h1", "u"), timeout=5)
        assert got["id"] == "h1"


async def test_repeated_writes_do_not_exhaust_the_pool(storage):
    await _seed_host(storage)
    import asyncio
    for i in range(20):
        await asyncio.wait_for(
            storage.update_host_last_cwd("h1", "u", f"/tmp/{i}"), timeout=5,
        )
    assert (await storage.get_host("h1", "u"))["last_cwd"] == "/tmp/19"


def test_the_pool_size_bookkeeping_stays_honest(storage):
    """빌린 만큼 돌려줬으면 풀은 원래 크기로 돌아와야 한다."""
    before = storage._pool_size
    conns = [storage._get_connection() for _ in range(5)]
    for conn in conns:
        storage._release_connection(conn)
    assert storage._pool_size <= max(before, 5)
    assert storage._pool.qsize() >= 5


def test_no_db_module_closes_a_pooled_connection_directly():
    """⚠️ 이 한 줄이 전부다. `conn.close()` 는 연결을 닫을 뿐 **풀에서 빼지 않는다** —
    반납은 `_release_connection` 만이 한다."""
    offenders = []
    for path in sorted(DB_DIR.glob("*.py")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"\s+conn\.close\(\)\s*$", line):
                offenders.append(f"{path.name}:{number}")
    assert offenders == []


def test_an_exhausted_pool_fails_loudly_instead_of_hanging(storage, monkeypatch):
    """⚠️ 무한 대기는 반납 누락을 **조용한 전면 정지**로 키운다. 상한이 있으면 같은
    버그가 시끄럽게 드러난다 — 이 저장소의 "끝나지 않는 대기를 두지 않는다" 규칙."""
    import sqlite_storage as module
    monkeypatch.setattr(module, "_POOL_WAIT_TIMEOUT", 0.05)
    held = [storage._get_connection() for _ in range(module._POOL_SIZE)]
    try:
        with pytest.raises(RuntimeError, match="연결 풀"):
            storage._get_connection()
    finally:
        for conn in held:
            storage._release_connection(conn)
