"""USD → other currencies, fetched once a day.

Costs are computed in USD (that is how models are priced), but a Korean screen
wants 원. One rate per day is plenty — this is an estimate against list price,
not an accounting figure, and nobody needs intraday FX for it.

Rules:

- **The rate is cached in the DB with its timestamp** and reused for 24h, so a
  dashboard open does not mean a network call.
- **A failed fetch never breaks the dashboard.** We fall back to the last rate we
  ever saw — even a stale one — and only give up (None) if we have never had one.
  The UI then simply shows USD.
- Outbound access is not guaranteed on every deployment, which is why this is
  strictly best-effort and never blocks the summary.
"""
from __future__ import annotations

import json
import logging
import time

import aiohttp

from sqlite_storage import storage

logger = logging.getLogger(__name__)

# Free, no API key, no attribution requirement. Updated daily, which matches TTL.
FX_URL = "https://open.er-api.com/v6/latest/USD"
FX_CONFIG_KEY = "llm_usage_fx"
FX_TTL_SECONDS = 24 * 60 * 60
FX_TIMEOUT_SECONDS = 5.0

# Only what the UI can display. Adding a currency here is all it takes.
WANTED = ("KRW", "JPY", "EUR")


async def _read_cache() -> dict | None:
    raw = await storage.get_config(FX_CONFIG_KEY)
    if not raw:
        return None
    try:
        entry = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return entry if isinstance(entry, dict) and entry.get("rates") else None


async def _fetch() -> dict | None:
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=FX_TIMEOUT_SECONDS)
        ) as session:
            async with session.get(FX_URL) as res:
                if res.status != 200:
                    return None
                body = await res.json(content_type=None)
    except Exception as e:  # noqa: BLE001 — network, DNS, JSON; all mean "no rate today"
        logger.info("fx fetch failed: %s", e)
        return None
    rates = (body or {}).get("rates") or {}
    picked = {}
    for code in WANTED:
        try:
            value = float(rates.get(code))
        except (TypeError, ValueError):
            continue
        if value > 0:
            picked[code] = value
    return picked or None


async def get_rates() -> dict:
    """`{"KRW": 1423.6, …}`. Empty dict when we have never fetched successfully."""
    cached = await _read_cache()
    if cached and (time.time() - float(cached.get("at") or 0)) < FX_TTL_SECONDS:
        return cached["rates"]

    fresh = await _fetch()
    if not fresh:
        # Stale is better than nothing: a day-old rate still shows the right order
        # of magnitude, and the alternative is falling back to bare USD.
        return (cached or {}).get("rates") or {}

    try:
        await storage.set_config(FX_CONFIG_KEY, json.dumps({"at": time.time(), "rates": fresh}))
    except Exception as e:  # noqa: BLE001 — cache write failure must not lose the rate
        logger.warning("fx cache write failed: %s", e)
    return fresh
