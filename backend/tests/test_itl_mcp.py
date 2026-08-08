"""Tests for the itl MCP server (§10.3).

Loads itl_mcp.py and itl_mcp_tools.py via importlib — backend/cli has no
__init__.py by design (mirrors backend/cli/itl, which is extensionless).
Each test that needs tool state uses the `mcp` fixture so monkeypatching
_api on the freshly-loaded tools module doesn't leak between tests.

We call `handle()` directly — no real HTTP, no stdin. The broken-JSON case
exercises the main() loop with a stubbed stdin.
"""
import email.message
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

CLI_DIR = Path(__file__).resolve().parent.parent / "cli"


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, CLI_DIR / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mcp(monkeypatch):
    """Load both modules fresh. Returns (itl_mcp, itl_mcp_tools).
    Tests patch _api / time on the tools module through this fixture."""
    sys.modules.pop("itl_mcp_tools", None)
    sys.modules.pop("itl_mcp", None)
    tools = _load("itl_mcp_tools", "itl_mcp_tools.py")
    server = _load("itl_mcp", "itl_mcp.py")
    # Tests don't want real tmux calls or sleeps.
    monkeypatch.setattr(tools.time, "sleep", lambda _s: None)
    return server, tools


class FakeApi:
    """Recording _api replacement. Dispatches by (method, path)."""

    def __init__(self):
        self.calls = []
        self.responses = {}  # (method, path) -> dict | Exception

    def __call__(self, method, path, params=None, body=None):
        self.calls.append((method, path, params, body))
        r = self.responses.get((method, path), {})
        if isinstance(r, Exception):
            raise r
        return r

    @property
    def posts(self):
        return [c for c in self.calls if c[0] == "POST"]


def _msg(method, msg_id=1, params=None, **extra):
    m = {"jsonrpc": "2.0", "id": msg_id, "method": method}
    if params is not None:
        m["params"] = params
    m.update(extra)
    return m


def _call(name, args, msg_id=1):
    return _msg("tools/call", msg_id, {"name": name, "arguments": args})


# --- protocol-layer cases (no _api needed) --------------------------------
def test_initialize_echoes_known_protocol_version(mcp):
    server, _ = mcp
    resp = server.handle(_msg("initialize", 1, {"protocolVersion": "2024-11-05"}))
    assert resp["result"]["protocolVersion"] == "2024-11-05"


def test_initialize_unknown_version_returns_latest(mcp):
    server, _ = mcp
    resp = server.handle(_msg("initialize", 1, {"protocolVersion": "2099-01-01"}))
    assert resp["result"]["protocolVersion"] == "2025-06-18"


def test_notifications_initialized_returns_none(mcp):
    """A message without `id` is a notification and must get NO response."""
    server, _ = mcp
    msg = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    assert server.handle(msg) is None


def test_tools_list_schema_well_formed(mcp):
    server, _ = mcp
    resp = server.handle(_msg("tools/list"))
    tools = resp["result"]["tools"]
    names = {t["name"] for t in tools}
    assert names == {"terminal_list", "terminal_whoami", "terminal_resolve",
                     "terminal_send", "terminal_read", "terminal_wait", "terminal_key"}
    for t in tools:
        assert isinstance(t["description"], str) and t["description"]
        schema = t["inputSchema"]
        assert schema["type"] == "object"
        assert "properties" in schema  # valid JSON Schema object


def test_unknown_method_returns_jsonrpc_error(mcp):
    server, _ = mcp
    resp = server.handle(_msg("bogus", 7))
    assert resp["error"]["code"] == -32601
    assert "id" in resp and resp["id"] == 7


def test_broken_json_returns_parse_error(mcp, monkeypatch, capsys):
    """main() loop catches JSONDecodeError and emits -32700."""
    server, _ = mcp
    monkeypatch.setattr(sys, "stdin", io.StringIO("this is not json\n"))
    server.main()
    out = capsys.readouterr().out.strip()
    payload = json.loads(out)
    assert payload["error"]["code"] == -32700
    assert payload["id"] is None


def test_tools_call_unknown_tool_is_error_not_jsonrpc(mcp):
    """Per spec: unknown tool is a model-recoverable failure, not protocol error."""
    server, _ = mcp
    resp = server.handle(_call("does_not_exist", {}))
    assert "error" not in resp
    assert resp["result"]["isError"] is True


# --- terminal_send behavior (self-exclusion, fanout guard) ----------------
def _target(addr, session_id="s-other", tmux_session=None):
    return {
        "addr": addr, "tabIndex": 1, "paneIndex": int(addr.split(".")[-1]),
        "sessionId": session_id, "tmuxSession": tmux_session or session_id,
        "command": "claude", "status": "idle",
    }


def test_terminal_send_excludes_self_by_default(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": [_target("1.1", "s-me")]}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_send", {"to": "1.1", "text": "hi"}))
    assert resp["result"]["isError"] is True  # everyone excluded -> nothing sent
    assert fake.posts == []  # no self-send


def test_terminal_send_fanout_blocked_without_confirm(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    # 6 targets — over FANOUT_CONFIRM_THRESHOLD (=5)
    matched = [_target(f"1.{i}", f"s{i}") for i in range(1, 7)]
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": matched}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_send", {"to": "@all", "text": "hi"}))
    # isError:false — this is guidance, not failure.
    assert resp["result"]["isError"] is False
    assert fake.posts == []  # never sent


def test_terminal_send_fanout_allowed_with_confirm(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    matched = [_target(f"1.{i}", f"s{i}") for i in range(1, 7)]
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": matched}
    fake.responses[("POST", "/api/itl/send")] = {
        "delivered": [{"addr": f"1.{i}", "sessionId": f"s{i}"} for i in range(1, 7)],
        "skipped": [],
    }
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_send", {
        "to": "@all", "text": "hi", "confirm_fanout": True,
    }))
    assert resp["result"]["isError"] is False
    assert len(fake.posts) == 1


# --- terminal_key behavior (mirrors terminal_send; §5.3 / §6.3) ------------
def test_terminal_key_happy_path(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": [_target("1.1", "s-other")]}
    fake.responses[("POST", "/api/itl/key")] = {
        "delivered": [{"addr": "1.1", "sessionId": "s-other"}],
        "skipped": [],
    }
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_key", {"to": "1.1", "key": "C-c"}))
    assert resp["result"]["isError"] is False
    assert "key → 1.1 (C-c)" in resp["result"]["content"][0]["text"]
    # Must POST to /key (not /send), body carries the key as-is.
    assert len(fake.posts) == 1
    method, path, _params, body = fake.posts[0]
    assert (method, path) == ("POST", "/api/itl/key")
    assert body["key"] == "C-c"


def test_terminal_key_fanout_blocked_without_confirm(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    matched = [_target(f"1.{i}", f"s{i}") for i in range(1, 7)]
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": matched}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_key", {"to": "@all", "key": "q"}))
    # isError:false — this is guidance, not failure (mirrors terminal_send guard).
    assert resp["result"]["isError"] is False
    assert fake.posts == []


# --- terminal_wait behavior ------------------------------------------------
def test_terminal_wait_immediate_satisfy_polls_once(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    fake = FakeApi()
    target = _target("2.1", "s-other")
    target["status"] = "idle"  # not_working satisfied
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": [target]}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_wait", {"to": "2.1", "timeout_sec": 5}))
    payload = json.loads(resp["result"]["content"][0]["text"])
    assert payload["reached"] is True
    assert payload["elapsed_sec"] == 0
    # One GET /resolve for setup, one for the first poll.
    assert sum(1 for c in fake.calls if c[0] == "GET") == 2


def test_terminal_wait_timeout_is_not_error(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    # Force monotonic clock to elapse past deadline on second read.
    times = iter([0.0, 0.0, 100.0, 100.0, 100.0, 100.0])
    monkeypatch.setattr(tools.time, "monotonic", lambda: next(times))
    fake = FakeApi()
    target = _target("2.1", "s-other")
    target["status"] = "working"  # never satisfies not_working
    fake.responses[("GET", "/api/itl/resolve")] = {"matched": [target]}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_wait", {"to": "2.1", "timeout_sec": 5, "until": "not_working"}))
    text = resp["result"]["content"][0]["text"]
    payload = json.loads(text.split("\n", 1)[0])  # tool appends '\n아직 working 중입니다...' suffix
    assert payload["reached"] is False
    assert resp["result"]["isError"] is False
    assert "아직 working 중입니다" in text


# --- §5.2 verbatim error text on transport failures ------------------------
# We patch urllib.request.urlopen (NOT _api) so the real _api wrapper runs and
# converts the raw HTTP/URL errors into ToolError with verbatim text. Patching
# _api would skip the very conversion we're verifying.
def _patch_urlopen(monkeypatch, exc):
    def _raise(*_a, **_kw):
        raise exc
    monkeypatch.setattr("urllib.request.urlopen", _raise)


def test_401_returns_verbatim_text(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "TOKEN", "leaked-but-invalid")
    _patch_urlopen(monkeypatch, urllib.error.HTTPError(
        "u", 401, "Unauthorized", hdrs=email.message.Message(), fp=io.BytesIO(b"{}"),
    ))
    resp = server.handle(_call("terminal_resolve", {"to": "1.1"}))
    assert resp["result"]["isError"] is True
    assert resp["result"]["content"][0]["text"] == \
        "인증이 만료됐습니다. 사용자에게 이 터미널을 새로 열어달라고 요청하세요."


def test_connection_failure_returns_verbatim_text(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "TOKEN", "set")
    _patch_urlopen(monkeypatch, urllib.error.URLError("connection refused"))
    resp = server.handle(_call("terminal_resolve", {"to": "1.1"}))
    assert resp["result"]["isError"] is True
    assert resp["result"]["content"][0]["text"] == \
        "백엔드에 연결할 수 없습니다 (http://127.0.0.1:38822): connection refused"


def test_missing_token_returns_verbatim_text(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "TOKEN", "")
    # If urlopen were called, this would explode the test — TOKEN check must
    # short-circuit first.
    def _no_http(*_a, **_kw):
        raise AssertionError("urlopen must not be called when TOKEN is empty")
    monkeypatch.setattr("urllib.request.urlopen", _no_http)
    resp = server.handle(_call("terminal_resolve", {"to": "1.1"}))
    assert resp["result"]["isError"] is True
    assert resp["result"]["content"][0]["text"] == \
        "ITL_TOKEN이 없습니다. 이 도구는 Terminal List가 만든 터미널 안에서만 동작합니다."


def test_429_returns_verbatim_rate_limit_sentence(mcp, monkeypatch):
    """Backend rate-limit (§6.4) surfaces as a model-recoverable sentence,
    not a protocol error. Verbatim text per team lead."""
    server, tools = mcp
    monkeypatch.setattr(tools, "TOKEN", "ok")
    monkeypatch.setattr(tools, "SESSION", "s-me")
    _patch_urlopen(monkeypatch, urllib.error.HTTPError(
        "u", 429, "Too Many Requests", hdrs=email.message.Message(), fp=io.BytesIO(b"{}"),
    ))
    resp = server.handle(_call("terminal_send", {"to": "1.1", "text": "hi"}))
    assert resp["result"]["isError"] is True
    assert resp["result"]["content"][0]["text"] == \
        "보내기가 너무 잦습니다(분당 30회). 루프에 빠진 게 아닌지 확인하세요."


# --- T10: every response, when JSON-encoded, has no literal newline --------
@pytest.mark.parametrize("scenario", [
    "initialize", "ping", "tools/list", "unknown_method", "unknown_tool",
    "terminal_resolve_multi_line", "terminal_send_blocked_guide",
    "terminal_key_blocked_guide",
])
def test_response_has_no_literal_newline(scenario, mcp, monkeypatch):
    """Line-delimited framing means json.dumps output must not contain a
    literal \\n character (escaped `\\n` inside strings is fine — that's two
    characters)."""
    server, tools = mcp
    fake = FakeApi()
    monkeypatch.setattr(tools, "_api", fake)
    monkeypatch.setattr(tools, "SESSION", "s-me")
    monkeypatch.setattr(tools, "TOKEN", "ok")

    resp = None
    if scenario == "initialize":
        resp = server.handle(_msg("initialize", 1, {"protocolVersion": "2024-11-05"}))
    elif scenario == "ping":
        resp = server.handle(_msg("ping", 1))
    elif scenario == "tools/list":
        resp = server.handle(_msg("tools/list", 1))
    elif scenario == "unknown_method":
        resp = server.handle(_msg("bogus", 1))
    elif scenario == "unknown_tool":
        resp = server.handle(_call("ghost", {}))
    elif scenario == "terminal_resolve_multi_line":
        # resolve output is multiple lines -> text contains \n which json.dumps escapes.
        fake.responses[("GET", "/api/itl/resolve")] = {
            "matched": [_target("1.1"), _target("1.2")],
        }
        resp = server.handle(_call("terminal_resolve", {"to": "@siblings"}))
    elif scenario == "terminal_send_blocked_guide":
        # Fanout guide message is itself multi-line.
        matched = [_target(f"1.{i}", f"s{i}") for i in range(1, 7)]
        fake.responses[("GET", "/api/itl/resolve")] = {"matched": matched}
        resp = server.handle(_call("terminal_send", {"to": "@all", "text": "x"}))
    elif scenario == "terminal_key_blocked_guide":
        matched = [_target(f"1.{i}", f"s{i}") for i in range(1, 7)]
        fake.responses[("GET", "/api/itl/resolve")] = {"matched": matched}
        resp = server.handle(_call("terminal_key", {"to": "@all", "key": "q"}))

    assert resp is not None
    encoded = json.dumps(resp, ensure_ascii=False)
    assert "\n" not in encoded, f"literal newline leaked into JSON for {scenario!r}"


def test_terminal_list_alone_exclude_self_returns_empty_sentence(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    monkeypatch.setattr(tools, "TOKEN", "ok")
    fake = FakeApi()
    fake.responses[("GET", "/api/itl/targets")] = {"table": "열려 있는 터미널이 없습니다."}
    monkeypatch.setattr(tools, "_api", fake)
    resp = server.handle(_call("terminal_list", {"include_self": False}))
    text = resp["result"]["content"][0]["text"]
    assert text == "열려 있는 터미널이 없습니다."
    sent_params = fake.calls[0][2]
    assert sent_params["exclude_self"] is True


def test_terminal_list_include_self_passes_exclude_self_false(mcp, monkeypatch):
    server, tools = mcp
    monkeypatch.setattr(tools, "SESSION", "s-me")
    monkeypatch.setattr(tools, "TOKEN", "ok")
    fake = FakeApi()
    fake.responses[("GET", "/api/itl/targets")] = {"table": "ADDR TAB ..."}
    monkeypatch.setattr(tools, "_api", fake)
    server.handle(_call("terminal_list", {"include_self": True}))
    sent_params = fake.calls[0][2]
    assert sent_params["exclude_self"] is False
