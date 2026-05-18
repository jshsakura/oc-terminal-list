"""
cache.py 의 MemoryCache 검증 — Redis 없는 경로 (스탠드얼론) 가 깨지지 않게.
RedisCache 는 Redis 컨테이너 의존이라 통합 환경에서만.
"""
import asyncio
import time

import pytest

from cache import _MemoryCache


@pytest.fixture
def cache():
    return _MemoryCache()


@pytest.mark.asyncio
async def test_set_and_get_roundtrip(cache):
    await cache.set("k1", {"v": 1}, ttl_seconds=10)
    assert await cache.get("k1") == {"v": 1}


@pytest.mark.asyncio
async def test_missing_key_returns_none(cache):
    assert await cache.get("missing") is None


@pytest.mark.asyncio
async def test_ttl_zero_means_no_expiry(cache):
    await cache.set("k1", "v", ttl_seconds=0)
    # 미래 시간으로 monotonic 점프시켜도 만료 안 돼야 함 (ttl=0 은 영구).
    assert await cache.get("k1") == "v"


@pytest.mark.asyncio
async def test_ttl_expired_key_returns_none(cache, monkeypatch):
    # monkeypatch 로 monotonic 시간을 직접 흘려보낸다 (실시간 sleep 없이).
    base = time.monotonic()
    monkeypatch.setattr(time, "monotonic", lambda: base)
    await cache.set("k1", "v", ttl_seconds=1)
    # ttl 안 — 살아있음.
    monkeypatch.setattr(time, "monotonic", lambda: base + 0.5)
    assert await cache.get("k1") == "v"
    # ttl 지남 — 없음.
    monkeypatch.setattr(time, "monotonic", lambda: base + 1.1)
    assert await cache.get("k1") is None


@pytest.mark.asyncio
async def test_delete_removes_entry(cache):
    await cache.set("k1", "v", ttl_seconds=10)
    await cache.delete("k1")
    assert await cache.get("k1") is None


@pytest.mark.asyncio
async def test_delete_prefix_removes_matching_only(cache):
    await cache.set("host:a:sessions", "v1", ttl_seconds=10)
    await cache.set("host:a:clients", "v2", ttl_seconds=10)
    await cache.set("host:b:sessions", "v3", ttl_seconds=10)
    await cache.set("session:x:clients", "v4", ttl_seconds=10)

    deleted = await cache.delete_prefix("host:a:")
    assert deleted == 2
    assert await cache.get("host:a:sessions") is None
    assert await cache.get("host:a:clients") is None
    # 다른 prefix 는 그대로
    assert await cache.get("host:b:sessions") == "v3"
    assert await cache.get("session:x:clients") == "v4"


@pytest.mark.asyncio
async def test_publish_subscribe_delivers_message(cache):
    received = []

    async def reader():
        async for msg in cache.subscribe("ch1"):
            received.append(msg)
            if len(received) >= 2:
                break

    task = asyncio.create_task(reader())
    # subscribe 가 큐를 등록하도록 한 틱 양보.
    await asyncio.sleep(0)
    await cache.publish("ch1", {"n": 1})
    await cache.publish("ch1", {"n": 2})
    await asyncio.wait_for(task, timeout=1.0)
    assert received == [{"n": 1}, {"n": 2}]


@pytest.mark.asyncio
async def test_publish_to_channel_without_subscribers_drops_silently(cache):
    # 구독자 없이 publish 해도 예외 없어야 함.
    await cache.publish("nobody", {"x": 1})


@pytest.mark.asyncio
async def test_subscribers_isolated_by_channel(cache):
    received_a = []
    received_b = []

    async def reader_a():
        async for msg in cache.subscribe("ch_a"):
            received_a.append(msg)
            break

    async def reader_b():
        async for msg in cache.subscribe("ch_b"):
            received_b.append(msg)
            break

    ta = asyncio.create_task(reader_a())
    tb = asyncio.create_task(reader_b())
    await asyncio.sleep(0)
    await cache.publish("ch_a", {"who": "a"})
    await cache.publish("ch_b", {"who": "b"})
    await asyncio.wait_for(asyncio.gather(ta, tb), timeout=1.0)
    assert received_a == [{"who": "a"}]
    assert received_b == [{"who": "b"}]
