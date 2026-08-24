"""터미널 세션 REST — 목록/생성/삭제/리사이즈/활동/cwd/이름.

모든 엔드포인트가 _assert_session_owner 로 소유권을 먼저 확인한다(WS 경로와 동일
기준). 하나라도 빠지면 세션 ID 만 알면 남의 터미널을 만지는 IDOR 이 된다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import os

from _deps import WORKSPACE_ROOT, is_safe_id, verify_auth_token
from itl_env import build_itl_env
from cache import cache, invalidate_session, key_local_clients
from models import ResizeRequest, SessionCreateRequest, SessionNameRequest
from rate_limit import check_rate_limit
from llm_usage.service import maybe_collect_in_background
from session_launch import (
    _assert_session_owner, _basename_or_none, _resolve_create_cwd, _resolve_shell,
)
from sqlite_storage import storage
from tmux_manager import tmux_manager
from ws_clients import _client_identity_payload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sessions"])

# A page cannot hold this many panes; the cap only bounds a crafted request.
MAX_CWD_BATCH = 64


@router.get("/api/sessions", response_model=list[dict])
async def list_sessions(username: str = Depends(verify_auth_token)):
    """DB에 기록된 사용자 세션 목록 (tmux에 살아있는지 여부와 무관)."""
    db_sessions = await storage.get_user_sessions(username)
    # tmux에 실제 살아있는 세션과 교차 참조
    live = {s.name for s in await tmux_manager.list_sessions()}
    return [{**s, "alive": s["id"] in live} for s in db_sessions]


@router.post("/api/sessions/prune")
async def prune_sessions(username: str = Depends(verify_auth_token)):
    """Drop DB rows for tmux sessions that no longer exist.

    ⚠️ Registered **before** `/api/sessions/{session_id}` on purpose: FastAPI takes the first
    route that matches, so behind the parameterised one this literal path would be read as a
    session named "prune" and quietly create a session instead of pruning.

    ⚠️ An empty tmux list is not proof that every session died — it is also what a stopped
    tmux server looks like. Deleting on that reading would wipe every row the moment the
    server blipped (the same mistake that once unwrapped split tabs), so it refuses instead.
    """
    if not await tmux_manager.server_alive():
        raise HTTPException(status_code=409, detail="tmux 서버가 응답하지 않아 정리를 건너뜁니다")
    live = {s.name for s in await tmux_manager.list_sessions()}
    if not live:
        raise HTTPException(status_code=409, detail="살아있는 tmux 세션이 하나도 없어 정리를 건너뜁니다")
    dead = [s["id"] for s in await storage.get_user_sessions(username) if s["id"] not in live]
    for session_id in dead:
        await storage.delete_session(session_id)
    logger.info("pruned %d dead session rows for %s", len(dead), username)
    return {"removed": len(dead)}


@router.post("/api/sessions/{session_id}")
async def create_session(
    session_id: str,
    request: SessionCreateRequest,
    username: str = Depends(verify_auth_token),
):
    """tmux 세션 생성 + DB 등록."""
    if not is_safe_id(session_id):
        raise HTTPException(status_code=400, detail="유효하지 않은 세션 ID입니다.")
    # 사용자당 세션 생성 rate limit — 정상적인 멀티 pane/탭 사용(빠르게 여러 개 열기)은
    # 안 막히도록 넉넉하게. WS 쪽 신규 세션 생성과 버킷을 공유(아래 terminal_websocket).
    check_rate_limit(f"session:create:{username}", max_attempts=30, window_seconds=60)
    logger.info("[API] create session %s (cwd=%s, shell=%s)", session_id, request.cwd, request.shell)

    safe_cwd = _resolve_create_cwd(request.cwd)
    shell_path = _resolve_shell(request.shell)

    try:
        await tmux_manager.create_session(
            session_id,
            cols=request.cols or 80,
            rows=request.rows or 24,
            cwd=safe_cwd,
            shell=shell_path,
            env=await build_itl_env(username, session_id),
        )
    except Exception as e:
        logger.error("tmux create failed (%s): %s", session_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="터미널 실행에 실패했습니다.")

    try:
        await storage.create_session(session_id, username, cwd=request.cwd or "")
    except Exception as e:
        logger.warning("session db record failed (%s): %s", session_id, e)

    # 앱을 쓰는 이 순간이 LLM 사용량 수집 트리거다 — 폴러를 따로 두지 않는다.
    # 하루에 한 번만 실제로 움직이고, 아니면 작은 테이블 한 번 읽고 바로 돌아온다.
    # (대시보드를 안 열어도 쌓여야 한다: 에이전트 로그는 언젠가 정리된다.)
    await maybe_collect_in_background(username)

    return {
        "session_id": session_id,
        "status": "created",
        "cwd": safe_cwd,
        "shell": shell_path,
        "shell_name": _basename_or_none(shell_path),
    }


@router.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, username: str = Depends(verify_auth_token)):
    await _assert_session_owner(session_id, username)
    await tmux_manager.kill_session(session_id)
    await storage.delete_session(session_id)
    await invalidate_session(session_id)
    return {"session_id": session_id, "status": "deleted"}


@router.get("/api/sessions/{session_id}/clients")
async def get_session_clients(
    request: Request,
    session_id: str,
    client_id: str | None = Query(None),
    username: str = Depends(verify_auth_token),
):
    """세션에 현재 attach 된 tmux 클라이언트 수.
    프론트엔드 takeover 모델에서 "지금 누가 보고 있냐?" 프리플라이트 / 자동 재attach 폴링용.
    세션 자체가 없으면 attached=False 로 통일 (UI 가 그냥 신규 attach 진행하게).
    여러 탭이 같은 세션을 polling 할 때 합치되, close 직후 자기 attach 를 takeover 로
    오판하지 않도록 TTL 은 짧게 유지."""
    await _assert_session_owner(session_id, username)
    cache_key = key_local_clients(session_id)
    base = await cache.get(cache_key)
    if base is None:
        if not await tmux_manager.session_exists(session_id):
            base = {"session_id": session_id, "exists": False, "count": 0, "attached": False}
        else:
            n = await tmux_manager.clients_count(session_id)
            base = {"session_id": session_id, "exists": True, "count": n, "attached": n > 0}
        await cache.set(cache_key, base, ttl_seconds=1)
    payload = dict(base)
    payload.update(_client_identity_payload("local", session_id, client_id, request))
    return payload


@router.post("/api/sessions/{session_id}/resize")
async def resize_terminal(
    session_id: str,
    request: ResizeRequest,
    username: str = Depends(verify_auth_token),
):
    await _assert_session_owner(session_id, username)
    if not await tmux_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    await tmux_manager.resize_window(session_id, request.cols, request.rows)
    return {"session_id": session_id, "cols": request.cols, "rows": request.rows, "status": "resized"}


@router.get("/api/sessions/{session_id}/activity")
async def get_session_activity(session_id: str, username: str = Depends(verify_auth_token)):
    """세션의 cwd 타임라인 + 워크스페이스 상대 경로 부가."""
    await _assert_session_owner(session_id, username)
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    raw = tmux_manager.get_cwd_history(session_id)
    items = []
    for entry in raw:
        cwd = entry["cwd"]
        in_ws = cwd == workspace_abs or cwd.startswith(workspace_abs + os.sep)
        rel = ""
        if in_ws:
            r = os.path.relpath(cwd, workspace_abs).replace("\\", "/")
            rel = "" if r == "." else r
        items.append({
            "ts": entry["ts"],
            "cwd": cwd,
            "workspace_relative": rel if in_ws else None,
            "in_workspace": in_ws,
        })
    return {"session_id": session_id, "items": items}


def _workspace_view(cwd: str | None) -> dict:
    """cwd -> the workspace-relative fields the client reads. Shared by the
    single and batch routes so the two can never drift."""
    if not cwd:
        return {"cwd": None, "workspace_relative": None, "in_workspace": False}
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    in_workspace = cwd == workspace_abs or cwd.startswith(workspace_abs + os.sep)
    workspace_relative = None
    if in_workspace:
        rel = os.path.relpath(cwd, workspace_abs).replace("\\", "/")
        workspace_relative = "" if rel == "." else rel
    return {"cwd": cwd, "workspace_relative": workspace_relative, "in_workspace": in_workspace}


# Registered before the /{session_id}/cwd route below. The paths cannot collide
# ("batch" != "cwd" in the last segment), but keep them adjacent so the ordering
# rule in CLAUDE.md is obvious to the next reader.
@router.get("/api/sessions/cwd/batch")
async def get_session_cwds(
    ids: str = Query("", description="쉼표로 구분한 세션 id. 비우면 빈 응답."),
    username: str = Depends(verify_auth_token),
):
    """Every requested session's cwd from **one** `list-panes -a`.

    Boot restores every pane at once and each asked for itself: one HTTP request
    plus two tmux subprocesses (`session_exists` + `display-message`) per pane.
    tmux already reports all of them in a single call.
    """
    wanted = [s for s in (ids or "").split(",") if s]
    if not wanted:
        return {"cwds": {}}
    if len(wanted) > MAX_CWD_BATCH:
        raise HTTPException(status_code=400, detail=f"한 번에 {MAX_CWD_BATCH}개까지만 조회합니다")

    all_cwds = await tmux_manager.get_all_pane_cwds()
    out = {}
    for session_id in wanted:
        if session_id not in all_cwds:
            continue
        # Same ownership rule as the single route — a batch must not become a way
        # to read other users' sessions.
        await _assert_session_owner(session_id, username)
        out[session_id] = _workspace_view(all_cwds[session_id])
    return {"cwds": out}


@router.get("/api/sessions/{session_id}/cwd")
async def get_session_cwd(session_id: str, username: str = Depends(verify_auth_token)):
    """활성 pane 의 현재 작업 디렉토리. 워크스페이스 내부면 상대 경로도 같이 반환."""
    await _assert_session_owner(session_id, username)
    cwd = await tmux_manager.get_pane_cwd(session_id)
    return {"session_id": session_id, **_workspace_view(cwd)}


@router.patch("/api/sessions/{session_id}/name")
async def update_session_name(
    session_id: str,
    request: SessionNameRequest,
    username: str = Depends(verify_auth_token),
):
    await _assert_session_owner(session_id, username)
    await storage.update_session_name(session_id, request.name)
    return {"session_id": session_id, "name": request.name, "status": "updated"}


