"""소스를 찾고, 물어보고, 하루 캐시한다.

**백그라운드 폴러가 없다.** 대시보드가 열릴 때만 움직이고 결과는 하루 산다. 서버가
재시작해도 다시 긁지 않도록 캐시는 DB 에 남긴다. 사용자가 새로고침을 누르면 그때만
강제 갱신한다.

소스 탐지는 운용 형태를 가리지 않는다. 후보를 순서대로 찔러 **먼저 대답하는 놈이**
이 서버의 watcher 다:

  1. `LLM_WATCHER_URL`            명시 설정이 언제나 최우선
  2. `http://llm-watcher:34318`   compose 로 동봉한 경우 (서비스명 DNS)
  3. `http://127.0.0.1:34318`     호스트 systemd 운용 / host-network 컨테이너

fleet 원격 호스트는 등록된 호스트 목록을 그대로 쓴다 — SSH 로 그쪽 루프백을 읽는다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

from sqlite_storage import storage

from .aggregate import merge_sessions, merge_summaries
from .config import get_config as get_watcher_config
from .client import (
    WATCHER_PORT,
    WatcherUnavailable,
    fetch_direct,
    fetch_via_ssh,
)

logger = logging.getLogger(__name__)

LOCAL_SOURCE_ID = "local"
LOCAL_LABEL = "이 서버"

# 캐시 수명 — 한 번 읽었으면 하루 산다. 아무 소스도 못 읽었을 때만 짧게 잡는데,
# "아직 아무 데도 안 깔았다" 와 "잠깐 네트워크가 나갔다" 를 구분할 방법이 없기
# 때문이다. 3시간이면 죽은 호스트를 하루 8번 찌르는 정도 — 하루 종일 재시도하지도,
# 방금 깐 watcher 를 내일까지 못 보지도 않는 선.
SUCCESS_TTL_SECONDS = 24 * 60 * 60
FAILURE_TTL_SECONDS = 3 * 60 * 60
# 소스 탐지 결과도 캐시한다(프로세스 메모리). 없다는 결론도 캐시해야 매 요청마다
# 세 후보를 찌르지 않는다.
_DISCOVERY_TTL_SECONDS = 10 * 60

# 기간 선택지 — 경계에서 화이트리스트로 막는다. 0 은 전체.
ALLOWED_DAYS = (0, 7, 30, 90)
DEFAULT_DAYS = 30
SESSIONS_PER_SOURCE = 40

_discovery: dict = {"at": 0.0, "base_url": None}
_discovery_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_days(days) -> int:
    try:
        value = int(days)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return value if value in ALLOWED_DAYS else DEFAULT_DAYS


def _candidate_urls(configured_url: str | None = None) -> list[str]:
    """설정값 → compose 서비스명 → 루프백. 먼저 대답하는 놈이 이긴다."""
    candidates = [(configured_url or "").strip().rstrip("/")]
    candidates += [f"http://llm-watcher:{WATCHER_PORT}", f"http://127.0.0.1:{WATCHER_PORT}"]
    seen: list[str] = []
    for url in candidates:
        if url and url not in seen:
            seen.append(url)
    return seen


async def discover_local_base_url(force: bool = False,
                                  configured_url: str | None = None) -> str | None:
    """이 서버에서 닿는 watcher 주소. 없으면 None (그게 정상적인 상태다)."""
    now = time.time()
    if not force and now - _discovery["at"] < _DISCOVERY_TTL_SECONDS:
        return _discovery["base_url"]
    async with _discovery_lock:
        now = time.time()
        if not force and now - _discovery["at"] < _DISCOVERY_TTL_SECONDS:
            return _discovery["base_url"]
        found = None
        for url in _candidate_urls(configured_url):
            try:
                await fetch_direct(url, "/api/health")
            except WatcherUnavailable:
                continue
            found = url
            break
        _discovery["base_url"] = found
        _discovery["at"] = time.time()
        return found


def _query(path: str, days: int) -> str:
    return path if days <= 0 else f"{path}?days={days}"


def _sessions_query(days: int) -> str:
    base = f"/api/sessions?limit={SESSIONS_PER_SOURCE}"
    return base if days <= 0 else f"{base}&days={days}"


async def _fetch_one(source_id: str, label: str, days: int, *,
                     base_url: str | None = None, api_key: str | None = None,
                     host: dict | None = None, secrets: dict | None = None) -> dict:
    """소스 하나 — summary 와 sessions 를 읽어 공통 형태로 돌려준다."""
    result = {"source_id": source_id, "label": label, "ok": False,
              "error": None, "fetched_at": _now_iso(), "summary": None, "sessions": []}
    try:
        if base_url:
            summary = await fetch_direct(base_url, _query("/api/summary", days), api_key=api_key)
            sessions = await fetch_direct(base_url, _sessions_query(days), api_key=api_key)
        else:
            summary = await fetch_via_ssh(host, secrets, _query("/api/summary", days),
                                          api_key=api_key)
            sessions = await fetch_via_ssh(host, secrets, _sessions_query(days),
                                           api_key=api_key)
    except WatcherUnavailable as e:
        result["error"] = str(e)
        return result
    except Exception as e:  # 소스 하나가 이상해도 나머지는 살린다
        logger.warning("llm-watcher fetch failed (%s): %s", source_id, e)
        result["error"] = f"조회 실패: {e}"
        return result
    result["ok"] = True
    result["summary"] = summary
    result["sessions"] = (sessions or {}).get("sessions") or []
    return result


async def _fetch_host(host: dict, username: str, days: int,
                      api_key: str | None = None) -> dict:
    from host_common import resolve_host_with_secrets

    label = host.get("name") or host.get("hostname") or host["id"]
    try:
        resolved, secrets = await resolve_host_with_secrets(host["id"], username)
    except Exception as e:
        return {"source_id": host["id"], "label": label, "ok": False,
                "error": f"호스트 자격증명 해석 실패: {e}", "fetched_at": _now_iso(),
                "summary": None, "sessions": []}
    return await _fetch_one(host["id"], label, days, host=resolved, secrets=secrets,
                            api_key=api_key)


async def collect_sources(username: str, days: int, config: dict) -> list[dict]:
    """이 서버 + 등록된 호스트 전부를 동시에 조회한다."""
    api_key = config.get("api_key") or None
    tasks = []
    base_url = await discover_local_base_url(configured_url=config.get("url"))
    if base_url:
        tasks.append(_fetch_one(LOCAL_SOURCE_ID, LOCAL_LABEL, days,
                                base_url=base_url, api_key=api_key))
    for host in await storage.list_hosts(username):
        tasks.append(_fetch_host(host, username, days, api_key=api_key))
    if not tasks:
        return []
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
    """연동이 꺼져 있을 때의 응답 — 프론트는 `ok_count: 0` 을 보고 안 그린다."""
    return {**merge_summaries([]), "sessions": [], "days": days,
            "fetched_at": _now_iso(), "cached": False, "enabled": False}


async def get_usage(username: str, days: int = DEFAULT_DAYS,
                    force: bool = False) -> dict:
    """대시보드가 그대로 쓰는 한 덩어리. 캐시가 살아있으면 네트워크를 안 탄다.

    **연동이 꺼져 있으면 여기서 끝난다** — 캐시도, HTTP 도, SSH 도 없다.
    """
    days = normalize_days(days)
    config = await get_watcher_config()
    if not config["enabled"]:
        return disabled_payload(days)

    if not force:
        cached = await _read_cache(username, days)
        if cached and _cache_age_ok(cached):
            return {**cached, "cached": True}

    sources = await collect_sources(username, days, config)
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
    except Exception as e:  # 캐시 못 써도 응답은 나가야 한다
        logger.warning("llm usage cache write failed: %s", e)
    return entry

