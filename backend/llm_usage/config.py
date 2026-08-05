"""Integration settings — one switch, nothing else.

**Off means nothing happens.** The dashboard omits the section, and the backend
reads no log files and opens no SSH. Agent features are opt-in; people who don't
use them shouldn't pay for them.

No address, no API key: we carry the collector ourselves (`runner.py`), so there
is nothing for the user to point at, and SSH already handles authentication.
"""
from __future__ import annotations

import os

from sqlite_storage import storage

CONFIG_ENABLED_KEY = "llm_usage_enabled"
ENV_ENABLED = "LLM_USAGE_ENABLED"


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


async def get_config() -> dict:
    """Current state. Env wins over the DB (same rule as Telegram config)."""
    env_value = (os.getenv(ENV_ENABLED) or "").strip()
    if env_value:
        return {"enabled": _truthy(env_value), "enabled_from_env": True}
    return {"enabled": _truthy(await storage.get_config(CONFIG_ENABLED_KEY)),
            "enabled_from_env": False}


def public_view(config: dict) -> dict:
    """Shape returned to the settings screen."""
    return {"enabled": config["enabled"], "enabled_from_env": config["enabled_from_env"]}


async def save_config(*, enabled: bool | None = None) -> None:
    """None leaves it alone. The DB value is stored even when env pins the
    setting, so removing the env var brings the stored choice back."""
    if enabled is not None:
        await storage.set_config(CONFIG_ENABLED_KEY, "1" if enabled else "0")
