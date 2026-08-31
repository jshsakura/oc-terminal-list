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
