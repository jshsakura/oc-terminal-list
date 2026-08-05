"""The price table.

Prefix matching is the point: model names keep multiplying (`claude-opus-5`,
`claude-opus-4-8`, dated variants), and exact matching would silently price every
new model at zero — a number nobody would question until it was very wrong.
"""
from llm_usage.pricing import cost_for, priced_cost, rate_for


def test_prefix_matching_covers_variants():
    assert rate_for("claude-opus-5") == rate_for("claude-opus-4-8")
    assert rate_for("claude-opus-5-20260101") is not None
    assert rate_for("gpt-5.6-sol") is not None


def test_longest_prefix_wins():
    """`gemini-2.5-flash` must not be priced as `gemini-2.5-pro`."""
    assert rate_for("gemini-2.5-flash")["output"] == 2.5
    assert rate_for("gemini-2.5-pro")["output"] == 10.0


def test_unknown_model_has_no_price():
    assert rate_for("totally-new-model") is None
    assert cost_for("totally-new-model", {"output": 1_000_000}) is None


def test_case_is_ignored():
    assert rate_for("Claude-Opus-5") is not None


def test_cost_is_per_million_tokens():
    # opus: input $15, output $75, cache_read $1.5, cache_creation $18.75 per 1M
    cost = cost_for("claude-opus-5", {
        "input": 1_000_000, "output": 1_000_000,
        "cache_read": 1_000_000, "cache_creation": 1_000_000,
    })
    assert round(cost, 2) == 15.0 + 75.0 + 1.5 + 18.75


def test_missing_or_bogus_token_fields_count_as_zero():
    assert cost_for("claude-opus-5", {}) == 0.0
    assert cost_for("claude-opus-5", {"output": "many"}) == 0.0


def test_priced_cost_prefers_what_the_source_reported():
    """opencode knows its own bill; the table would only be guessing."""
    assert priced_cost("glm-5.2", {"output": 1_000_000}, given=0.42) == 0.42
    # …even when the table has no idea about the model at all.
    assert priced_cost("mystery", {"output": 1_000_000}, given=1.5) == 1.5


def test_priced_cost_folds_unknown_to_zero_for_sums():
    assert priced_cost("mystery", {"output": 1_000_000}) == 0.0


def test_priced_cost_never_returns_negative():
    assert priced_cost("claude-opus-5", {}, given=-5) == 0.0
