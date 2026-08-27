"""상태로 고르는 주소는 상태를 모르면 답할 수 없다 — 원격을 조용히 빼먹던 것.

원격 pane 의 status 는 백엔드 워처가 볼 수 없어(그 호스트의 tmux 다) 기본이 비어 있다.
그런데 `@working` 은 `t["status"] == "working"` 으로 고르므로 빈 값은 어떤 그룹에도 안
맞는다 → **원격이 통째로 빠진다.** 호출자는 그걸 "원격은 안 돌고 있다" 로 읽는다.
불완전한 답이 아니라 **틀린 답**이다.

같은 뿌리로 세 군데가 틀려 있었다:

1. `/api/itl/resolve` 는 `remote_status=1` 을 줘도 **채우기가 매칭 뒤**라 소용이 없었다.
   (`/api/itl/targets` 는 이미 "채우기가 필터보다 먼저" 였는데 여기만 반대.)
2. MCP `terminal_list` 스키마에 `remote_status` 인자가 **아예 없어서**, MCP 로 목록을
   부르는 에이전트는 원격을 영원히 `?` 로만 봤고 `status=working` 필터에서 전부 잃었다.
   (CLI 에는 `--remote` 가 있었다 — 세 층이 함께 움직여야 한다는 규칙이 깨진 자리.)
3. `terminal_wait` 의 첫 해석도 마찬가지라, `@working` 을 기다리면 원격이 안 잡혀
   `has_remote=False` 가 되고 로컬만 보고 즉시 끝났다.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from itl_targets import references_status_group, resolve

_ROOT = Path(__file__).resolve().parents[1]


def _t(addr, *, status="", session_id=None, tmux="mobile-abc", name="tab"):
    return {
        "addr": addr, "status": status, "command": "claude",
        "sessionId": session_id, "tmuxSession": tmux,
        "tabIndex": 1, "paneIndex": 1, "tabName": name, "cwd": "/",
    }


# --- 문법 쪽: 어떤 주소가 상태를 필요로 하는가 -------------------------------------

@pytest.mark.parametrize("expr", ["@working", "@idle", "@permission", "2.@working", "@here.@idle"])
def test_status_addresses_are_recognised(expr):
    assert references_status_group(expr) is True


@pytest.mark.parametrize("expr", [
    "3", "1.3", "@all", "@here", "@siblings", "@claude", "@frontend",
    "mobile-2b4a0a2ee6f8", None, "",
    "@workingset",            # 상태 낱말을 접두로 가진 탭 이름은 상태 그룹이 아니다
])
def test_other_addresses_are_not(expr):
    assert references_status_group(expr) is False


def test_a_remote_pane_with_no_status_never_matches_a_status_group():
    """이 테스트가 버그의 본체다 — 그래서 채우기가 매칭보다 먼저여야 한다."""
    remote = _t("1.1", status="", session_id=None)
    assert resolve([remote], "@working") == []
    remote_filled = _t("1.1", status="working", session_id=None)
    assert resolve([remote_filled], "@working") == [remote_filled]


# --- 계약 쪽: 세 층이 같이 움직이는가 ---------------------------------------------

def _mcp_schema(name):
    src = (_ROOT / "cli" / "itl_mcp.py").read_text(encoding="utf-8")
    i = src.index(f'"name": "{name}"')
    return src[i:i + 2500]


@pytest.mark.parametrize("tool", ["terminal_list", "terminal_resolve"])
def test_mcp_exposes_remote_status(tool):
    """노출하지 않으면 에이전트는 원격을 영원히 `?` 로만 본다 — 끌 방법도 켤 방법도 없이."""
    assert '"remote_status"' in _mcp_schema(tool), (
        f"{tool} 스키마에 remote_status 가 없다 — MCP 에이전트는 원격 상태를 못 묻는다"
    )


def test_the_cli_and_the_mcp_layer_both_have_the_knob():
    """CLI 에만 있고 MCP 에 없던 것이 이 버그였다. 세 층은 같이 움직인다."""
    cli = (_ROOT / "cli" / "itl").read_text(encoding="utf-8")
    tools = (_ROOT / "cli" / "itl_mcp_tools.py").read_text(encoding="utf-8")
    route = (_ROOT / "routes" / "itl.py").read_text(encoding="utf-8")
    assert "remote_status" in cli
    assert "remote_status" in tools
    assert "remote_status" in route


def test_every_layer_fills_remote_status_by_default():
    """거른 목록은 상태에 대한 단언이다 — 묻지도 않은 pane 을 두고 단언할 수 없다.

    한때는 옵트인이었다(채우기가 호스트당 SSH 왕복이던 시절). 지금은 메모리 조회라
    끌 이유가 없고, 꺼 두면 원격이 전부 `?` 로 보여 **고장으로 읽힌다.** 네 층이
    같이 움직여야 한다 — 한 곳만 옛 기본값으로 남으면 그 경로로 들어온 호출자만
    조용히 원격을 빼먹는다.
    """
    route = (_ROOT / "routes" / "itl.py").read_text(encoding="utf-8")
    assert route.count("remote_status: bool = Query(True)") == 2, (
        "/targets · /resolve 중 하나가 아직 기본 꺼짐이다")
    assert "remote_status: bool = Query(False)" not in route

    cli = (_ROOT / "cli" / "itl").read_text(encoding="utf-8")
    assert '"remote_status": "true"' in cli, "CLI 목록이 원격 상태를 안 채운다"

    tools = (_ROOT / "cli" / "itl_mcp_tools.py").read_text(encoding="utf-8")
    assert "def _resolve_targets(to, remote_status=True)" in tools
    body = tools[tools.index("def tool_terminal_list"):tools.index("def tool_terminal_whoami")]
    assert "True if remote_status is None else" in body, "MCP 목록이 기본으로 안 채운다"


def test_the_tool_description_says_question_mark_means_unknown():
    """에이전트가 `?` 를 '유휴'로 읽으면 이 수정이 통째로 무의미해진다."""
    src = (_ROOT / "cli" / "itl_mcp.py").read_text(encoding="utf-8")
    desc = src[src.index("DESC_LIST = "):src.index("DESC_WHOAMI = ")]
    assert "모름" in desc and "?" in desc


def test_the_resolve_route_fills_before_matching():
    """`/targets` 는 '채우기가 필터보다 먼저' 인데 `/resolve` 만 반대였다.

    한때 여기엔 갈래가 둘이었다(상태 주소면 전부 채우고, 아니면 맞은 것만). SSH 를
    아끼려던 것인데 아낄 게 없어졌고, **갈래가 둘이면 그중 하나만 틀리는 사고**가
    실제로 났다. 지금은 언제나 채우고 나서 맞춘다.
    """
    src = (_ROOT / "routes" / "itl.py").read_text(encoding="utf-8")
    body = src[src.index("async def itl_resolve"):src.index("async def itl_read")]
    assert body.index("_fill_remote_status") < body.index("resolve(targets, to, from_session)"), (
        "채우기가 매칭보다 뒤에 있다 — 상태 주소가 원격을 통째로 빼먹는다")
    assert body.count("_fill_remote_status") == 1, "채우는 갈래가 둘이면 하나만 틀린다"


def test_wait_fills_remote_status_before_matching():
    """`@working` 을 기다리는데 원격 상태를 안 채우면 0초에 '완료' 가 돌아온다.

    ⚠️ 판정이 MCP 클라이언트에서 **서버(`/api/itl/wait`)로 옮겨졌다** — 규칙은 그대로다:
    매칭 **전에** 채운다. 채우기가 뒤로 가면 원격은 status 가 비어 어떤 상태 그룹에도
    안 걸리고, 그러면 기다림이 대상 0개로 즉시 끝난다.
    """
    src = (_ROOT / "routes" / "itl.py").read_text(encoding="utf-8")
    body = src[src.index("async def itl_wait("):src.index("def _wait_reached(")]
    fill_at = body.index("_fill_remote_status")
    match_at = body.index("resolve(targets, to, from_session)")
    assert fill_at < match_at, "채우기가 매칭보다 뒤에 있다 — 원격이 통째로 빠진다"


def test_wait_never_counts_unknown_as_satisfied():
    """⚠️ 이 저장소가 세 번 밟은 사고. 원격 status 는 비어 있을 수 있고, 빈 값을
    '일 안 함' 으로 읽으면 기다림이 0초에 거짓 완료로 끝난다."""
    import importlib
    itl_route = importlib.import_module("routes.itl")
    assert itl_route._wait_reached({"statusUnknown": True}, "not_working") is False
    assert itl_route._wait_reached({"status": None}, "not_working") is False
    assert itl_route._wait_reached({"status": "working"}, "not_working") is False
    assert itl_route._wait_reached({"status": "idle"}, "not_working") is True
    # 사라진 pane 은 만족이다 — 세션이 끝난 것이므로.
    assert itl_route._wait_reached({"statusGone": True}, "not_working") is True


def test_the_schemas_are_still_valid_json_shaped():
    """스키마를 손으로 고쳤으니 구조가 안 깨졌는지 본다."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("itl_mcp_probe", _ROOT / "cli" / "itl_mcp.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for tool in mod.TOOLS:
        json.dumps(tool)                       # 직렬화 가능해야 JSON-RPC 로 나간다
        assert tool["inputSchema"]["type"] == "object"
        assert tool["inputSchema"]["additionalProperties"] is False
