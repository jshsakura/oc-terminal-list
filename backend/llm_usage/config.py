"""연동 설정 — 켜져 있지 않으면 이 기능은 존재하지 않는다.

**꺼져 있으면 아무 데도 연결하지 않는다.** 대시보드는 카드를 안 그리고, 백엔드는
호스트에 SSH 도 걸지 않는다. 에이전트 기능은 옵트인이고, 안 쓰는 사람이 비용을
치를 이유가 없다.

텔레그램 설정과 같은 규약을 따른다: **env 가 DB 를 이긴다.** `.env` 에 넣어두면
설정 화면에서 다시 입력할 필요가 없고, DB 백업에 비밀이 실려 나가지 않는다.
"""
from __future__ import annotations

import os

from sqlite_storage import storage
from vault import decrypt_str, encrypt_str

CONFIG_ENABLED_KEY = "llm_usage_enabled"
CONFIG_URL_KEY = "llm_watcher_url"
CONFIG_API_KEY_KEY = "llm_watcher_api_key_enc"

ENV_URL = "LLM_WATCHER_URL"
ENV_API_KEY = "LLM_WATCHER_API_KEY"


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


async def get_config() -> dict:
    """연동 상태. `api_key` 는 내부용이며 **응답에 실어 보내지 않는다.**"""
    enabled = _truthy(await storage.get_config(CONFIG_ENABLED_KEY))

    env_url = (os.getenv(ENV_URL) or "").strip()
    url = env_url or (await storage.get_config(CONFIG_URL_KEY)) or ""
    url = url.strip().rstrip("/")

    env_key = (os.getenv(ENV_API_KEY) or "").strip()
    api_key = env_key
    if not api_key:
        enc = await storage.get_config(CONFIG_API_KEY_KEY)
        api_key = (decrypt_str(enc) if enc else "") or ""

    return {
        "enabled": enabled,
        "url": url,
        "url_from_env": bool(env_url),
        "api_key": api_key,
        "api_key_from_env": bool(env_key),
        "has_api_key": bool(api_key),
    }


def public_view(config: dict) -> dict:
    """설정 화면에 돌려줄 형태 — 키 자체는 절대 나가지 않는다."""
    return {
        "enabled": config["enabled"],
        "url": config["url"],
        "url_from_env": config["url_from_env"],
        "has_api_key": config["has_api_key"],
        "api_key_from_env": config["api_key_from_env"],
    }


async def save_config(*, enabled: bool | None = None, url: str | None = None,
                      api_key: str | None = None) -> None:
    """None 인 항목은 건드리지 않는다. `api_key=""` 는 '지워라' 라는 뜻이다."""
    if enabled is not None:
        await storage.set_config(CONFIG_ENABLED_KEY, "1" if enabled else "0")
    if url is not None:
        await storage.set_config(CONFIG_URL_KEY, url.strip().rstrip("/"))
    if api_key is not None:
        cleaned = api_key.strip()
        await storage.set_config(CONFIG_API_KEY_KEY, encrypt_str(cleaned) if cleaned else "")
