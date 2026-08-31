"""브라우저가 서버에 맡겨두는 사용자 상태 — UI 설정, 명령 히스토리, 탭 상태.

탭 상태는 기기 간 동기화 대상이라 SSE 로 변경을 밀어준다. 같은 스트림에
에이전트 상태도 함께 흐른다 — ⚠️ 클라이언트는 EventSource 를 **하나만** 연다
(두 번째를 열면 재연결 폭주가 재발한다).

PUT 은 optimistic locking(ifMatch) 을 쓴다. 없으면 stale 한 두 번째 기기가 더
풍부한 첫 기기 상태를 통째로 덮어쓴다.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from _deps import AUTH_COOKIE_NAME, verify_auth_token
from itl_addr_stamp import stamp_local_addresses
from agent_status_service import agent_status_watcher
from models import CommandHistoryPushRequest
from sqlite_storage import storage
from sse_broadcast import _notify_tab_state_change, _tab_state_sse_queues
from tickets import _consume_sse_ticket, _create_sse_ticket
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["user-state"])


# 디바이스/브라우저 갈아탈 때도 동일 설정으로 들어오게.

class UserSettingsRequest(BaseModel):
    settings: dict


class TabStateRequest(BaseModel):
    tabs: list
    activeTabId: str | None = None
    # 클라이언트가 마지막으로 본 서버 updatedAt — optimistic locking.
    # 값이 주어졌는데 현재 서버 값과 다르면 PUT 거부(409) + 최신 상태 반환.
    # 다중 기기에서 stale 한 클라이언트가 더 풍부한 상태(분할 pane 등)를 덮어쓰는 사고 방지.
    ifMatch: str | None = None


async def _sanitize_tab_state(tabs: list, active_tab_id: str | None) -> tuple[list, str | None]:
    """모든 terminal 로컬 pane 이 죽은 local 탭만 정리한다 — pane 단위 생사 판정.

    탭 레벨 sessionId 는 첫 pane 생성 시점 값으로 고정이라, 분할 후 첫 pane 을 닫으면
    죽은 세션을 가리킨다. 이 값 하나로 탭을 통째로 지우면 살아있는 분할 pane 들이
    고아 세션이 되어 프론트가 단일탭으로 재입양 → "분할이 단일탭으로 풀리는" 사고.
    반드시 panes 를 훑어 하나라도 살아있으면 탭을 유지한다.

    tmux 확인 결과가 비어 있으면 정리를 통째로 건너뛴다 — list-sessions 는 일시
    오류(rc!=0)와 진짜 빈 상태를 구분할 수 없고, 잘못 지운 탭 레이아웃은 복구
    불가인 반면 죽은 탭을 남겨두면 프론트가 종료 pane 으로 표시할 뿐이다.
    """
    live_local_sessions = {session.name for session in await tmux_manager.list_sessions()}
    if not live_local_sessions:
        return tabs, active_tab_id

    def _is_tab_alive(tab: dict) -> bool:
        if tab.get("type") != "local":
            return True
        panes = tab.get("panes")
        if not isinstance(panes, list) or not panes:
            # 레거시(panes 없는 옛 포맷) — 탭 레벨 sessionId 로 판정.
            session_id = tab.get("sessionId")
            return isinstance(session_id, str) and session_id in live_local_sessions
        for pane in panes:
            if not isinstance(pane, dict):
                continue
            if pane.get("hostId"):  # 호스트 pane 은 로컬 tmux 로 생사 판정 불가 — 유지
                return True
            if pane.get("mode") not in (None, "terminal"):  # editor 등 비터미널 pane — 유지
                return True
            session_id = pane.get("sessionId")
            if isinstance(session_id, str) and session_id in live_local_sessions:
                return True
        return False

    kept_tabs = []
    kept_tab_ids: set[str] = set()
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        tab_id = tab.get("id")
        if not isinstance(tab_id, str):
            continue
        if not _is_tab_alive(tab):
            continue
        kept_tabs.append(tab)
        kept_tab_ids.add(tab_id)

    if active_tab_id not in kept_tab_ids:
        active_tab_id = kept_tabs[0].get("id") if kept_tabs else None
    return kept_tabs, active_tab_id


async def _has_stored_session(username: str, session_id: str) -> bool:
    return any(session["id"] == session_id for session in await storage.get_user_sessions(username))


@router.get("/api/user/settings")
async def get_user_settings(username: str = Depends(verify_auth_token)):
    saved = await storage.get_user_settings(username)
    return {"settings": saved or {}}


@router.put("/api/user/settings")
async def put_user_settings(
    request: UserSettingsRequest,
    username: str = Depends(verify_auth_token),
):
    if not isinstance(request.settings, dict):
        raise HTTPException(status_code=400, detail="settings must be an object")
    await storage.save_user_settings(username, request.settings)
    return {"status": "saved"}


# ---------------------- 명령 히스토리 ----------------------
# 디바이스 간 공유되는 터미널별 최근 명령. 30일 retention, infinite scroll 페이징.

@router.post("/api/command-history")
async def push_command_history(
    request: CommandHistoryPushRequest,
    username: str = Depends(verify_auth_token),
):
    await storage.push_command_history(username, request.terminal_key, request.text)
    return {"status": "ok"}


@router.get("/api/command-history")
async def get_command_history(
    terminal: str,
    before: int | None = None,
    limit: int = 20,
    username: str = Depends(verify_auth_token),
):
    key = (terminal or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="terminal required")
    items = await storage.get_command_history(
        username, key, before_ms=before, limit=limit,
    )
    has_more = len(items) >= max(1, min(int(limit or 20), 100))
    return {"items": items, "hasMore": has_more}


@router.delete("/api/command-history")
async def delete_command_history(
    terminal: str,
    text: str | None = None,
    username: str = Depends(verify_auth_token),
):
    key = (terminal or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="terminal required")
    if text is None:
        removed = await storage.clear_command_history(username, key)
        return {"status": "cleared", "removed": removed}
    ok = await storage.delete_command_history_entry(username, key, text)
    return {"status": "deleted" if ok else "missing"}


@router.get("/api/tab-state")
async def get_tab_state(username: str = Depends(verify_auth_token)):
    """저장된 탭 전체 상태 조회 (순서/레이아웃/pane 구성 포함).
    updatedAt 은 기기 간 동기화 폴링에서 변경 감지용 ETag.
    """
    state = await storage.get_tab_state(username)
    if not state:
        return {"tabs": [], "activeTabId": None, "updatedAt": None}
    raw_tabs = state.get("tabs")
    tabs = raw_tabs if isinstance(raw_tabs, list) else []
    raw_active_tab_id = state.get("activeTabId")
    active_tab_id = raw_active_tab_id if isinstance(raw_active_tab_id, str) else None
    updated_at = state.get("updatedAt")
    sanitized_tabs, sanitized_active_tab_id = await _sanitize_tab_state(tabs, active_tab_id)
    if sanitized_tabs != tabs or sanitized_active_tab_id != active_tab_id:
        updated_at = await storage.save_tab_state(username, sanitized_tabs, sanitized_active_tab_id)
    return {
        "tabs": sanitized_tabs,
        "activeTabId": sanitized_active_tab_id,
        "updatedAt": updated_at,
    }


@router.get("/api/tab-state/version")
async def get_tab_state_version(username: str = Depends(verify_auth_token)):
    """폴링용 경량 엔드포인트 — updated_at 만 반환 (SSE 미지원 환경 폴백용)."""
    return {"updatedAt": await storage.get_tab_state_updated_at(username)}


@router.get("/api/agent-status")
async def get_agent_status(username: str = Depends(verify_auth_token)):
    """세션ID → {status, title, command} 전체 스냅샷.

    SSE 는 변경분만 흘리므로, 새로 붙은 클라이언트는 여기서 한 번 하이드레이션한다.
    """
    return {"sessions": agent_status_watcher.snapshot()}


@router.post("/api/sse-ticket")
async def create_sse_ticket(username: str = Depends(verify_auth_token)):
    """EventSource 는 커스텀 헤더를 보낼 수 없으므로 일회용 티켓으로 인증."""
    return {"ticket": _create_sse_ticket(username)}


@router.get("/api/tab-state/events")
async def tab_state_events(
    ticket: str | None = Query(None),
    auth_cookie: str | None = Cookie(None, alias=AUTH_COOKIE_NAME),
):
    """tab-state 변경을 Server-Sent Events 로 푸시.

    연결 즉시 현재 updatedAt 을 전송하고, PUT /api/tab-state 가 저장할 때마다
    새 updatedAt 을 emit. 30초마다 keepalive comment 로 프록시 타임아웃 방지.

    인증: 티켓 우선, 없으면 same-origin 쿠키 폴백. EventSource 는 same-origin 요청에
    쿠키를 자동으로 실으므로, 재연결이 wedge 되는 /api/sse-ticket POST(공유 HTTP/2 풀
    재사용)에 의존하지 않는다. CSRF 는 쿠키의 SameSite=Strict 가 막는다(앱 전역 규칙).
    """
    username = _consume_sse_ticket(ticket) if ticket else None
    if not username:
        # 쿠키 폴백 — 무효면 verify_auth_token 이 401 을 던진다.
        username = await verify_auth_token(None, auth_cookie)

    queue: asyncio.Queue = asyncio.Queue(maxsize=10)

    if username not in _tab_state_sse_queues:
        _tab_state_sse_queues[username] = []
    _tab_state_sse_queues[username].append(queue)

    async def event_stream():
        try:
            current = await storage.get_tab_state_updated_at(username)
            yield f"data: {json.dumps({'updatedAt': current})}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            queues = _tab_state_sse_queues.get(username, [])
            if queue in queues:
                queues.remove(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.put("/api/tab-state")
async def put_tab_state(
    request: TabStateRequest,
    username: str = Depends(verify_auth_token),
):
    """탭 전체 상태 저장. 프론트엔드가 변경 시마다 (debounced) 호출.
    응답의 updatedAt 을 클라이언트가 기억해 두면 자기 자신의 PUT 을 폴링에서 무시할 수 있다.

    Optimistic locking — request.ifMatch 가 주어졌고 현재 서버 updatedAt 과 다르면 409 + current.
    이렇게 해야 stale 한 두 번째 기기가 더 풍부한 첫 번째 기기 상태를 덮어쓰는 사고를 막는다.
    """
    if not isinstance(request.tabs, list):
        raise HTTPException(status_code=400, detail="tabs must be an array")
    if request.ifMatch:
        current_updated_at = await storage.get_tab_state_updated_at(username)
        if current_updated_at and request.ifMatch != current_updated_at:
            current_state = await storage.get_tab_state(username) or {"tabs": [], "activeTabId": None, "updatedAt": current_updated_at}
            return JSONResponse(
                status_code=409,
                content={"detail": "tab-state version mismatch", "current": current_state},
            )
    tabs, active_tab_id = await _sanitize_tab_state(request.tabs, request.activeTabId)

    # 내용이 그대로면 새 버전을 찍지 않는다 (no-op write 차단).
    # save_tab_state 는 내용과 무관하게 updated_at 을 새로 찍고, 그 값이 SSE 로 다른 기기에
    # 전파된다. 받은 기기는 상태를 적용하고 그 적용이 다시 자기 PUT 을 부르므로, 기기 두 대만
    # 켜져 있어도 같은 내용이 1초 주기로 무한히 오간다. 여기서 끊는 게 근본이다.
    existing = await storage.get_tab_state(username)
    if existing and existing.get("tabs") == tabs and existing.get("activeTabId") == active_tab_id:
        return {"status": "unchanged", "updatedAt": existing.get("updatedAt")}

    updated_at = await storage.save_tab_state(username, tabs, active_tab_id)
    _notify_tab_state_change(username, updated_at)
    # pane 번호가 바뀔 수 있는 **모든** 순간이 여기다(추가·닫기·순서변경 전부 탭 상태를 바꾼다).
    # 각 로컬 세션의 하단 상태바가 자기 주소를 그리도록 새겨 준다 — 자기 주소를 자기가
    # 봐야 "옆에 2번한테 시켜" 가 된다. 실패해도 저장은 이미 끝났다.
    await stamp_local_addresses(tabs)
    return {"status": "saved", "updatedAt": updated_at}

