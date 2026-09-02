"""/api/tools — 내장 보호 · 확인 결과의 "모름".

라우트 함수를 직접 부른다(이 저장소의 다른 라우트 테스트와 같은 방식). 검증하려는 것은
HTTP 배선이 아니라 **판정**이다.
"""
from __future__ import annotations

import os
import re
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import tools as tools_route  # noqa: E402


@pytest.mark.anyio
async def test_builtin_cannot_be_deleted():
    with pytest.raises(HTTPException) as exc:
        await tools_route.delete_tool("herdr", username="u")
    assert exc.value.status_code == 409


@pytest.mark.anyio
async def test_builtin_cannot_be_updated():
    with pytest.raises(HTTPException) as exc:
        await tools_route.update_tool("herdr", tools_route.ToolPatch(name="x"), username="u")
    assert exc.value.status_code == 409


@pytest.mark.anyio
async def test_check_reports_unknown_when_the_host_cannot_be_reached():
    """⚠️ 못 닿은 것을 "안 깔림" 으로 그리면 사용자는 실패할 설치 버튼을 누른다."""
    with patch.object(tools_route.storage, "list_tools", AsyncMock(return_value=[])), \
         patch("host_common.resolve_host_with_secrets", AsyncMock(side_effect=OSError("보내지 못했습니다"))):
        body = tools_route.CheckBody(host_id="h1")
        out = await tools_route.check_tools(body, username="u")
    assert out["error"]
    assert out["results"]["herdr"]["installed"] is None


@pytest.mark.anyio
async def test_check_runs_locally_when_no_host_given():
    with patch.object(tools_route.storage, "list_tools", AsyncMock(return_value=[])), \
         patch.object(tools_route.host_tools, "run_local_script",
                      AsyncMock(side_effect=lambda script, timeout=0: _fake_ok(script))):
        out = await tools_route.check_tools(tools_route.CheckBody(), username="u")
    assert out["results"]["herdr"]["installed"] is True


def _fake_ok(script: str) -> str:
    """스크립트에 박힌 표식을 그대로 되돌려 준다 — 실제 셸이 하는 일과 같은 모양."""
    marker = re.search(r"@@TOOL[0-9a-f]+", script).group(0)
    return f"{marker} herdr\n{marker} ok\n/usr/bin/herdr\n"


def test_check_is_registered_before_the_param_route():
    """⚠️ 라우트 등록 순서 = 매칭 우선순위.

    `POST /api/tools/{tool_id}` 가 언젠가 생기면, `check` 가 뒤에 있는 순간 "check 라는
    도구" 로 읽힌다. 이 저장소는 `POST /api/sessions/prune` 에서 같은 함정을 밟았다.
    """
    paths = [r.path for r in tools_route.router.routes]
    assert paths.index("/api/tools/check") < paths.index("/api/tools/{tool_id}")


# ─── install / uninstall of push tools ────────────────────────────────────────

@pytest.mark.anyio
async def test_install_refuses_tools_that_are_not_push_installed():
    """herdr goes through a terminal the user watches — the backend must not run it."""
    with pytest.raises(HTTPException) as exc:
        await tools_route.install_tool("herdr", tools_route.CheckBody(), username="u")
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_install_pushes_the_file_over_ssh_stdin():
    run = AsyncMock(return_value=(0, "", ""))
    with patch("host_common.resolve_host_with_secrets", AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch("host_common.run_remote_cmd_full", run):
        out = await tools_route.install_tool("itl", tools_route.CheckBody(host_id="h1"), username="u")
    assert out == {"ok": True, "host_id": "h1", "path": "~/.local/bin/itl"}
    script = run.await_args.args[2]
    assert 'cat > "$HOME/.local/bin"/itl' in script
    assert "def main(" in run.await_args.kwargs["stdin_data"]


@pytest.mark.anyio
async def test_install_reports_a_remote_failure_instead_of_claiming_success():
    with patch("host_common.resolve_host_with_secrets", AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch("host_common.run_remote_cmd_full", AsyncMock(return_value=(1, "", "read-only file system"))):
        with pytest.raises(HTTPException) as exc:
            await tools_route.install_tool("itl", tools_route.CheckBody(host_id="h1"), username="u")
    assert exc.value.status_code == 502 and "read-only" in exc.value.detail


@pytest.mark.anyio
async def test_uninstall_removes_only_that_file():
    run = AsyncMock(return_value=(0, "", ""))
    with patch("host_common.resolve_host_with_secrets", AsyncMock(return_value=({"id": "h1"}, {}))), \
         patch("host_common.run_remote_cmd_full", run):
        await tools_route.uninstall_tool("itl", tools_route.CheckBody(host_id="h1"), username="u")
    assert run.await_args.args[2] == 'rm -f "$HOME/.local/bin"/itl'
    assert run.await_args.kwargs["stdin_data"] is None


@pytest.mark.anyio
async def test_install_and_uninstall_on_this_server(tmp_path, monkeypatch):
    """The local branch really places (and deletes) the file — under a throwaway HOME."""
    monkeypatch.setenv("HOME", str(tmp_path))
    await tools_route.install_tool("itl", tools_route.CheckBody(), username="u")
    placed = tmp_path / ".local" / "bin" / "itl"
    assert placed.is_file() and os.access(placed, os.X_OK)
    assert placed.read_text().startswith("#!/usr/bin/env python3")
    await tools_route.uninstall_tool("itl", tools_route.CheckBody(), username="u")
    assert not placed.exists()


def test_push_routes_do_not_shadow_check():
    paths = [r.path for r in tools_route.router.routes]
    assert paths.index("/api/tools/check") < paths.index("/api/tools/{tool_id}/install")


@pytest.mark.anyio
async def test_check_flags_a_stale_installed_copy():
    """"설치됨" 만 보이면 낡았는지 알 길이 없다 — 실제 신고였다."""
    def _reply(script: str) -> str:
        marker = re.search(r"@@TOOL[0-9a-f]+", script).group(0)
        return f"{marker} itl\n{marker} ok\n/home/u/.local/bin/itl fp={'0' * 64}\n"

    with patch.object(tools_route.storage, "list_tools", AsyncMock(return_value=[])), \
         patch.object(tools_route.host_tools, "run_local_script",
                      AsyncMock(side_effect=lambda script, timeout=0: _reply(script))):
        out = await tools_route.check_tools(tools_route.CheckBody(), username="u")
    assert out["results"]["itl"]["installed"] is True
    assert out["results"]["itl"]["outdated"] is True


@pytest.mark.anyio
async def test_check_says_unknown_when_the_fingerprint_is_missing():
    """지문을 못 읽는 기계가 있다. 그때 "최신" 으로 그리면 갱신할 이유를 못 본다."""
    def _reply(script: str) -> str:
        marker = re.search(r"@@TOOL[0-9a-f]+", script).group(0)
        return f"{marker} itl\n{marker} ok\n/home/u/.local/bin/itl\n"

    with patch.object(tools_route.storage, "list_tools", AsyncMock(return_value=[])), \
         patch.object(tools_route.host_tools, "run_local_script",
                      AsyncMock(side_effect=lambda script, timeout=0: _reply(script))):
        out = await tools_route.check_tools(tools_route.CheckBody(), username="u")
    assert out["results"]["itl"]["outdated"] is None


@pytest.mark.anyio
async def test_not_installed_is_never_flagged_outdated():
    def _reply(script: str) -> str:
        marker = re.search(r"@@TOOL[0-9a-f]+", script).group(0)
        return f"{marker} itl\n{marker} no\n\n"

    with patch.object(tools_route.storage, "list_tools", AsyncMock(return_value=[])), \
         patch.object(tools_route.host_tools, "run_local_script",
                      AsyncMock(side_effect=lambda script, timeout=0: _reply(script))):
        out = await tools_route.check_tools(tools_route.CheckBody(), username="u")
    assert out["results"]["itl"]["installed"] is False
    assert "outdated" not in out["results"]["itl"]
