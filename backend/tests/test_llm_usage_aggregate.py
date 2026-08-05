"""여러 호스트의 watcher 응답 합산 — 더하면 안 되는 것을 안 더하는지가 핵심.

합산은 단순해 보이지만 두 군데서 조용히 틀린다: 개수 필드(`agents`/`days`)를
그냥 더하는 것과, 실패한 호스트를 화면에서 지워버리는 것.
"""
from llm_usage.aggregate import merge_sessions, merge_summaries


def _source(source_id, *, ok=True, totals=None, by_agent=None, by_day=None,
            by_model=None, by_project=None, sessions=None, error=None):
    return {
        "source_id": source_id,
        "label": source_id,
        "ok": ok,
        "error": error,
        "fetched_at": "2026-08-05T00:00:00+00:00",
        "summary": None if not ok else {
            "totals": totals or {},
            "by_day": by_day or [],
            "by_agent": by_agent or [],
            "by_model": by_model or [],
            "by_project": by_project or [],
        },
        "sessions": sessions or [],
    }


def test_token_and_cost_totals_sum_across_hosts():
    out = merge_summaries([
        _source("a", totals={"tokens": 100, "cost": 1.5, "sessions": 2}),
        _source("b", totals={"tokens": 250, "cost": 2.5, "sessions": 3}),
    ])
    assert out["totals"]["tokens"] == 350
    assert out["totals"]["cost"] == 4.0
    assert out["totals"]["sessions"] == 5


def test_agent_count_is_distinct_not_summed():
    """두 호스트가 모두 claude 를 쓰면 2종이 아니라 1종이다."""
    out = merge_summaries([
        _source("a", totals={"agents": 1}, by_agent=[{"name": "claude", "tokens": 10, "cost": 1, "sessions": 1}]),
        _source("b", totals={"agents": 1}, by_agent=[{"name": "claude", "tokens": 20, "cost": 2, "sessions": 1}]),
    ])
    assert out["totals"]["agents"] == 1
    assert len(out["by_agent"]) == 1
    assert out["by_agent"][0]["tokens"] == 30
    assert out["by_agent"][0]["sessions"] == 2


def test_day_count_is_distinct_not_summed():
    same_day = [{"day": "2026-08-01", "tokens": 5, "cost": 0.5}]
    out = merge_summaries([
        _source("a", totals={"days": 1}, by_day=same_day),
        _source("b", totals={"days": 1}, by_day=same_day),
    ])
    assert out["totals"]["days"] == 1
    assert out["by_day"][0]["tokens"] == 10


def test_days_are_sorted_ascending():
    out = merge_summaries([
        _source("a", by_day=[{"day": "2026-08-03", "tokens": 1}]),
        _source("b", by_day=[{"day": "2026-08-01", "tokens": 1}]),
    ])
    assert [r["day"] for r in out["by_day"]] == ["2026-08-01", "2026-08-03"]


def test_groups_are_sorted_by_cost_desc():
    out = merge_summaries([
        _source("a", by_project=[
            {"name": "cheap", "tokens": 1, "cost": 1, "sessions": 1},
            {"name": "pricey", "tokens": 1, "cost": 9, "sessions": 1},
        ]),
    ])
    assert [r["name"] for r in out["by_project"]] == ["pricey", "cheap"]


def test_failed_host_stays_visible_with_its_reason():
    """숫자에 0 으로 기여하되 목록에서 사라지면 안 된다 — '왜 비었나' 를 답해야 한다."""
    out = merge_summaries([
        _source("ok-host", totals={"tokens": 10, "cost": 1}),
        _source("dead-host", ok=False, error="SSH 실패"),
    ])
    assert out["totals"]["tokens"] == 10
    assert out["ok_count"] == 1
    assert out["source_count"] == 2
    dead = [h for h in out["by_host"] if h["source_id"] == "dead-host"][0]
    assert dead["ok"] is False
    assert dead["error"] == "SSH 실패"
    assert dead["tokens"] == 0


def test_garbage_from_another_service_does_not_crash_the_merge():
    """watcher 응답은 남이 준 데이터다 — 숫자 아닌 값이 와도 흘려보낸다."""
    out = merge_summaries([
        _source("a", totals={"tokens": "not-a-number", "cost": None},
                by_agent=[{"name": "claude", "tokens": float("nan"), "cost": "x", "sessions": 1}],
                by_day="이건 리스트가 아님"),
    ])
    assert out["totals"]["tokens"] == 0
    assert out["by_agent"][0]["tokens"] == 0
    assert out["by_day"] == []


def test_no_sources_yields_an_empty_but_well_formed_payload():
    out = merge_summaries([])
    assert out["ok_count"] == 0
    assert out["totals"]["tokens"] == 0
    assert out["by_host"] == []


def test_sessions_keep_their_host_so_pane_lookup_can_join_on_it():
    out = merge_sessions([
        _source("h1", sessions=[{"session_id": "s1", "cwd": "/a", "last_activity": "2026-08-01"}]),
        _source("h2", sessions=[{"session_id": "s2", "cwd": "/b", "last_activity": "2026-08-03"}]),
    ])
    assert [s["session_id"] for s in out] == ["s2", "s1"]  # 최근 활동 순
    assert out[0]["host_id"] == "h2"


def test_sessions_from_failed_hosts_are_dropped():
    out = merge_sessions([
        _source("dead", ok=False, error="x", sessions=[{"session_id": "ghost"}]),
    ])
    assert out == []


def test_session_limit_is_applied_after_sorting():
    rows = [{"session_id": f"s{i}", "last_activity": f"2026-08-{i:02d}"} for i in range(1, 6)]
    out = merge_sessions([_source("h", sessions=rows)], limit=2)
    assert [s["session_id"] for s in out] == ["s5", "s4"]
