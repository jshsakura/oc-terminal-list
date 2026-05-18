"""
캐시 + Pub/Sub 추상화.

REDIS_URL 환경변수가 설정돼있으면 redis.asyncio 백엔드를 쓰고,
없으면 in-memory 폴백을 쓴다. 표준 배포(single-process systemd)에서는 메모리 백엔드가
Redis 보다 빠르고 의존성도 없다. 멀티 인스턴스 / 외부 캐시가 필요하면 REDIS_URL 만 채우면 됨.

API:
    cache.get(key) -> Any|None
    cache.set(key, value, ttl_seconds)
    cache.delete(key)
    cache.delete_prefix(prefix)
    cache.publish(channel, payload_dict)
    async for msg in cache.subscribe(channel): ...

값은 JSON 직렬화 가능한 dict/list/scalar 로 한정. ttl_seconds=0 이면 만료 없음.
"""
import asyncio
import json
import logging
import os
import time
from typing import Any, AsyncIterator, Optional

logger = logging.getLogger(__name__)


class _MemoryCache:
    """단일 프로세스 내 dict 기반 TTL 캐시. asyncio-safe."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)
        self._lock = asyncio.Lock()
        self._subs: dict[str, list[asyncio.Queue]] = {}

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._data.get(key)
            if not entry:
                return None
            expires_at, value = entry
            if expires_at and expires_at < time.monotonic():
                self._data.pop(key, None)
                return None
            return value

    async def set(self, key: str, value: Any, ttl_seconds: float = 0) -> None:
        expires_at = (time.monotonic() + ttl_seconds) if ttl_seconds > 0 else 0
        async with self._lock:
            self._data[key] = (expires_at, value)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._data.pop(key, None)

    async def delete_prefix(self, prefix: str) -> int:
        async with self._lock:
            keys = [k for k in self._data if k.startswith(prefix)]
            for k in keys:
                self._data.pop(k, None)
            return len(keys)

    async def publish(self, channel: str, payload: dict) -> None:
        subs = self._subs.get(channel, [])
        for q in list(subs):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass  # 느린 subscriber 는 메시지 손실 — 어차피 polling 대체용이라 OK

    async def subscribe(self, channel: str) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subs.setdefault(channel, []).append(q)
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            try:
                self._subs.get(channel, []).remove(q)
            except ValueError:
                pass


class _RedisCache:
    """redis.asyncio 백엔드. 값은 JSON 문자열로 저장."""

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis  # local import — optional dep
        self._redis = redis.from_url(url, decode_responses=True)
        self._url = url

    async def get(self, key: str) -> Optional[Any]:
        raw = await self._redis.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None

    async def set(self, key: str, value: Any, ttl_seconds: float = 0) -> None:
        raw = json.dumps(value, default=str)
        if ttl_seconds > 0:
            await self._redis.set(key, raw, ex=int(ttl_seconds))
        else:
            await self._redis.set(key, raw)

    async def delete(self, key: str) -> None:
        await self._redis.delete(key)

    async def delete_prefix(self, prefix: str) -> int:
        count = 0
        async for k in self._redis.scan_iter(match=f"{prefix}*"):
            await self._redis.delete(k)
            count += 1
        return count

    async def publish(self, channel: str, payload: dict) -> None:
        await self._redis.publish(channel, json.dumps(payload, default=str))

    async def subscribe(self, channel: str) -> AsyncIterator[dict]:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    yield json.loads(msg.get("data") or "null")
                except (TypeError, json.JSONDecodeError):
                    continue
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
            except Exception:
                pass


def _build_cache():
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        logger.info("cache: in-memory backend (REDIS_URL not set)")
        return _MemoryCache()
    try:
        backend = _RedisCache(url)
        logger.info("cache: Redis backend (%s)", url.split("@")[-1])
        return backend
    except ImportError:
        logger.warning("cache: REDIS_URL set but `redis` package missing — falling back to in-memory")
        return _MemoryCache()
    except Exception as e:
        logger.warning("cache: Redis init failed (%s) — falling back to in-memory", e)
        return _MemoryCache()


cache = _build_cache()


# ─────────────────────────────────────────────────────────────────────────────
# 캐시 키 헬퍼 — 한 곳에서 관리해 invalidation 누락 방지.
# ─────────────────────────────────────────────────────────────────────────────

def key_host_tmux_sessions(host_id: str) -> str:
    return f"host:{host_id}:tmux-sessions"


def key_host_tmux_clients(host_id: str, session: str) -> str:
    return f"host:{host_id}:tmux-clients:{session}"


def key_local_clients(session_id: str) -> str:
    return f"session:{session_id}:clients"


def keys_prefix_host(host_id: str) -> str:
    return f"host:{host_id}:"


async def invalidate_host(host_id: str) -> None:
    """호스트의 모든 캐시 무효화 — 세션 생성/종료 시 호출."""
    await cache.delete_prefix(keys_prefix_host(host_id))


async def invalidate_session(session_id: str) -> None:
    await cache.delete(key_local_clients(session_id))
