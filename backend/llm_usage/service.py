"""이 서버와 등록된 호스트를 훑어 하루 캐시한다.

**백그라운드 폴러가 없다.** 대시보드가 열릴 때만 움직이고 결과는 하루 산다. 서버가
재시작해도 다시 긁지 않도록 캐시는 DB 에 남긴다. 사용자가 새로고침을 누르면 그때만
강제 갱신한다.

수집 방식은 하나뿐이다 — `collect.py` 를 로컬에서는 import 로, 원격에서는 SSH stdin
으로 실행한다(`runner.py`). 호스트에 설치할 것도, 띄워둘 것도 없다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from sqlite_storage import storage

from .aggregate import merge_sessions, merge_summaries
from .config import get_config as get_usage_config
from .fx import get_rates
from .runner import CollectFailed, run_local, run_remote

logger = logging.getLogger(__name__)

LOCAL_SOURCE_ID = "local"
LOCAL_LABEL = "이 서버"

# 캐시 수명 — 한 번 읽었으면 하루 산다. 아무 소스도 못 읽었을 때만 짧게 잡는데,
# "아직 아무 데도 안 쓴다" 와 "잠깐 네트워크가 나갔다" 를 구분할 방법이 없기
# 때문이다. 3시간이면 죽은 호스트를 하루 8번 찌르는 정도.
SUCCESS_TTL_SECONDS = 24 * 60 * 60
FAILURE_TTL_SECONDS = 3 * 60 * 60

# 기간 선택지 — 경계에서 화이트리스트로 막는다. 0 은 전체.
ALLOWED_DAYS = (0, 7, 30, 90)
DEFAULT_DAYS = 30
# 한 번에 붙을 호스트 수 — fleet 이 커져도 SSH 를 한꺼번에 수십 개 열지 않는다.
MAX_CONCURRENT_HOSTS = 6


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_days(days) -> int:
    try:
        value = int(days)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return value if value in ALLOWED_DAYS else DEFAULT_DAYS


def _source(source_id: str, label: str, *, payload=None, error=None) -> dict:
    return {
        "source_id": source_id,
        "label": label,
        "ok": payload is not None,
        "error": error,
        "fetched_at": _now_iso(),
        "payload": payload,
    }


async def _collect_local(days: int) -> dict:
    try:
        return _source(LOCAL_SOURCE_ID, LOCAL_LABEL, payload=await run_local(days))
    except CollectFailed as e:
        return _source(LOCAL_SOURCE_ID, LOCAL_LABEL, error=str(e))


async def _collect_host(host: dict, username: str, days: int, gate: asyncio.Semaphore) -> dict:
    from host_common import resolve_host_with_secrets

    label = host.get("name") or host.get("hostname") or host["id"]
    try:
        async with gate:
            resolved, secrets = await resolve_host_with_secrets(host["id"], username)
            payload = await run_remote(resolved, secrets, days)
    except CollectFailed as e:
        return _source(host["id"], label, error=str(e))
    except Exception as e:  # 자격증명 해석 실패 등 — 소스 하나가 이상해도 나머지는 산다
        logger.warning("llm usage collect failed (%s): %s", host.get("id"), e)
        return _source(host["id"], label, error=f"조회 실패: {e}")
    return _source(host["id"], label, payload=payload)


async def collect_sources(username: str, days: int) -> list[dict]:
    """이 서버 + 등록된 호스트 전부. 동시성은 MAX_CONCURRENT_HOSTS 로 묶는다."""
    gate = asyncio.Semaphore(MAX_CONCURRENT_HOSTS)
    tasks = [_collect_local(days)]
    for host in await storage.list_hosts(username):
        tasks.append(_collect_host(host, username, days, gate))
    return list(await asyncio.gather(*tasks))


def _cache_key(username: str, days: int) -> str:
    return f"llm_usage_cache:{username}:{days}"


def _cache_age_ok(entry: dict) -> bool:
    try:
        fetched = datetime.fromisoformat(entry["fetched_at"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return False
    ttl = SUCCESS_TTL_SECONDS if entry.get("ok_count") else FAILURE_TTL_SECONDS
    return (time.time() - fetched) < ttl


async def _read_cache(username: str, days: int) -> dict | None:
    raw = await storage.get_config(_cache_key(username, days))
    if not raw:
        return None
    try:
        entry = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return entry if isinstance(entry, dict) else None


def disabled_payload(days: int) -> dict:
    """What "off" looks like — the frontend sees `enabled: false` and draws nothing."""
    return {**merge_summaries([]), "sessions": [], "days": days,
            "fetched_at": _now_iso(), "cached": False, "enabled": False, "fx": {}}


async def get_usage(username: str, days: int = DEFAULT_DAYS,
                    force: bool = False) -> dict:
    """대시보드가 그대로 쓰는 한 덩어리. 캐시가 살아있으면 아무 데도 안 붙는다.

    **꺼져 있으면 여기서 끝난다** — 캐시도, 파일 읽기도, SSH 도 없다.
    """
    days = normalize_days(days)
    config = await get_usage_config()
    if not config["enabled"]:
        return disabled_payload(days)

    if not force:
        cached = await _read_cache(username, days)
        if cached and _cache_age_ok(cached):
            # FX is attached at response time, not stored: a day-old summary should
            # still be shown at today's rate.
            return {**cached, "cached": True, "fx": await get_rates()}

    sources = await collect_sources(username, days)
    entry = {
        **merge_summaries(sources),
        "sessions": merge_sessions(sources),
        "days": days,
        "fetched_at": _now_iso(),
        "cached": False,
        "enabled": True,
    }
    try:
        await storage.set_config(_cache_key(username, days), json.dumps(entry))
    except Exception as e:  # a cache we cannot write must not cost us the response
        logger.warning("llm usage cache write failed: %s", e)
    return {**entry, "fx": await get_rates()}
