"""Model to price. **This is the only place a cost is multiplied.**

`collect.py` counts tokens; the backend attaches the price. Prices change, and a
table living inside the remote script would mean each host reports numbers
computed with whatever table it happened to have.

Values are **USD per 1M tokens at list price**. On a flat-rate plan (Max, Pro, a
coding plan) this is not your bill — it is "what this would have cost at list".
The UI says exactly that.

An unknown model yields **None, not 0**. Zero would make "used nothing" and "we
don't know the price" look identical on screen. When a source knows its own cost
(opencode), that value wins — the only thing that beats this table.

Prefix matching, because model names keep multiplying: `claude-opus-5`,
`claude-opus-4-8`, dated variants. Exact matching would silently price every new
model at zero.
"""
from __future__ import annotations

MILLION = 1_000_000

# (prefix, {input, output, cache_read, cache_creation}) — longest prefix wins.
# Cache writes are typically 1.25x input, cache reads 0.1x.
PRICES: dict[str, dict] = {
    "claude-opus": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_creation": 18.75},
    "claude-sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_creation": 3.75},
    "claude-haiku": {"input": 0.8, "output": 4.0, "cache_read": 0.08, "cache_creation": 1.0},
    "claude-3-5-haiku": {"input": 0.8, "output": 4.0, "cache_read": 0.08, "cache_creation": 1.0},
    "claude-fable": {"input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_creation": 3.75},
    "gpt-5": {"input": 1.25, "output": 10.0, "cache_read": 0.125, "cache_creation": 0.0},
    "gpt-4.1": {"input": 2.0, "output": 8.0, "cache_read": 0.5, "cache_creation": 0.0},
    "gpt-4o": {"input": 2.5, "output": 10.0, "cache_read": 1.25, "cache_creation": 0.0},
    "o3": {"input": 2.0, "output": 8.0, "cache_read": 0.5, "cache_creation": 0.0},
    "codex": {"input": 1.25, "output": 10.0, "cache_read": 0.125, "cache_creation": 0.0},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.0, "cache_read": 0.31, "cache_creation": 0.0},
    "gemini-2.5-flash": {"input": 0.3, "output": 2.5, "cache_read": 0.075, "cache_creation": 0.0},
    "glm-": {"input": 0.6, "output": 2.2, "cache_read": 0.11, "cache_creation": 0.0},
    "deepseek": {"input": 0.56, "output": 1.68, "cache_read": 0.07, "cache_creation": 0.0},
    "qwen": {"input": 0.4, "output": 1.2, "cache_read": 0.04, "cache_creation": 0.0},
}

_ORDERED = sorted(PRICES.items(), key=lambda kv: len(kv[0]), reverse=True)


def rate_for(model: str | None) -> dict | None:
    """Model name to a price row. None when we have no price for it."""
    name = (model or "").strip().lower()
    if not name:
        return None
    for prefix, rate in _ORDERED:
        if name.startswith(prefix):
            return rate
    return None


def cost_for(model: str | None, tokens: dict) -> float | None:
    """List-price cost for a bundle of tokens. None (not 0) when unpriced."""
    rate = rate_for(model)
    if rate is None:
        return None
    total = 0.0
    for field, per_million in rate.items():
        try:
            count = float(tokens.get(field) or 0)
        except (TypeError, ValueError, AttributeError):
            count = 0.0
        total += count * per_million / MILLION
    return total


def priced_cost(model: str | None, tokens: dict, given: float | None = None) -> float:
    """The single number to draw: source-provided cost > price table > 0.

    This feeds sums, so it never returns None — callers that need to distinguish
    "unknown" ask `rate_for` themselves; here it folds to 0.
    """
    if given is not None:
        try:
            return max(0.0, float(given))
        except (TypeError, ValueError):
            return 0.0
    return cost_for(model, tokens) or 0.0
