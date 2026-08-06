"""Keep the price table honest — fetch it instead of remembering it.

The hand-written table in `pricing.py` was 3x too high for months of models: it
carried Opus-4-era prices ($15/$75 per 1M) on `claude-opus-5`, which actually
lists at $5/$25. Nobody notices a wrong price; they just see a number and believe
it. So the table is fetched from the same place ccusage reads — LiteLLM's
published `model_prices_and_context_window.json` — once a day, cached in our DB,
with the built-in table as the fallback when we cannot reach it.

We do not run ccusage. We read the same prices it does.
"""
from __future__ import annotations

import json
import logging
import time

import aiohttp

from sqlite_storage import storage

from . import pricing

logger = logging.getLogger(__name__)

PRICES_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)
CONFIG_KEY = "llm_price_table"
TTL_SECONDS = 24 * 60 * 60
TIMEOUT_SECONDS = 10.0
MILLION = 1_000_000

# Only the families an agent CLI can actually be running. The full file is ~2MB of
# every model on earth; storing that in a config row would be silly.
WANTED_PREFIXES = (
    "claude", "gpt-", "o1", "o3", "o4", "codex", "gemini", "glm", "deepseek",
    "qwen", "kimi", "grok", "llama",
)


def _clean_name(raw: str) -> str:
    """`us.anthropic.claude-opus-5` → `claude-opus-5`.

    Model ids arrive with provider and region prefixes; agent logs record the bare
    name. Region variants price a little higher, and taking the last segment picks
    the base (global) price — the honest choice for an estimate.
    """
    name = str(raw or "").strip().lower()
    for sep in ("/", "."):
        if sep in name:
            name = name.rsplit(sep, 1)[-1]
    return name


def _extract(body: dict) -> dict:
    out: dict[str, dict] = {}
    for raw_name, entry in (body or {}).items():
        if not isinstance(entry, dict):
            continue
        name = _clean_name(raw_name)
        if not name.startswith(WANTED_PREFIXES):
            continue
        # Per-token in the source; per-1M here, like everything else in pricing.py.
        row = {
            "input": float(entry.get("input_cost_per_token") or 0) * MILLION,
            "output": float(entry.get("output_cost_per_token") or 0) * MILLION,
            "cache_read": float(entry.get("cache_read_input_token_cost") or 0) * MILLION,
            "cache_creation": float(entry.get("cache_creation_input_token_cost") or 0) * MILLION,
        }
        if row["input"] <= 0 and row["output"] <= 0:
            continue    # embeddings, moderation, anything without a token price
        # First one wins: entries are ordered base-then-region, and the base price
        # is what a bare model name should cost.
        out.setdefault(name, row)
    return out


async def _fetch() -> dict | None:
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
        ) as session:
            async with session.get(PRICES_URL) as res:
                if res.status != 200:
                    return None
                body = await res.json(content_type=None)
    except Exception as e:  # noqa: BLE001 — offline deployments are normal here
        logger.info("price table fetch failed: %s", e)
        return None
    return _extract(body) or None


async def load_prices() -> dict:
    """Install today's table into `pricing`. Cached in the DB for a day."""
    raw = await storage.get_config(CONFIG_KEY)
    cached = None
    if raw:
        try:
            cached = json.loads(raw)
        except (TypeError, ValueError):
            cached = None

    if cached and (time.time() - float(cached.get("at") or 0)) < TTL_SECONDS:
        pricing.set_live_prices(cached.get("prices") or {})
        return cached.get("prices") or {}

    fresh = await _fetch()
    if not fresh:
        # Stale prices beat invented ones; the built-in table is the last resort.
        prices = (cached or {}).get("prices") or {}
        pricing.set_live_prices(prices)
        return prices

    try:
        await storage.set_config(CONFIG_KEY, json.dumps({"at": time.time(), "prices": fresh}))
    except Exception as e:  # noqa: BLE001
        logger.warning("price table cache write failed: %s", e)
    pricing.set_live_prices(fresh)
    return fresh
