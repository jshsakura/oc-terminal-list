"""LLM 사용량 API — 로그를 직접 읽어(로컬 import / 원격 SSH) 합쳐 돌려준다.

폴러가 없으므로 이 라우터가 유일한 진입점이다. 캐시가 살아있으면 아무 데도 안 붙고,
`refresh` 를 줘야만 실제로 호스트들을 다시 훑는다.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from _deps import is_safe_id, verify_auth_token
from host_common import resolve_host_with_secrets, run_remote_cmd_full
from host_snapshot import _sq
from llm_usage import pane_probe
from llm_usage.config import get_config, public_view, save_config
from llm_usage.service import DEFAULT_DAYS, get_usage, purge_source
from rate_limit import check_rate_limit
from sqlite_storage import storage
from tmux_manager import tmux_manager

router = APIRouter(prefix="/api/llm-usage", tags=["llm-usage"])
logger = logging.getLogger(__name__)


@router.get("/pane")
async def llm_usage_pane(
    session_id: str | None = Query(None, max_length=128),
    host_id: str | None = Query(None, max_length=128),
    tmux_session: str | None = Query(None, max_length=128),
    thread_id: str | None = Query(None, max_length=36),
    process_id: int | None = Query(None, gt=0),
    current_only: bool = Query(False),
    username: str = Depends(verify_auth_token),
):
    if thread_id and (not pane_probe.THREAD_ID.fullmatch(thread_id) or process_id is None):
        raise HTTPException(status_code=400, detail="유효하지 않은 LLM 세션입니다")
    if not (await get_config())["enabled"]:
        return {"status": "disabled"}
    host = secrets = None
    if host_id:
        host, secrets = await resolve_host_with_secrets(host_id, username)
        if not tmux_session:
            return {"status": "no_terminal"}
    else:
        if not session_id or not is_safe_id(session_id):
            raise HTTPException(status_code=400, detail="유효하지 않은 터미널 세션입니다")
        if await storage.get_session_owner(session_id) != username:
            raise HTTPException(status_code=403, detail="세션 접근 권한 없음")
    check_rate_limit(f"llm-pane:{username}", max_attempts=60, window_seconds=60)
    try:
        if host:
            args = f"--session {_sq(tmux_session)}"
            if thread_id:
                args += f" --thread {_sq(thread_id)} --process {process_id}"
            if current_only:
                args += " --current-only"
            command = f"python3 - {args}"
            rc, raw, _ = await run_remote_cmd_full(host, secrets, command, timeout=10,
                                                 stdin_data=Path(pane_probe.__file__).read_text(encoding="utf-8"))
            if rc:
                return {"status": "unavailable"}
            marker = raw.rfind(pane_probe.OUTPUT_MARKER)
            if marker < 0:
                return {"status": "unavailable"}
            result = json.loads(raw[marker + len(pane_probe.OUTPUT_MARKER):])
            if not isinstance(result, dict) or "status" not in result:
                return {"status": "unavailable"}
            return result
        rc, pane, _ = await tmux_manager._run(
            "display-message", "-p", "-t", f"={session_id}:", "#{pane_pid}\t#{pane_title}", check=False,
        )
        pid, _, title = pane.rstrip("\n").partition("\t")
        if rc or not pid.isdigit():
            return {"status": "no_terminal"}
        result = await asyncio.wait_for(
            asyncio.to_thread(pane_probe.inspect_pane, int(pid), thread_id, process_id, title, current_only),
            timeout=10,
        )
        if result.get("status") == "ready" and result.get("match") in {"process", "title"}:
            rc, screen, _ = await tmux_manager._run(
                "capture-pane", "-p", "-J", "-t", f"={session_id}:", check=False,
            )
            if rc == 0:
                result = pane_probe.apply_status_limit(result, screen)
        return result
    except Exception as exc:
        logger.info("LLM pane snapshot unavailable: %s", type(exc).__name__)
        return {"status": "unavailable"}


@router.get("/summary")
async def llm_usage_summary(
    days: int = Query(DEFAULT_DAYS, description="0=전체, 7/30/90 만 허용"),
    username: str = Depends(verify_auth_token),
):
    """합산 사용량 + 호스트별 내역 + 최근 세션.

    꺼져 있으면 `enabled: false` 로 돌아온다 — 프론트는 그때 이 구획을 아예
    그리지 않는다(에이전트 기능은 옵트인).
    """
    return await get_usage(username, days=days)


@router.post("/refresh")
async def llm_usage_refresh(
    days: int = Query(DEFAULT_DAYS),
    username: str = Depends(verify_auth_token),
):
    """캐시를 무시하고 호스트들을 다시 훑는다 — 사용자가 누를 때만."""
    return await get_usage(username, days=days, force=True)


@router.get("/config")
async def llm_usage_config(username: str = Depends(verify_auth_token)):
    """연동 설정 조회 — 스위치 상태 하나."""
    return public_view(await get_config())


class UsageConfigUpdate(BaseModel):
    enabled: bool | None = None


@router.put("/config")
async def update_llm_usage_config(
    body: UsageConfigUpdate,
    username: str = Depends(verify_auth_token),
):
    await save_config(enabled=body.enabled)
    return public_view(await get_config())


@router.delete("/source/{source_id}")
async def llm_usage_delete_source(source_id: str, username: str = Depends(verify_auth_token)):
    """소스 하나의 사용량을 지금 지운다 — 보관 기간을 기다리지 않는다. 되돌릴 수 없다.

    호스트가 아직 등록돼 있으면 거절한다. 살아 있는 호스트의 기록을 지워봐야 다음
    수집이 다시 채우므로, 눌러도 아무 일도 안 일어난 것처럼 보이는 버튼이 된다.
    """
    if not is_safe_id(source_id) and source_id != "local":
        raise HTTPException(status_code=400, detail="잘못된 소스 id 입니다")
    # **은퇴한 소스만 지울 수 있다.** 이 버튼은 "호스트 목록에서 빠진 것" 을 치우는 용도다.
    # 살아 있는 소스를 지워봐야 다음 수집이 다시 채우니 눌러도 아무 일 없어 보이고, 무엇보다
    # `local`(이 서버) 은 은퇴할 일이 없는데 이 검사가 없으면 URL 하나로 전체 기록이 날아간다.
    source = (await storage.get_llm_sources(username)).get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="그런 사용량 소스가 없습니다")
    if not source.get("retired_at"):
        raise HTTPException(
            status_code=409,
            detail="아직 쓰이는 소스입니다. 호스트를 먼저 삭제하세요.",
        )
    removed = await purge_source(username, source_id)
    return {"source_id": source_id, "removed": removed}
