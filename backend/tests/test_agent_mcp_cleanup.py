"""itl 을 없앨 때 에이전트 설정에 남는 죽은 MCP 항목을 걷어낸다.

안 지우면 이 기계에서 에이전트를 띄울 때마다 지워진 파일을 가리키는 서버가 뜨려다
실패한다 — 앱은 조용해지는데 사용자 쪽에 매 세션 오류가 하나씩 남는다.
"""
import json

import agent_mcp_cleanup as cleanup


def _write(tmp_path, config):
    (tmp_path / ".claude.json").write_text(json.dumps(config), encoding="utf-8")
    return tmp_path


def _read(tmp_path):
    return json.loads((tmp_path / ".claude.json").read_text(encoding="utf-8"))


def test_removes_the_entry_we_wrote(tmp_path):
    _write(tmp_path, {"mcpServers": {"itl": {"command": "python3", "args": ["/x/cli/itl_mcp.py"]}}})
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is True
    assert _read(tmp_path)["mcpServers"] == {}


def test_keeps_other_servers(tmp_path):
    _write(tmp_path, {"mcpServers": {
        "itl": {"command": "python3", "args": ["/x/cli/itl_mcp.py"]},
        "context7": {"command": "npx", "args": ["-y", "c7"]},
    }})
    cleanup.drop_local_agent_mcp(str(tmp_path))
    assert list(_read(tmp_path)["mcpServers"]) == ["context7"]


def test_leaves_a_hand_written_itl_entry_alone(tmp_path):
    """사람이 적은 것은 그 사람의 것이다 — 래퍼·다른 인터프리터일 수 있다."""
    config = {"mcpServers": {"itl": {"command": "/opt/my/itl-wrapper", "args": []}}}
    _write(tmp_path, config)
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is False
    assert _read(tmp_path) == config


def test_preserves_unrelated_state(tmp_path):
    """설정 파일에는 온보딩 플래그·프로젝트 히스토리가 함께 산다."""
    _write(tmp_path, {
        "mcpServers": {"itl": {"command": "python3", "args": ["/x/itl_mcp.py"]}},
        "projects": {"/home/u": {"history": [1, 2]}},
    })
    cleanup.drop_local_agent_mcp(str(tmp_path))
    assert _read(tmp_path)["projects"] == {"/home/u": {"history": [1, 2]}}


def test_is_idempotent(tmp_path):
    _write(tmp_path, {"mcpServers": {"itl": {"command": "python3", "args": ["/x/itl_mcp.py"]}}})
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is True
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is False


def test_missing_or_broken_config_is_left_alone(tmp_path):
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is False
    (tmp_path / ".claude.json").write_text("{ not json", encoding="utf-8")
    assert cleanup.drop_local_agent_mcp(str(tmp_path)) is False
    assert (tmp_path / ".claude.json").read_text(encoding="utf-8") == "{ not json"
