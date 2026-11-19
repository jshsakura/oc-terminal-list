"""Terminator panel API: conversation parsing, session naming, login detection."""
from __future__ import annotations

import json

from _deps import is_safe_id
from routes import terminator as t


def _line(**entry):
    return json.dumps(entry, ensure_ascii=False)


def test_conversation_keeps_what_was_said_and_done_and_drops_the_rest():
    lines = [
        _line(type="user", uuid="u1", message={"content": "로그인 버튼 색 바꿔줘"}),
        _line(type="assistant", uuid="a1", message={"content": [
            {"type": "thinking", "thinking": "hidden"},
            {"type": "text", "text": "개발 담당에게 맡기겠습니다."},
            {"type": "tool_use", "name": "mcp__terminator__open_worker", "input": {"tool": "codex", "name": "개발"}},
        ]}),
        _line(type="user", uuid="r1", message={"content": [{"type": "tool_result", "content": "{}"}]}),
        _line(type="user", uuid="m1", isMeta=True, message={"content": "meta"}),
        _line(type="user", uuid="c1", message={"content": "<command-name>/clear</command-name>"}),
        _line(type="user", uuid="w1",
              message={"content": "[from 2.1 · 답장: itl send 2.1 '…'] [개발] 색을 바꿨습니다"}),
        "not json",
        _line(type="attachment", uuid="x"),
    ]
    items = t.parse_transcript(lines)
    assert [(i["role"], i["text"]) for i in items] == [
        ("user", "로그인 버튼 색 바꿔줘"),
        ("assistant", "개발 담당에게 맡기겠습니다."),
        ("tool", "탭 열기 · 개발"),
        ("report", "[개발] 색을 바꿨습니다"),
    ]
    assert items[3]["from"] == "2.1"


def test_conversation_is_capped_to_the_latest_messages():
    lines = [_line(type="user", uuid=str(n), message={"content": f"m{n}"}) for n in range(t.MAX_MESSAGES + 10)]
    items = t.parse_transcript(lines)
    assert len(items) == t.MAX_MESSAGES and items[-1]["text"] == f"m{t.MAX_MESSAGES + 9}"


def test_one_terminator_per_user_with_a_safe_session_id():
    a, b = t.session_name("alice"), t.session_name("bob")
    assert a != b and a == t.session_name("alice")
    assert is_safe_id(a) and a.startswith("terminator-")


def test_login_state_only_checks_that_files_exist(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert t.login_state() == {"claude": False, "codex": False, "opencode": False, "github": False}
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex" / "auth.json").write_text("{}")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    assert t.login_state() == {"claude": True, "codex": True, "opencode": False, "github": False}


def test_transcript_lookup_refuses_anything_but_a_uuid(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    tid = "0b2a4f6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b"
    d = tmp_path / ".claude" / "projects" / "-workspace"
    d.mkdir(parents=True)
    (d / f"{tid}.jsonl").write_text("")
    assert t.transcript_path(tid) == d / f"{tid}.jsonl"
    assert t.transcript_path("../../etc/passwd") is None
    assert t.transcript_path("*") is None


def test_launcher_execs_claude_so_the_pane_does_not_look_idle():
    # The backend reads "running" from the pane's foreground command. If the launcher stays
    # as `sh` with claude as a child, every panel open types the launch line into the chat.
    from pathlib import Path
    launcher = (Path(__file__).resolve().parents[1] / "cli" / "terminator" / "terminator").read_text()
    assert "exec claude " in launcher
    assert "mktemp" not in launcher and "trap " not in launcher


def test_tool_items_say_whether_routing_worked_and_where_it_went():
    from routes.terminator import parse_transcript
    lines = [
        _line(type="assistant", uuid="a1", message={"content": [
            {"type": "tool_use", "id": "t1", "name": "mcp__terminator__open_worker", "input": {"tool": "claude"}},
            {"type": "tool_use", "id": "t2", "name": "mcp__terminator__send", "input": {"to": "9.9"}},
        ]}),
        _line(type="user", uuid="u1", message={"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": '{"ok": true, "addr": "3.1", "delivery": "opened"}'}]},
            {"type": "tool_result", "tool_use_id": "t2", "is_error": True, "content": '{"ok": false, "error": "그런 팬이 없다"}'},
        ]}),
    ]
    tools = [m for m in parse_transcript(lines) if m["role"] == "tool"]
    assert [(t["ok"], t["detail"]) for t in tools] == [(True, "3.1"), (False, "그런 팬이 없다")]
    # The tool result itself never shows up as a user bubble.
    assert all(m["role"] == "tool" for m in parse_transcript(lines))


def test_context_used_is_the_latest_request_total():
    from routes.terminator import context_used
    lines = [
        _line(type="assistant", message={"content": [], "usage": {"input_tokens": 5, "cache_read_input_tokens": 100}}),
        _line(type="assistant", message={"content": [], "usage": {"input_tokens": 7, "cache_read_input_tokens": 1600,
                                                                   "cache_creation_input_tokens": 30}}),
    ]
    assert context_used(lines) == 1637
    assert context_used([]) is None
