"""설치 도구 — 목록 CRUD + 호스트별 설치 여부 확인.

**설치는 여기서 하지 않는다.** 이 라우터가 하는 일은 "무엇을 깔 수 있나" 와 "지금 깔려
있나" 뿐이고, 실제 설치는 프론트가 그 호스트의 터미널을 열어 명령을 타이핑한다.
이유는 host_tools 모듈 머리말에 있다 — 요약하면 sudo 프롬프트·진행 표시·중단이 전부
사람이 보는 터미널에서만 제대로 동작하고, 그렇게 해야 이 기능이 **새 권한을 만들지
않는다**(사용자가 직접 칠 수 있는 것을 대신 쳐 줄 뿐).
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import host_tools
from _deps import verify_auth_token
from sqlite_storage import storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tools"])

# 호스트 하나를 훑는 데 쓰는 상한. 프론트 apiFetch 기본 마감시한(15s)보다 짧아야 한다 —
# 넘으면 서버는 아직 일하는데 화면은 이미 포기한 상태가 된다.
CHECK_TIMEOUT_SEC = 12.0


class ToolBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=host_tools.MAX_NAME)
    install_command: str = Field(..., min_length=1, max_length=host_tools.MAX_COMMAND)
    check_command: str = Field(default='', max_length=host_tools.MAX_COMMAND)
    description: str = Field(default='', max_length=host_tools.MAX_DESCRIPTION)
    url: str = Field(default='', max_length=500)
    sort_index: int = Field(default=0)


class ToolPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=host_tools.MAX_NAME)
    install_command: Optional[str] = Field(default=None, min_length=1, max_length=host_tools.MAX_COMMAND)
    check_command: Optional[str] = Field(default=None, max_length=host_tools.MAX_COMMAND)
    description: Optional[str] = Field(default=None, max_length=host_tools.MAX_DESCRIPTION)
    url: Optional[str] = Field(default=None, max_length=500)
    sort_index: Optional[int] = None


class CheckBody(BaseModel):
    # 빈 값 = 이 서버. 앱이 도는 기계도 사용자가 일하는 기계다.
    host_id: str = Field(default='', max_length=64)


@router.get("/api/tools")
async def list_tools(username: str = Depends(verify_auth_token)):
    return {"tools": host_tools.merge_tools(await storage.list_tools(username))}


@router.post("/api/tools", status_code=201)
async def create_tool(body: ToolBody, username: str = Depends(verify_auth_token)):
    return await storage.create_tool(
        username=username,
        tool_id=str(uuid.uuid4()),
        name=body.name,
        install_command=body.install_command,
        check_command=body.check_command,
        description=body.description,
        url=body.url,
        sort_index=body.sort_index,
    )


# ⚠️ **`{tool_id}` 라우트보다 먼저 등록한다.** FastAPI 는 먼저 맞는 것을 잡으므로,
# 뒤에 두면 언젠가 `POST /api/tools/{tool_id}` 가 생기는 순간 "check 라는 도구" 로
# 읽힌다. 이 저장소가 `POST /api/sessions/prune` 에서 이미 밟은 함정이다.
@router.post("/api/tools/check")
async def check_tools(body: CheckBody, username: str = Depends(verify_auth_token)):
    """이 기계에 무엇이 깔려 있나 — 호스트당 **왕복 하나**.

    ⚠️ 화면을 열 때 한 번만 부른다. 되풀이되는 경로에 놓으면 안 된다(CLAUDE.md 의
    "가르는 기준은 SSH 냐가 아니라 얼마나 자주 부르냐다").

    ⚠️ 실패는 `installed: null` 로 돌려준다 — "안 깔림" 이 아니라 "모름" 이다. 못 닿은
    호스트를 안 깔린 것으로 그리면 사용자는 실패할 설치 버튼을 누르게 된다.
    """
    tools = host_tools.merge_tools(await storage.list_tools(username))
    marker = host_tools.new_marker()
    script = host_tools.build_check_script(tools, marker)

    host_id = (body.host_id or "").strip()
    error = None
    raw = ""
    try:
        if host_id:
            from host_common import resolve_host_with_secrets, run_remote_cmd
            host, secrets = await resolve_host_with_secrets(host_id, username)
            raw = await run_remote_cmd(host, secrets, script, timeout=CHECK_TIMEOUT_SEC)
        else:
            raw = await host_tools.run_local_script(script, timeout=CHECK_TIMEOUT_SEC)
    except HTTPException:
        raise
    except Exception as e:                                    # noqa: BLE001
        logger.info("도구 확인 실패 (host=%s): %s", host_id or "local", e)
        error = str(e)[:200]

    parsed = host_tools.parse_check_output(raw, marker)
    results = {
        tool["id"]: parsed.get(tool["id"], {"installed": None, "detail": ""})
        for tool in tools
    }
    return {"host_id": host_id, "results": results, "error": error}


@router.put("/api/tools/{tool_id}")
async def update_tool(tool_id: str, body: ToolPatch, username: str = Depends(verify_auth_token)):
    if tool_id in host_tools.BUILTIN_IDS:
        # 내장은 코드가 소유한다. 고치고 싶으면 사용자 항목으로 새로 만들면 되고,
        # 같은 id 로 만들면 목록에서 내장을 대신한다(host_tools.merge_tools).
        raise HTTPException(status_code=409, detail="내장 도구는 수정할 수 없습니다")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="바꿀 항목이 없습니다")
    if not await storage.update_tool(username, tool_id, **updates):
        raise HTTPException(status_code=404, detail="도구를 찾을 수 없습니다")
    return {"ok": True}


@router.delete("/api/tools/{tool_id}")
async def delete_tool(tool_id: str, username: str = Depends(verify_auth_token)):
    if tool_id in host_tools.BUILTIN_IDS:
        raise HTTPException(status_code=409, detail="내장 도구는 삭제할 수 없습니다")
    if not await storage.delete_tool(username, tool_id):
        raise HTTPException(status_code=404, detail="도구를 찾을 수 없습니다")
    return {"ok": True}
