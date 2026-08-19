"""에이전트 MCP 자동 등록 — 남의 설정 파일을 다루는 코드의 계약.

이 모듈이 만지는 파일은 우리 것이 아니다(온보딩 플래그·프로젝트별 기록이 함께 있는
큰 JSON). 그래서 잠글 것은 "등록이 되는가" 보다 **무엇을 절대 하지 않는가** 다:
사람이 손으로 쓴 항목을 덮지 않고, 못 읽는 파일을 새로 짓지 않고, 실패해도 원본이
그대로 남는다.
"""
from __future__ import annotations

import json

import agent_mcp as sut


def test_entry_carries_no_token():
    """토큰은 pane 환경에 있다 — 설정 파일에 복사하면 세션보다 오래 남는다."""
    entry = sut.mcp_entry("/repo/backend/cli/itl_mcp.py")
    flat = json.dumps(entry)
    assert "ITL_TOKEN" not in flat and "eyJ" not in flat
    assert entry["command"] == "python3"
    assert entry["args"] == ["/repo/backend/cli/itl_mcp.py"]


def test_registers_into_user_scope_without_touching_the_rest():
    config = {"numStartups": 7, "projects": {"/a": {}}, "mcpServers": {"other": {"command": "x"}}}
    entry = sut.mcp_entry("/repo/cli/itl_mcp.py")
    updated = sut.merged_config(config, entry)
    assert updated["mcpServers"]["itl"] == entry
    assert updated["mcpServers"]["other"] == {"command": "x"}
    assert updated["numStartups"] == 7 and updated["projects"] == {"/a": {}}
    # 원본은 그대로 — 쓰기가 실패하면 호출부가 이것을 계속 들고 있어야 한다.
    assert "itl" not in config["mcpServers"]


def test_already_correct_is_not_a_write():
    entry = sut.mcp_entry("/repo/cli/itl_mcp.py")
    assert sut.merged_config({"mcpServers": {"itl": entry}}, entry) is None


def test_a_stale_entry_of_ours_is_refreshed():
    """저장소를 옮기면 옛 경로가 남는다 — 우리 것이면 고쳐 준다."""
    old = sut.mcp_entry("/old/path/itl_mcp.py")
    new = sut.mcp_entry("/new/path/itl_mcp.py")
    updated = sut.merged_config({"mcpServers": {"itl": old}}, new)
    assert updated["mcpServers"]["itl"] == new


def test_a_hand_written_entry_is_left_alone():
    """사람이 래퍼나 다른 인터프리터를 일부러 쓴 것일 수 있다."""
    theirs = {"command": "uv", "args": ["run", "my-itl-wrapper"]}
    assert sut.merged_config({"mcpServers": {"itl": theirs}}, sut.mcp_entry("/x/itl_mcp.py")) is None


def test_missing_config_is_not_created(tmp_path):
    """설정이 없다 = 그 기계에서 에이전트를 쓴 적이 없다. 우리가 지어 주면 그 에이전트의
    온보딩이 가장 먼저 덮어쓴다."""
    assert sut.ensure_local_agent_mcp(home=str(tmp_path)) is False
    assert not (tmp_path / ".claude.json").exists()


def test_unreadable_config_is_left_untouched(tmp_path):
    path = tmp_path / ".claude.json"
    path.write_text("{ this is not json", encoding="utf-8")
    assert sut.ensure_local_agent_mcp(home=str(tmp_path)) is False
    assert path.read_text(encoding="utf-8") == "{ this is not json"


def test_local_registration_round_trip(tmp_path):
    path = tmp_path / ".claude.json"
    path.write_text(json.dumps({"numStartups": 3, "mcpServers": {"context7": {"command": "c7"}}}),
                    encoding="utf-8")
    assert sut.ensure_local_agent_mcp(home=str(tmp_path)) is True
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["numStartups"] == 3
    assert saved["mcpServers"]["context7"] == {"command": "c7"}
    assert saved["mcpServers"]["itl"]["args"][0].endswith("itl_mcp.py")
    # 두 번째 호출은 아무것도 쓰지 않는다 — 세션마다 파일을 흔들지 않는다.
    assert sut.ensure_local_agent_mcp(home=str(tmp_path)) is False


def test_the_switch_turns_it_off(tmp_path, monkeypatch):
    path = tmp_path / ".claude.json"
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("ITL_AUTO_MCP", "0")
    assert sut.ensure_local_agent_mcp(home=str(tmp_path)) is False
    assert path.read_text(encoding="utf-8") == "{}"


def test_remote_script_expands_home_itself():
    """`$HOME` 리터럴은 설정을 읽는 에이전트가 풀어 주지 않는다 — 원격이 직접 편다."""
    assert sut.remote_mcp_entry()["args"] == ["~/.local/bin/itl_mcp.py"]
    cmd = sut.build_remote_mcp_cmd()
    assert "expanduser" in cmd
    assert "os.replace(tmp, path)" in cmd          # 원격도 원자적 교체
    assert "MCP_USER_OWNED" in cmd                 # 손으로 쓴 항목 보호도 원격에 있다
