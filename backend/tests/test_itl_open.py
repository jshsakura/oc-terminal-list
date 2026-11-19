"""`itl open` / `itl spotlight` and the Terminator MCP server."""
from __future__ import annotations

import asyncio
import importlib.machinery
import importlib.util
import json
import shlex
import sys
from pathlib import Path

import pytest

import itl_open
from itl_open import OpenFailed, launch_line, new_tab, parse_open

REPO = Path(__file__).resolve().parents[2]
TERMINATOR = REPO / "backend" / "cli" / "terminator"


def _load_cli():
    loader = importlib.machinery.SourceFileLoader("itl_cli_open", str(REPO / "backend" / "cli" / "itl"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def _load_mcp():
    spec = importlib.util.spec_from_file_location("terminator_mcp", TERMINATOR / "terminator_mcp.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ─── parse_open ──────────────────────────────────────────────────────────────

def test_accepts_a_whitelisted_tool_and_fills_the_name():
    spec = parse_open({"op": "open", "tool": "codex", "prompt": "fix it", "branch": "fix/login"})
    assert spec == {"tool": "codex", "branch": "fix/login", "prompt": "fix it", "name": "codex", "cwd": ""}


@pytest.mark.parametrize("data, why", [
    ({"tool": "bash", "prompt": "x"}, "tool"),
    ({"tool": "codex", "prompt": "  "}, "prompt"),
    ({"tool": "codex", "prompt": "x" * (itl_open.MAX_PROMPT_CHARS + 1)}, "길다"),
    ({"tool": "codex", "prompt": "x", "branch": "main"}, "branch"),
    ({"tool": "codex", "prompt": "x", "branch": "master"}, "branch"),
    ({"tool": "codex", "prompt": "x", "branch": "-rf"}, "branch"),
    ({"tool": "codex", "prompt": "x", "branch": "a..b"}, "branch"),
    ({"tool": "codex", "prompt": "x", "branch": "x; rm -rf ~"}, "branch"),
])
def test_refuses_what_it_must_not_run(data, why):
    with pytest.raises(OpenFailed, match=why):
        parse_open(data)


def test_strips_control_characters_from_the_tab_name():
    assert parse_open({"tool": "claude", "prompt": "x", "name": "리뷰\n\x1b[31m"})["name"] == "리뷰  [31m"


# ─── launch line ─────────────────────────────────────────────────────────────

def test_the_launch_line_passes_the_prompt_as_a_file_never_inline(tmp_path):
    prompt_file = tmp_path / "p.md"
    line = launch_line({"tool": "codex", "branch": "", "prompt": "'; rm -rf ~ #"}, prompt_file)
    assert "rm -rf" not in line
    assert line == f'codex --yolo "$(cat {shlex.quote(str(prompt_file))})"'


def test_the_launch_line_switches_or_creates_the_branch_first(tmp_path):
    line = launch_line({"tool": "claude", "branch": "fix/a", "prompt": "x"}, tmp_path / "p.md")
    assert line.startswith("{ git switch fix/a 2>/dev/null || git switch -c fix/a; } && claude ")


# ─── tab shape ───────────────────────────────────────────────────────────────

def test_new_tab_matches_the_frontend_local_tab_and_takes_a_free_number():
    tabs = [{"id": "a", "addressNumber": 1}, {"id": "b", "addressNumber": 3}]
    tab = new_tab(tabs, session_id="s1", rel_cwd="mood-clicker", name="개발", next_number=3)
    pane = tab["panes"][0]
    assert tab["type"] == "local" and tab["sessionId"] == "s1"
    assert tab["addressNumber"] == 4
    assert pane == {"id": pane["id"], "sessionId": "s1", "cwd": "mood-clicker", "addressNumber": 1}
    assert tab["splitTree"] == {"type": "pane", "paneId": pane["id"]}
    assert tab["activePaneId"] == pane["id"]


def test_rate_limit_counts_per_user():
    itl_open._opens.clear()
    for i in range(itl_open.RATE_MAX_OPENS):
        assert itl_open.rate_ok("u", now=100.0 + i)
    assert not itl_open.rate_ok("u", now=110.0)
    assert itl_open.rate_ok("other", now=110.0)
    assert itl_open.rate_ok("u", now=100.0 + itl_open.RATE_WINDOW_SEC + 10)


def test_cwd_must_stay_inside_the_workspace(tmp_path, monkeypatch):
    import _deps
    (tmp_path / "proj").mkdir()
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(tmp_path))
    assert itl_open.resolve_cwd("proj") == ((tmp_path / "proj").resolve(), "proj")
    assert itl_open.resolve_cwd(str(tmp_path / "proj"))[1] == "proj"
    assert itl_open.resolve_cwd("")[1] == ""
    with pytest.raises(OpenFailed):
        itl_open.resolve_cwd("../etc")
    with pytest.raises(OpenFailed):
        itl_open.resolve_cwd("missing")


# ─── outbox dispatch ─────────────────────────────────────────────────────────

def test_outbox_recognises_app_ops_and_leaves_sends_alone():
    assert itl_open.is_open_request(json.dumps({"op": "open", "tool": "codex"}))["op"] == "open"
    assert itl_open.is_open_request(json.dumps({"op": "spotlight", "id": "settings"}))["op"] == "spotlight"
    assert itl_open.is_open_request(json.dumps({"to": "1.1", "text": "hi"})) is None
    assert itl_open.is_open_request("not json") is None


def test_ui_action_broadcasts_only_whitelisted_actions(monkeypatch):
    sent = []
    import sse_broadcast
    monkeypatch.setattr(sse_broadcast, "_broadcast_sse", lambda payload, user: sent.append((payload, user)))
    assert itl_open.is_open_request(json.dumps({"op": "action", "action": "split-right"}))["op"] == "action"
    assert itl_open.ui_action("u", {"action": "split-down"})
    assert not itl_open.ui_action("u", {"action": "rm -rf"})
    assert sent == [({"type": "uiAction", "action": "split-down"}, "u")]


def test_cli_and_backend_agree_on_the_ui_actions():
    import importlib.machinery, importlib.util
    from pathlib import Path
    path = str(Path(__file__).resolve().parents[1] / "cli" / "itl")
    spec = importlib.util.spec_from_loader("itl_cli_actions", importlib.machinery.SourceFileLoader("itl_cli_actions", path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert set(mod.UI_ACTIONS) == set(itl_open.UI_ACTIONS)


def test_spotlight_broadcasts_only_an_id_shaped_value(monkeypatch):
    import sse_broadcast
    sent = []
    monkeypatch.setattr(sse_broadcast, "_broadcast_sse", lambda payload, user=None: sent.append((payload, user)))
    assert itl_open.spotlight("u", {"id": "pane-more"})
    assert not itl_open.spotlight("u", {"id": "<img src=x>"})
    assert sent == [({"type": "spotlight", "id": "pane-more"}, "u")]


def test_a_failed_open_still_answers_the_waiting_cli(monkeypatch):
    import itl_router
    receipts = []

    async def record(username, sender, host, receipt):
        receipts.append(receipt)

    monkeypatch.setattr(itl_router, "_record_delivery", record)
    asyncio.run(itl_open.open_from_pane("u", "sess", {"op": "open", "tool": "rm", "prompt": "x", "n": "abcdef12"}))
    assert receipts == [{"ok": False, "requestId": "abcdef12", "delivery": "failed",
                         "error": receipts[0]["error"]}]
    assert "tool" in receipts[0]["error"]


# ─── CLI ─────────────────────────────────────────────────────────────────────

def test_terminator_is_resolved_by_role_not_by_number(monkeypatch):
    cli = _load_cli()
    panes = [cli.pane_record("tmux", "/s", "a", "%1"), cli.pane_record("tmux", "/s", "b", "%2")]
    monkeypatch.setattr(cli, "tmux_bin", lambda: "tmux")
    monkeypatch.setattr(cli, "run", lambda argv, **kw: (0, "%1\t\n%2\tterminator\n", ""))
    pane, why = cli.resolve(panes, "terminator")
    assert pane["native_id"] == "%2" and why == ""


def test_two_terminators_are_an_error_not_a_guess(monkeypatch):
    cli = _load_cli()
    panes = [cli.pane_record("tmux", "/s", "a", "%1"), cli.pane_record("tmux", "/s", "b", "%2")]
    monkeypatch.setattr(cli, "tmux_bin", lambda: "tmux")
    monkeypatch.setattr(cli, "run", lambda argv, **kw: (0, "%1\tterminator\n%2\tterminator\n", ""))
    pane, why = cli.resolve(panes, "terminator")
    assert pane is None and "여럿" in why


# ─── MCP server ──────────────────────────────────────────────────────────────

def test_mcp_lists_every_tool_and_marks_the_read_only_ones():
    mcp = _load_mcp()
    resp = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tools = {t["name"]: t for t in resp["result"]["tools"]}
    assert set(tools) == {"terminals", "read_terminal", "guide", "roles", "open_worker", "send", "spotlight", "act"}
    assert {n for n, t in tools.items() if t.get("annotations", {}).get("readOnlyHint")} == {
        "terminals", "read_terminal", "guide", "roles"}


def test_every_spotlight_id_in_the_guide_is_a_valid_id():
    mcp = _load_mcp()
    ids = mcp.guide_targets()
    assert "settings" in ids and "pane-more" in ids
    assert all(itl_open.SPOTLIGHT_ID_RE.match(i) for i in ids)


def test_every_role_runs_on_a_tool_the_backend_can_launch():
    roles = json.loads((TERMINATOR / "roles.json").read_text(encoding="utf-8"))["roles"]
    assert roles and all(r["tool"] in itl_open.LAUNCH for r in roles)


def test_mcp_guide_answers_only_from_the_guide():
    mcp = _load_mcp()
    resp = mcp.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": "guide", "arguments": {"topic": "없는 항목"}}})
    assert resp["result"]["isError"] is True


def test_open_worker_pipes_the_task_on_stdin_not_argv(monkeypatch):
    mcp = _load_mcp()
    seen = {}

    def fake(*args, stdin=None):
        seen["args"], seen["stdin"] = args, stdin
        return 0, {"ok": True, "addr": "3.1"}

    monkeypatch.setattr(mcp, "itl", fake)
    is_error, value = mcp.t_open_worker({"tool": "codex", "task": "secret long task", "branch": "fix/a"})
    assert not is_error and value["addr"] == "3.1"
    assert "secret long task" not in seen["args"] and seen["stdin"] == "secret long task"
    assert seen["args"][:2] == ("open", "--tool") and "--branch" in seen["args"]


def test_the_mcp_file_is_not_named_like_the_removed_one():
    # agent_mcp_cleanup deletes config entries whose args end with itl_mcp.py.
    assert not (TERMINATOR / "terminator_mcp.py").name.endswith("itl_mcp.py")
    assert sys.version_info >= (3, 9)
