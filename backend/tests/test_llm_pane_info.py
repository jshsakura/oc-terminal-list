import json
import sqlite3
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from llm_usage import pane_probe as probe
from routes import llm_usage as routes

THREAD = "11111111-2222-3333-4444-555555555555"


def write_log(path, events):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n")


def token_event(tokens=300, info=True):
    return {"type": "event_msg", "timestamp": "2026-11-05T01:00:00Z", "payload": {
        "type": "token_count",
        "info": {"total_token_usage": {"input_tokens": tokens, "output_tokens": 0},
                 "last_token_usage": {"total_tokens": 40}, "model_context_window": 200} if info else None,
        "rate_limits": {"primary": {"window_minutes": 10080, "used_percent": 35, "resets_at": 1800000000}},
    }}


def test_summary_uses_latest_totals_and_window_duration(tmp_path):
    path = tmp_path / "rollout.jsonl"
    write_log(path, [token_event(100), token_event(300), token_event(info=False),
                     {"type": "response_item", "payload": {"secret_chat": "never-return-this"}}])
    result = probe.summarize(path, {"id": THREAD, "model": "gpt-test", "reasoning_effort": "high"})
    assert result["input_tokens"] == 300
    assert result["output_tokens"] == 0
    assert result["context_tokens"] == 40
    assert result["context_window"] == 200
    assert result["limits"][0]["window_minutes"] == 10080
    assert result["limits"][0]["remaining_percent"] == 65
    assert "never-return-this" not in json.dumps(result)


def test_summary_missing_fields_are_not_zero_and_partial_line_is_ignored(tmp_path):
    path = tmp_path / "rollout.jsonl"
    write_log(path, [{"type": "turn_context", "payload": {"model": "updated-model", "effort": "xhigh"}}])
    with path.open("a") as stream:
        stream.write('{"partial":')
    result = probe.summarize(path, {"id": THREAD})
    assert result["model"] == "updated-model"
    assert result["effort"] == "xhigh"
    assert result["input_tokens"] is None
    assert result["limits"] == []


def test_tail_read_is_bounded(tmp_path, monkeypatch):
    path = tmp_path / "rollout.jsonl"
    write_log(path, [{"padding": "x" * 2000}, token_event()])
    monkeypatch.setattr(probe, "MAX_LOG_BYTES", 1024)
    assert probe.summarize(path, {"id": THREAD})["input_tokens"] == 300


def test_agent_detection_ignores_agents_spawned_as_tools(tmp_path):
    for pid, parent, argv in [(10, 1, ["zsh"]), (20, 10, ["node", "codex.js"]),
                              (30, 20, ["codex"]), (40, 30, ["bash"]), (50, 40, ["claude"])]:
        proc = tmp_path / str(pid)
        proc.mkdir()
        (proc / "stat").write_text(f"{pid} (process) S {parent} 0 0 0")
        (proc / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in argv))
        (proc / "cwd").symlink_to(tmp_path, target_is_directory=True)
    assert probe.find_agent(10, tmp_path)["pid"] == 30
    proc = tmp_path / "60"
    proc.mkdir()
    (proc / "stat").write_text("60 (process) S 10 0 0 0")
    (proc / "cmdline").write_bytes(b"codex\0")
    (proc / "cwd").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(OSError, match="Multiple agent processes"):
        probe.find_agent(10, tmp_path)


def test_rollout_cannot_escape_sessions_directory(tmp_path):
    with pytest.raises(ValueError):
        probe.safe_rollout(tmp_path, str(tmp_path / "auth.json"))
    (tmp_path / "sessions").mkdir()
    (tmp_path / "sessions/escape.jsonl").symlink_to(tmp_path / "outside.jsonl")
    with pytest.raises(ValueError):
        probe.safe_rollout(tmp_path, str(tmp_path / "sessions/escape.jsonl"))


@pytest.fixture
def probe_fixture(tmp_path, monkeypatch):
    path = tmp_path / "sessions/rollout.jsonl"
    write_log(path, [token_event()])
    row = {"id": THREAD, "rollout_path": str(path), "model": "gpt-test", "updated_at": 100,
           "reasoning_effort": "high"}
    monkeypatch.setattr(probe, "find_agent", lambda pid: {"pid": 20, "agent": "Codex", "cwd": "/work"})
    monkeypatch.setattr(probe, "codex_home", lambda pid: tmp_path)
    monkeypatch.setattr(probe, "candidates", lambda home, cwd: [row])
    monkeypatch.setattr(probe, "open_rollout", lambda home, pid: None)
    return path


def test_even_one_cwd_candidate_requires_selection(probe_fixture):
    result = probe.inspect_pane(10)
    assert result["status"] == "select_session"
    assert "usage" not in result
    assert "rollout_path" not in json.dumps(result)


def test_selection_is_tied_to_process_and_candidate(probe_fixture):
    assert probe.inspect_pane(10, THREAD, 20)["usage"]["input_tokens"] == 300
    assert probe.inspect_pane(10, THREAD, 21)["status"] == "select_session"
    assert probe.inspect_pane(10, "not-a-candidate", 20)["status"] == "session_unavailable"


def test_open_rollout_identifies_session_without_manual_selection(probe_fixture, monkeypatch):
    monkeypatch.setattr(probe, "open_rollout", lambda home, pid: probe_fixture)
    result = probe.inspect_pane(10)
    assert result["status"] == "ready"
    assert result["match"] == "process"


def test_candidate_query_scopes_cwd_and_excludes_archived_and_subagents(tmp_path):
    with sqlite3.connect(tmp_path / "state_5.sqlite") as conn:
        conn.execute("CREATE TABLE threads (id TEXT, rollout_path TEXT, model TEXT, reasoning_effort TEXT, "
                     "updated_at INTEGER, updated_at_ms INTEGER, cwd TEXT, archived INTEGER, source TEXT)")
        conn.executemany("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?)", [
            (THREAD, "one.jsonl", "model", "high", 1, 1000, "/work", 0, "cli"),
            ("foreign", "two.jsonl", "model", "high", 2, 2000, "/other", 0, "cli"),
            ("archived", "three.jsonl", "model", "high", 3, 3000, "/work", 1, "cli"),
            ("child", "four.jsonl", "model", "high", 4, 4000, "/work", 0, "subagent"),
        ])
    assert [row["id"] for row in probe.candidates(tmp_path, "/work")] == [THREAD]


@pytest.fixture
def api(monkeypatch):
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.verify_auth_token] = lambda: "owner"
    monkeypatch.setattr(routes.storage, "get_session_owner", AsyncMock(return_value="owner"))
    monkeypatch.setattr(routes, "get_config", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(routes, "check_rate_limit", Mock())
    monkeypatch.setattr(routes.tmux_manager, "_run", AsyncMock(return_value=(0, "10\tCurrent | work\n", "")))
    monkeypatch.setattr(routes.pane_probe, "inspect_pane", Mock(return_value={"status": "no_agent"}))
    return TestClient(app)


@pytest.mark.parametrize("owner", [None, "someone-else"])
def test_route_rejects_unowned_sessions_before_probe(api, monkeypatch, owner):
    monkeypatch.setattr(routes.storage, "get_session_owner", AsyncMock(return_value=owner))
    assert api.get("/api/llm-usage/pane?session_id=safe-session").status_code == 403
    routes.pane_probe.inspect_pane.assert_not_called()


def test_disabled_integration_does_not_inspect_process_or_logs(api, monkeypatch):
    monkeypatch.setattr(routes, "get_config", AsyncMock(return_value={"enabled": False}))
    assert api.get("/api/llm-usage/pane?session_id=safe-session").json() == {"status": "disabled"}
    routes.tmux_manager._run.assert_not_awaited()
    routes.pane_probe.inspect_pane.assert_not_called()


def test_disabled_integration_does_not_resolve_or_connect_remote_host(api, monkeypatch):
    monkeypatch.setattr(routes, "get_config", AsyncMock(return_value={"enabled": False}))
    resolve = AsyncMock()
    run = AsyncMock()
    monkeypatch.setattr(routes, "resolve_host_with_secrets", resolve)
    monkeypatch.setattr(routes, "run_remote_cmd_full", run)
    assert api.get("/api/llm-usage/pane?host_id=host-1&tmux_session=work").json() == {"status": "disabled"}
    resolve.assert_not_awaited()
    run.assert_not_awaited()


def test_owned_session_uses_exact_tmux_target(api):
    assert api.get("/api/llm-usage/pane?session_id=safe-session").json() == {"status": "no_agent"}
    routes.tmux_manager._run.assert_awaited_once_with(
        "display-message", "-p", "-t", "=safe-session:", "#{pane_pid}\t#{pane_title}", check=False,
    )
    routes.pane_probe.inspect_pane.assert_called_once_with(10, None, None, "Current | work", False)


def test_remote_probe_uses_owned_host_and_quotes_session(api, monkeypatch):
    resolve = AsyncMock(return_value=({"id": "host-1"}, {}))
    run = AsyncMock(return_value=(0, 'banner\n' + probe.OUTPUT_MARKER + '{"status":"no_agent"}', ''))
    monkeypatch.setattr(routes, "resolve_host_with_secrets", resolve)
    monkeypatch.setattr(routes, "run_remote_cmd_full", run)
    response = api.get("/api/llm-usage/pane", params={"host_id": "host-1", "tmux_session": "work'quote"})
    assert response.json() == {"status": "no_agent"}
    resolve.assert_awaited_once_with("host-1", "owner")
    assert "'work'\\''quote'" in run.call_args.args[2]
    assert "def inspect_pane" in run.call_args.kwargs["stdin_data"]


def test_remote_failure_is_not_reported_as_success(api, monkeypatch):
    monkeypatch.setattr(routes, "resolve_host_with_secrets", AsyncMock(return_value=({"id": "host-1"}, {})))
    monkeypatch.setattr(routes, "run_remote_cmd_full", AsyncMock(return_value=(
        1, probe.OUTPUT_MARKER + '{"status":"ready"}', 'failed',
    )))
    response = api.get("/api/llm-usage/pane?host_id=host-1&tmux_session=work")
    assert response.json() == {"status": "unavailable"}


def test_thread_selection_requires_process_identity(api):
    response = api.get("/api/llm-usage/pane", params={"session_id": "safe-session", "thread_id": THREAD})
    assert response.status_code == 400
    routes.pane_probe.inspect_pane.assert_not_called()


def named_threads(home, path):
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        conn.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, model TEXT, reasoning_effort TEXT, "
                     "updated_at INTEGER, cwd TEXT, archived INTEGER, source TEXT, name TEXT)")
        conn.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?)",
                     (THREAD, str(path), "gpt-test", "high", 1, "/work", 0, "cli", "Current"))


@pytest.mark.parametrize("title", ["Current | work", "⠋ Current | work", "⣿ Current | work"])
def test_current_title_opens_usage_without_selection(probe_fixture, title):
    named_threads(probe_fixture.parent.parent, probe_fixture)
    result = probe.inspect_pane(10, pane_title=title, current_only=True)
    assert result["status"] == "ready"
    assert result["match"] == "title"
    assert result["usage"]["thread_id"] == THREAD
    assert result["usage"]["input_tokens"] == 300


def test_title_lookup_can_find_current_session_outside_recent_candidates(probe_fixture, monkeypatch):
    named_threads(probe_fixture.parent.parent, probe_fixture)
    monkeypatch.setattr(probe, "candidates", lambda home, cwd: [])
    result = probe.inspect_pane(10, pane_title="Current | work", current_only=True)
    assert result["usage"]["thread_id"] == THREAD


def test_same_process_switch_overrides_old_selection(probe_fixture):
    home = probe_fixture.parent.parent
    named_threads(home, probe_fixture)
    other_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    other = home / "sessions/new.jsonl"
    write_log(other, [token_event(900)])
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        conn.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?)",
                     (other_id, str(other), "new-model", "low", 2, "/work", 0, "cli", "New session"))
    first = probe.inspect_pane(10, pane_title="Current | work", current_only=True)
    second = probe.inspect_pane(10, THREAD, 20, "New session | work", True)
    assert first["usage"]["thread_id"] == THREAD
    assert second["usage"]["thread_id"] == other_id
    assert second["usage"]["input_tokens"] == 900


def test_duplicate_names_do_not_choose_the_recent_or_cached_session(probe_fixture):
    home = probe_fixture.parent.parent
    named_threads(home, probe_fixture)
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        conn.execute("INSERT INTO threads SELECT 'duplicate', rollout_path, model, reasoning_effort, 999, "
                     "cwd, archived, source, name FROM threads")
    result = probe.inspect_pane(10, THREAD, 20, "Current | work", True)
    assert result["status"] == "session_unmatched"
    assert "usage" not in result
    assert "sessions" not in result


@pytest.mark.parametrize("title", ["Current", "Current | other", "Cur | work", "Current extra | work", " | work"])
def test_title_matching_requires_exact_name_and_directory(probe_fixture, title):
    named_threads(probe_fixture.parent.parent, probe_fixture)
    assert probe.inspect_pane(10, THREAD, 20, title, True)["status"] == "session_unmatched"


def test_title_query_scopes_directory_and_excludes_archived_and_subagents(probe_fixture):
    home = probe_fixture.parent.parent
    named_threads(home, probe_fixture)
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        for id_, cwd, archived, source in [("other", "/other", 0, "cli"), ("archived", "/work", 1, "cli"),
                                           ("child", "/work", 0, "subagent")]:
            conn.execute("INSERT INTO threads SELECT ?, rollout_path, model, reasoning_effort, 999, ?, ?, ?, name "
                         "FROM threads WHERE id=?", (id_, cwd, archived, source, THREAD))
    assert probe.titled_session(home, "/work", "Current | work")["id"] == THREAD


def test_title_query_binds_names_with_quotes_and_delimiters(probe_fixture):
    home = probe_fixture.parent.parent
    named_threads(home, probe_fixture)
    name = "Team's task | details"
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        conn.execute("UPDATE threads SET name=?", (name,))
    assert probe.titled_session(home, "/work", name + " | work")["id"] == THREAD


def test_older_database_without_names_remains_compatible(probe_fixture):
    home = probe_fixture.parent.parent
    with sqlite3.connect(home / "state_5.sqlite") as conn:
        conn.execute("CREATE TABLE threads (id TEXT)")
    assert probe.titled_session(home, "/work", "Current | work") is None
    assert probe.inspect_pane(10, THREAD, 20)["usage"]["thread_id"] == THREAD


def test_current_only_route_passes_live_title_without_a_chosen_thread(api):
    assert api.get("/api/llm-usage/pane?session_id=safe-session&current_only=true").status_code == 200
    routes.pane_probe.inspect_pane.assert_called_once_with(10, None, None, "Current | work", True)


def test_remote_current_only_option_reaches_the_remote_probe(api, monkeypatch):
    monkeypatch.setattr(routes, "resolve_host_with_secrets", AsyncMock(return_value=({"id": "host-1"}, {})))
    run = AsyncMock(return_value=(0, probe.OUTPUT_MARKER + '{"status":"session_unmatched"}', ''))
    monkeypatch.setattr(routes, "run_remote_cmd_full", run)
    response = api.get("/api/llm-usage/pane?host_id=host-1&tmux_session=work&current_only=true")
    assert response.json()["status"] == "session_unmatched"
    assert "--current-only" in run.call_args.args[2]
    assert r"#{pane_pid}\t#{pane_title}" in run.call_args.kwargs["stdin_data"]
