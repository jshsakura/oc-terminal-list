"""Merging collected rows into what the dashboard draws.

Pure functions, tested directly. The traps this guards:

  - counts that must be recomputed, not summed (two hosts running claude are
    still one agent)
  - cost decided per row by that row's model — a group can mix models
  - a source that knows its own cost (opencode) beating the price table
  - hosts that failed staying visible, with the reason
"""
from llm_usage.aggregate import merge_sessions, merge_summaries


def row(day="2026-08-05", agent="claude", model="claude-opus-5", project="app",
        input_=0, output=0, cache_read=0, cache_creation=0, cost=None):
    return {"day": day, "agent": agent, "model": model, "project": project,
            "input": input_, "output": output, "cache_read": cache_read,
            "cache_creation": cache_creation, "cost": cost}


def session(session_id="s1", agent="claude", model="claude-opus-5", project="app",
            cwd="/home/u/app", title="t", last_activity="2026-08-05T10:00:00Z",
            input_=0, output=0, cache_read=0, cache_creation=0, cost=None):
    return {"session_id": session_id, "agent": agent, "model": model,
            "project": project, "cwd": cwd, "title": title,
            "last_activity": last_activity, "input": input_, "output": output,
            "cache_read": cache_read, "cache_creation": cache_creation, "cost": cost}


def source(source_id="local", label="this server", ok=True, error=None,
           rows=None, sessions=None, session_count=None, warnings=None):
    payload = None
    if ok:
        payload = {
            "rows": rows if rows is not None else [],
            "sessions": sessions if sessions is not None else [],
            "session_count": len(sessions or []) if session_count is None else session_count,
            "warnings": warnings or [],
        }
    return {"source_id": source_id, "label": label, "ok": ok, "error": error,
            "fetched_at": "2026-08-05T10:00:00Z", "payload": payload}


def test_empty_input_is_a_valid_empty_dashboard():
    out = merge_summaries([])

    assert out["ok_count"] == 0
    assert out["source_count"] == 0
    assert out["totals"]["cost"] == 0
    assert out["by_host"] == []


def test_cost_comes_from_the_price_table_per_model():
    # 1M output tokens of opus at $75/M.
    out = merge_summaries([source(rows=[row(output=1_000_000)])])

    assert round(out["totals"]["cost"], 2) == 75.0
    assert out["totals"]["tokens"] == 1_000_000


def test_each_row_is_priced_with_its_own_model():
    out = merge_summaries([source(rows=[
        row(model="claude-opus-5", output=1_000_000),      # $75
        row(model="claude-haiku-4-5", output=1_000_000),   # $4
    ])])

    assert round(out["totals"]["cost"], 2) == 79.0


def test_a_source_that_knows_its_own_cost_beats_the_table():
    """opencode records cost itself; our table would only guess at glm pricing."""
    out = merge_summaries([source(rows=[
        row(agent="opencode", model="glm-5.2", output=1_000_000, cost=0.42),
    ])])

    assert out["totals"]["cost"] == 0.42


def test_unknown_model_costs_nothing_but_still_counts_tokens():
    out = merge_summaries([source(rows=[row(model="something-new-9", output=1_000_000)])])

    assert out["totals"]["cost"] == 0
    assert out["totals"]["tokens"] == 1_000_000


def test_same_name_merges_across_hosts():
    """Two hosts working on `app` are one project line — that is the point."""
    out = merge_summaries([
        source(source_id="a", rows=[row(project="app", output=1_000_000)]),
        source(source_id="b", rows=[row(project="app", output=1_000_000)]),
    ])

    projects = {p["name"]: p for p in out["by_project"]}
    assert list(projects) == ["app"]
    assert round(projects["app"]["cost"], 2) == 150.0


def test_agent_and_day_counts_are_recomputed_not_summed():
    out = merge_summaries([
        source(source_id="a", rows=[row(day="2026-08-05", agent="claude", output=10)]),
        source(source_id="b", rows=[row(day="2026-08-05", agent="claude", output=10)]),
    ])

    assert out["totals"]["agents"] == 1   # not 2
    assert out["totals"]["days"] == 1     # not 2


def test_session_count_survives_the_list_cap():
    """The per-host list is truncated; the count must not be."""
    out = merge_summaries([source(sessions=[session()], session_count=137)])

    assert out["totals"]["sessions"] == 137
    assert out["by_host"][0]["sessions"] == 137


def test_failed_host_stays_visible_with_its_reason():
    out = merge_summaries([
        source(source_id="a", rows=[row(output=1_000_000)]),
        source(source_id="b", label="rpi", ok=False, error="SSH failed"),
    ])

    hosts = {h["source_id"]: h for h in out["by_host"]}
    assert hosts["b"]["ok"] is False
    assert hosts["b"]["error"] == "SSH failed"
    assert hosts["b"]["cost"] == 0
    assert out["ok_count"] == 1 and out["source_count"] == 2


def test_warnings_are_labelled_with_the_host_they_came_from():
    out = merge_summaries([source(label="rpi", warnings=["opencode: read failed"])])

    assert out["warnings"] == ["rpi: opencode: read failed"]


def test_garbage_from_a_remote_machine_does_not_crash_the_merge():
    """Every payload here crossed an SSH boundary — never trust its shape."""
    broken = {"source_id": "x", "label": "x", "ok": True, "error": None,
              "fetched_at": "now",
              "payload": {"rows": "not-a-list", "sessions": [None, 42, {"cost": "NaN"}]}}

    out = merge_summaries([broken])

    assert out["totals"]["cost"] == 0
    assert out["by_host"][0]["ok"] is True
    # The one dict in `sessions` survives; the None and the int are dropped.
    assert len(merge_sessions([broken])) == 1


def test_sessions_keep_their_host_so_pane_lookup_can_join_on_it():
    merged = merge_sessions([source(source_id="rpi", label="rpi", sessions=[session()])])

    assert merged[0]["host_id"] == "rpi"
    assert merged[0]["host_name"] == "rpi"


def test_sessions_are_priced_like_rows():
    merged = merge_sessions([source(sessions=[session(output=1_000_000)])])

    assert round(merged[0]["cost"], 2) == 75.0
    assert merged[0]["tokens"] == 1_000_000


def test_sessions_sort_by_recency_across_hosts_then_cap():
    merged = merge_sessions([
        source(source_id="a", sessions=[session(session_id="old",
                                                last_activity="2026-08-01T00:00:00Z")]),
        source(source_id="b", sessions=[session(session_id="new",
                                                last_activity="2026-08-05T00:00:00Z")]),
    ], limit=1)

    assert [s["session_id"] for s in merged] == ["new"]
