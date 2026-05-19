"""
in-memory sliding-window rate limiter.

외부 의존성 없이 로그인 / OTP 같은 무차별 대입 노출 엔드포인트에 적용한다.
멀티-프로세스 배포로 가면 Redis 기반으로 교체해야 한다 (현재 백엔드는 단일 프로세스).

사용:
    from rate_limit import check_rate_limit
    check_rate_limit(f"login:{ip}", max_attempts=5, window_seconds=60)
"""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException

# key -> deque[timestamps]
_buckets: dict[str, deque[float]] = {}
_lock = threading.Lock()

# 너무 많은 키가 쌓이는 걸 막는 상한 (메모리 누수 방지).
# 단일 호스트 IPv4/IPv6 다양성이 있어도 1만 이하면 충분.
_MAX_KEYS = 10_000


def check_rate_limit(key: str, max_attempts: int, window_seconds: float) -> None:
    """key 에 대해 window 안 시도 횟수를 누적. max 초과 시 HTTP 429 발생.

    sliding window — 정확히 같은 윈도우 안의 시도만 카운트.
    호출 자체가 시도로 카운트되므로 인증 성공/실패 무관하게 적용.
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        bucket = _buckets.get(key)
        if bucket is None:
            # 키 수 상한 초과 시 가장 오래된 키 정리.
            if len(_buckets) >= _MAX_KEYS:
                _evict_oldest()
            bucket = deque()
            _buckets[key] = bucket
        # 윈도우 밖 시도 제거.
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= max_attempts:
            retry_after = max(1, int(bucket[0] + window_seconds - now))
            raise HTTPException(
                status_code=429,
                detail="요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


def _evict_oldest() -> None:
    """가장 작은 마지막 timestamp 를 가진 키 한 개 제거. _lock 보유 상태에서 호출."""
    if not _buckets:
        return
    oldest_key = min(_buckets, key=lambda k: _buckets[k][-1] if _buckets[k] else 0)
    _buckets.pop(oldest_key, None)


def client_ip_from_request(request) -> str:
    """X-Forwarded-For 우선, 없으면 client.host. rate limit key 에 사용."""
    xff = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if xff:
        return xff
    try:
        return request.client.host if request.client else "unknown"
    except Exception:
        return "unknown"
