"""수집기 — 진짜 로그 모양을 그대로 흉내 낸 fixture 로 검증한다.

여기서 틀리면 화면의 모든 숫자가 틀린다. 특히 세 가지가 조용히 틀리기 쉽다:

  - claude 의 같은 응답이 재개/분기로 여러 파일에 실려 **두 번 세지는 것**
  - codex 의 token_count 가 **누적값**인데 더해버려 세션 길이의 제곱으로 부푸는 것
  - 기간 창(days) 밖의 오래된 로그가 섞여 들어오는 것
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from llm_usage import collect  # noqa: E402


def _iso(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def _write_lines(path, entries):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for entry in entries:
            fh.write(json.dumps(entry) + "\n")


def _claude_assistant(stamp, *, model="claude-opus-5", msg_id="m1", req="r1",
                      cwd="/home/u/app/proj", usage=None):
    return {
        "type": "assistant", "timestamp": stamp, "cwd": cwd, "requestId": req,
        "message": {
            "id": msg_id, "model": model,
            "usage": usage or {
                "input_tokens": 10, "output_tokens": 20,
                "cache_read_input_tokens": 100, "cache_creation_input_tokens": 5,
            },
        },
    }


@pytest.fixture()
def home(tmp_path):
    return str(tmp_path)


def test_claude_sums_usage_and_keeps_title(home):
    session = os.path.join(home, ".claude", "projects", "-home-u-app-proj", "sess-1.jsonl")
    _write_lines(session, [
        {"type": "ai-title", "aiTitle": "리팩토링 작업"},
        _claude_assistant(_iso(1), msg_id="a", req="1"),
        _claude_assistant(_iso(1), msg_id="b", req="2"),
    ])

    out = collect.collect(30, home=home)

    assert out["ok"] is True
    assert out["agents"] == ["claude"]
    total_out = sum(r["output"] for r in out["rows"])
    assert total_out == 40                      # 20 × 2
    assert out["session_count"] == 1
    session_row = out["sessions"][0]
    assert session_row["title"] == "리팩토링 작업"
    assert session_row["project"] == "proj"
    assert session_row["cwd"] == "/home/u/app/proj"
    assert session_row["cache_read"] == 200


def test_claude_dedupes_same_response_across_files(home):
    """재개(resume)하면 같은 응답이 새 파일에도 실린다 — 두 번 세면 안 된다."""
    entry = _claude_assistant(_iso(1), msg_id="same", req="same-req")
    for name in ("sess-1.jsonl", "sess-2.jsonl"):
        _write_lines(os.path.join(home, ".claude", "projects", "-p", name), [entry])

    out = collect.collect(30, home=home)

    assert sum(r["output"] for r in out["rows"]) == 20   # 40 이 아니다


def test_claude_skips_entries_outside_window(home):
    _write_lines(os.path.join(home, ".claude", "projects", "-p", "s.jsonl"), [
        _claude_assistant(_iso(0.5), msg_id="new", req="1"),
        _claude_assistant(_iso(40), msg_id="old", req="2"),
    ])

    out = collect.collect(7, home=home)

    assert sum(r["output"] for r in out["rows"]) == 20


def test_claude_ignores_synthetic_model(home):
    _write_lines(os.path.join(home, ".claude", "projects", "-p", "s.jsonl"), [
        _claude_assistant(_iso(1), model="<synthetic>", msg_id="x", req="1"),
    ])

    out = collect.collect(30, home=home)

    assert out["rows"] == []


def test_claude_falls_back_to_last_prompt_for_title(home):
    _write_lines(os.path.join(home, ".claude", "projects", "-p", "s.jsonl"), [
        {"type": "last-prompt", "lastPrompt": "  로그인이  안 돼 \n 고쳐줘 "},
        _claude_assistant(_iso(1)),
    ])

    out = collect.collect(30, home=home)

    assert out["sessions"][0]["title"] == "로그인이 안 돼 고쳐줘"


def _codex_lines(stamps_and_totals, cwd="/home/u/app/proj", model="gpt-5"):
    lines = [{
        "type": "session_meta", "timestamp": _iso(2),
        "payload": {"session_id": "codex-1", "cwd": cwd},
    }, {
        "type": "turn_context", "timestamp": _iso(2), "payload": {"model": model},
    }]
    for stamp, total in stamps_and_totals:
        lines.append({
            "type": "event_msg", "timestamp": stamp,
            "payload": {"type": "token_count",
                        "info": {"total_token_usage": total}},
        })
    return lines


def test_codex_counts_deltas_not_cumulative_totals(home):
    """token_count 는 누적값이다 — 그대로 더하면 100+300+600=1000 이 된다."""
    path = os.path.join(home, ".codex", "sessions", "2026", "08", "01", "rollout-a.jsonl")
    _write_lines(path, _codex_lines([
        (_iso(1), {"input_tokens": 100, "cached_input_tokens": 0, "output_tokens": 10}),
        (_iso(1), {"input_tokens": 300, "cached_input_tokens": 100, "output_tokens": 30}),
        (_iso(1), {"input_tokens": 600, "cached_input_tokens": 100, "output_tokens": 60}),
    ]))

    out = collect.collect(30, home=home)

    rows = [r for r in out["rows"] if r["agent"] == "codex"]
    assert sum(r["input"] for r in rows) == 500      # 600 - 100(cached), 누적의 합이 아니다
    assert sum(r["cache_read"] for r in rows) == 100
    assert sum(r["output"] for r in rows) == 60
    assert rows[0]["model"] == "gpt-5"


def test_codex_uses_model_and_project(home):
    path = os.path.join(home, ".codex", "sessions", "2026", "08", "01", "rollout-b.jsonl")
    _write_lines(path, _codex_lines(
        [(_iso(1), {"input_tokens": 50, "cached_input_tokens": 0, "output_tokens": 5})],
        cwd="/srv/work/pawsport", model="gpt-5.6-sol",
    ))

    out = collect.collect(30, home=home)

    row = [r for r in out["rows"] if r["agent"] == "codex"][0]
    assert row["project"] == "pawsport"
    assert row["model"] == "gpt-5.6-sol"


def _opencode_db(home, rows):
    path = os.path.join(home, ".local", "share", "opencode", "opencode.db")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE session (
            id TEXT, title TEXT, directory TEXT, model TEXT, agent TEXT, cost REAL,
            tokens_input INT, tokens_output INT, tokens_cache_read INT,
            tokens_cache_write INT, time_updated INT
        )
    """)
    conn.executemany("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return path


def test_opencode_reads_session_table_and_keeps_its_own_cost(home):
    now_ms = int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp() * 1000)
    _opencode_db(home, [(
        "ses_1", "포트 정리", "/home/u/app/proj",
        '{"id":"glm-5.2","provider":"zai"}', "build", 1.25,
        1000, 200, 5000, 0, now_ms,
    )])

    out = collect.collect(30, home=home)

    row = [r for r in out["rows"] if r["agent"] == "opencode"][0]
    # model 칸이 JSON 이라 그대로 두면 같은 모델이 여러 줄로 갈라진다.
    assert row["model"] == "glm-5.2"
    # 자기 비용을 아는 소스는 그 값이 단가표를 이긴다.
    assert row["cost"] == 1.25
    assert out["sessions"][0]["title"] == "포트 정리"


def test_opencode_respects_window(home):
    old_ms = int((datetime.now(timezone.utc) - timedelta(days=40)).timestamp() * 1000)
    _opencode_db(home, [("ses_old", "옛날", "/p", "glm", "build", 9.0, 1, 1, 1, 0, old_ms)])

    out = collect.collect(7, home=home)

    assert [r for r in out["rows"] if r["agent"] == "opencode"] == []


def test_missing_home_dirs_are_not_an_error(home):
    out = collect.collect(30, home=home)

    assert out["ok"] is True
    assert out["rows"] == []
    assert out["sessions"] == []
    assert out["warnings"] == []


def test_broken_source_only_warns(home, monkeypatch):
    """한 에이전트의 사고가 나머지를 죽이면 안 된다."""
    _write_lines(os.path.join(home, ".claude", "projects", "-p", "s.jsonl"),
                 [_claude_assistant(_iso(1))])

    def boom(*args, **kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(collect, "_SOURCES",
                        (("claude", collect._collect_claude), ("opencode", boom)))

    out = collect.collect(30, home=home)

    assert out["ok"] is True
    assert sum(r["output"] for r in out["rows"]) == 20
    assert any("db exploded" in w for w in out["warnings"])


def test_days_zero_means_everything(home):
    _write_lines(os.path.join(home, ".claude", "projects", "-p", "s.jsonl"),
                 [_claude_assistant(_iso(400), msg_id="ancient", req="1")])

    out = collect.collect(0, home=home)

    assert sum(r["output"] for r in out["rows"]) == 20
