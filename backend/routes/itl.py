"""세션 간 명령 전달 — `itl` CLI 의 백엔드.

pane 안에서 도는 에이전트가 다른 pane 에게 프롬프트를 넣을 수 있게 한다.
자연어 해석은 하지 않는다 — 그건 이미 pane 안의 모델이 하는 일이고, 여기서는
그 모델이 첫 시도에 맞출 만큼 뻔한 주소 어휘만 제공한다(itl_targets 참고).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from _deps import verify_itl_token
from agent_status_service import agent_status_watcher
from itl_targets import build_targets, filter_targets, format_table, resolve
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/itl", tags=["itl"])

# 한 번에 보낼 수 있는 대상 수 상한 — @all 오타 하나로 전 터미널에 명령이 박히는 걸 막는다.
MAX_FANOUT = 20
MAX_TEXT_CHARS = 8000


class SendRequest(BaseModel):
    to: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)
    # 기본은 엔터 없음. 사람이 보고 치는 편이 안전하다 — 대화형 앱 한가운데 엔터가
    # 들어가면 의도치 않은 실행이 된다(터미널 파일 드롭과 같은 원칙).
    submit: bool = False
    # 보내는 쪽 세션. `itl send 3` 처럼 탭을 생략한 주소의 기준점이 된다.
    from_session: str | None = Field(default=None, max_length=128)


async def _targets_for(username: str) -> list[dict]:
    state = await storage.get_tab_state(username) or {}
    return build_targets(state.get("tabs") or [], agent_status_watcher.snapshot())


@router.get("/targets")
async def itl_targets(
    from_session: str | None = Query(None),
    fmt: str = Query("json", pattern="^(json|table)$"),
    scope: str = Query("all", pattern="^(all|same_tab)$"),
    status: str | None = Query(None, pattern="^(working|idle|permission)$"),
    command: str | None = Query(None, max_length=64),
    username: str = Depends(verify_itl_token),
):
    """열려 있는 터미널 목록. `fmt=table` 은 CLI 가 그대로 출력한다.

    `scope=same_tab` 은 호출자가 속한 탭으로 좁힌다 — from_session 이 없으면
    좁힐 기준이 없으므로 422 로 명확히 알린다.
    """
    if scope == "same_tab" and not from_session:
        raise HTTPException(
            status_code=422,
            detail='same_tab은 from_session이 필요합니다. scope="all"로 다시 시도하세요.',
        )
    targets = await _targets_for(username)
    targets = filter_targets(
        targets, scope=scope, from_session=from_session, status=status, command=command
    )
    if fmt == "table":
        return {"table": format_table(targets, from_session)}
    return {"targets": targets}


@router.get("/resolve")
async def itl_resolve(
    to: str = Query(...),
    from_session: str | None = Query(None),
    username: str = Depends(verify_itl_token),
):
    """주소가 어디로 가는지 미리 본다 — 보내기 전에 확인용(dry-run)."""
    targets = await _targets_for(username)
    return {"matched": resolve(targets, to, from_session)}


@router.post("/send")
async def itl_send(request: SendRequest, username: str = Depends(verify_itl_token)):
    """해소된 대상 전부에 문자열을 입력한다.

    원격 pane 은 아직 지원하지 않는다 — 원격 tmux 로 보내려면 SSH 왕복이 필요하고,
    그건 별도 경로다. 지금은 명확히 거절해서 조용히 안 가는 일이 없게 한다.
    """
    targets = await _targets_for(username)
    matched = resolve(targets, request.to, request.from_session)
    if not matched:
        raise HTTPException(status_code=404, detail=f"'{request.to}' 에 해당하는 터미널이 없습니다")
    if len(matched) > MAX_FANOUT:
        raise HTTPException(
            status_code=400,
            detail=f"대상이 너무 많습니다 ({len(matched)} > {MAX_FANOUT}). 주소를 좁혀주세요.",
        )

    delivered, skipped = [], []
    for target in matched:
        session_id = target.get("sessionId")
        if not session_id:
            skipped.append({"addr": target["addr"], "reason": "remote-unsupported"})
            continue
        if not await tmux_manager.session_exists(session_id):
            skipped.append({"addr": target["addr"], "reason": "session-gone"})
            continue
        await tmux_manager.send_keys(session_id, request.text, submit=request.submit)
        delivered.append({"addr": target["addr"], "sessionId": session_id})

    logger.info("itl send: to=%s delivered=%d skipped=%d", request.to, len(delivered), len(skipped))
    return {"delivered": delivered, "skipped": skipped}
