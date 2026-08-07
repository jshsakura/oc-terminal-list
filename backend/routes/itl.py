"""세션 간 명령 전달 — `itl` CLI 의 백엔드.

pane 안에서 도는 에이전트가 다른 pane 에게 프롬프트를 넣을 수 있게 한다.
자연어 해석은 하지 않는다 — 그건 이미 pane 안의 모델이 하는 일이고, 여기서는
그 모델이 첫 시도에 맞출 만큼 뻔한 주소 어휘만 제공한다(itl_targets 참고).
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from _deps import verify_itl_token
from agent_status_service import agent_status_watcher
from itl_targets import build_targets, filter_targets, format_table, resolve
from pane_excerpt import extract_excerpt
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/itl", tags=["itl"])

# 한 번에 보낼 수 있는 대상 수 상한 — @all 오타 하나로 전 터미널에 명령이 박히는 걸 막는다.
MAX_FANOUT = 20
MAX_TEXT_CHARS = 8000
MAX_READ_LINES = 200
MAX_READ_CHARS = 20_000


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


def _read_enabled() -> bool:
    """ITL_READ_ENABLED env switch (default on). Reading widens the surface of a
    leaked ITL_TOKEN from send-only to send+read ≈ interactive shell, so a
    deployment that wants the narrower surface can set ``ITL_READ_ENABLED=0``."""
    return os.getenv("ITL_READ_ENABLED", "1") != "0"


def _tail(text: str, lines: int) -> str:
    """raw mode — last ``lines`` lines of the capture, preserving order."""
    if not text or lines <= 0:
        return ""
    all_lines = text.splitlines()
    return "\n".join(all_lines[-lines:]) if len(all_lines) > lines else text


def _truncate_for_response(text: str) -> str:
    """Enforce MAX_READ_CHARS. Over → keep the tail and prefix a cut marker."""
    if len(text) <= MAX_READ_CHARS:
        return text
    prefix = "…(잘림)\n"
    return prefix + text[-(MAX_READ_CHARS - len(prefix)):]


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


@router.get("/read")
async def itl_read(
    to: str = Query(..., min_length=1, max_length=200),
    from_session: str | None = Query(None),
    lines: int = Query(40, ge=1, le=MAX_READ_LINES),
    mode: str = Query("excerpt", pattern="^(excerpt|raw)$"),
    username: str = Depends(verify_itl_token),
):
    """터미널 화면을 읽는다. ``excerpt`` 는 UI 장식을 걷어낸 발췌, ``raw`` 는 그대로.

    읽기가 생기면 유출된 ITL_TOKEN 은 보내기+읽기 = 사실상 대화형 셸이 된다.
    ``ITL_READ_ENABLED=0`` 으로 끌 수 있다(기본 1).
    """
    if not _read_enabled():
        raise HTTPException(status_code=403, detail="읽기가 비활성화돼 있습니다")

    targets = await _targets_for(username)
    matched = resolve(targets, to, from_session)
    if not matched:
        raise HTTPException(status_code=404, detail=f"'{to}'에 해당하는 터미널이 없습니다")
    if len(matched) > 1:
        return JSONResponse(
            status_code=400,
            content={
                "detail": f"대상이 {len(matched)}개 입니다. 주소를 좁혀주세요.",
                "matched": [t["addr"] for t in matched],
            },
        )

    target = matched[0]
    session_id = target.get("sessionId")
    if not session_id:
        raise HTTPException(status_code=400, detail="remote-unsupported")
    if not await tmux_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="session-gone")

    pane_text = await tmux_manager.capture_pane(session_id, lines)
    text = extract_excerpt(pane_text) if mode == "excerpt" else _tail(pane_text, lines)
    text = _truncate_for_response(text)

    logger.info("itl read: to=%s mode=%s len=%d", to, mode, len(text))
    return {"addr": target["addr"], "sessionId": session_id, "mode": mode, "text": text}


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
