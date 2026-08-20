"""터미널 WebSocket — 로컬 tmux 세션에 attach.

WS 는 커스텀 헤더를 못 보내므로 쿼리스트링 일회용 티켓으로 인증한다.
연결 유지 중에는 다음 재연결용 티켓을 주기적으로 밀어준다 — 클라가 stash 해두면
재연결 때 HTTP 왕복 없이 바로 소켓을 연다(wedge 된 연결 풀 우회).
"""
from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from _deps import is_safe_id
from itl_env import build_itl_env
from cache import invalidate_session
from rate_limit import check_rate_limit
from session_launch import _resolve_create_cwd, _resolve_shell
from sqlite_storage import storage
from tickets import _push_ws_tickets
from tmux_manager import tmux_manager
from ws_auth import authenticate_ws
from ws_bridge import TmuxClientBridge
from ws_clients import _register_ws_client, _unregister_ws_client
from ws_observe import log_attach, log_detach

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    ticket: str | None = Query(None),
    client_id: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    cwd: str | None = Query(None),
    shell: str | None = Query(None),
    create: bool = Query(True, description="false면 없는 tmux 세션을 새로 만들지 않고 연결만 시도"),
    reason: str | None = Query(None, description="클라이언트가 이 연결을 연 사유(관측 전용, ws_observe 참고)"),
    prev_ms: int | None = Query(None, description="직전 소켓이 살아있던 시간(ms). 요동과 단발 끊김을 구별한다."),
):
    if not is_safe_id(session_id):
        await websocket.close(code=1008, reason="유효하지 않은 세션 ID")
        return

    ws_path = f"/ws/{session_id}"
    # 티켓 우선, 없거나 만료면 same-origin 쿠키 폴백(ws_auth 참고) — 재연결이 wedge 되는
    # HTTP 티켓 fetch 에 의존하지 않게 하는 근본 수정.
    username = await authenticate_ws(websocket, ws_path, ticket)
    if not username:
        await websocket.close(code=1008, reason="인증 필요")
        return

    # 세션 소유권 체크 — DB 에 기록된 세션이면 owner 와 ticket username 이 같아야 함.
    # 등록되지 않은 신규 session_id 면 통과(아래에서 새로 생성하고 username 으로 등록됨).
    # 이게 없으면 사용자 A 가 사용자 B 의 session_id 를 추측해 ticket 발급 후 attach 가능.
    try:
        existing_owner = await storage.get_session_owner(session_id)
    except Exception:
        existing_owner = None
    if existing_owner and existing_owner != username:
        await websocket.close(code=1008, reason="세션 접근 권한 없음")
        return

    await websocket.accept()
    opened_at = time.monotonic()
    log_attach(
        kind="local", session=session_id, user=username, client_id=client_id,
        reason=reason, prev_ms=prev_ms, cols=cols, rows=rows,
    )

    # 세션이 없으면 생성 (백엔드 재시작 후 첫 연결 또는 새 세션 직접 WS 진입)
    if not await tmux_manager.session_exists(session_id):
        if not create:
            await websocket.close(code=1000, reason="session not found")
            return
        # 신규 세션 생성만 rate limit (기존 세션 재attach/재연결은 대상 아님) —
        # REST create_session 과 같은 버킷 공유.
        try:
            check_rate_limit(f"session:create:{username}", max_attempts=30, window_seconds=60)
        except HTTPException as e:
            await websocket.close(code=1013, reason=str(e.detail)[:120])
            return
        try:
            safe_cwd = _resolve_create_cwd(cwd)
        except HTTPException as e:
            await websocket.close(code=1008, reason=e.detail)
            return
        try:
            await tmux_manager.create_session(
                session_id,
                cols=cols,
                rows=rows,
                cwd=safe_cwd,
                shell=_resolve_shell(shell),
                env=await build_itl_env(username, session_id),
            )
            try:
                await storage.create_session(session_id, username, cwd=cwd or "")
            except Exception:
                pass
        except Exception as e:
            logger.error("tmux create on WS failed (%s): %s", session_id, e)
            # 상세 예외는 서버 로그에만. 클라이언트엔 일반 메시지.
            await websocket.close(code=1011, reason="세션 초기화에 실패했습니다.")
            return
    else:
        try:
            await storage.update_session_activity(session_id)
        except Exception:
            pass
        # A session that outlived a backend restart never went through create_session,
        # so without this it stays the one place where `itl` is missing from PATH.
        await tmux_manager.refresh_session_env(session_id, await build_itl_env(username, session_id))
        # tmux mouse on — 브라우저는 wheel/touch 를 SGR mouse 이벤트로 전달하고,
        # tmux 가 copy-mode 스크롤을 담당한다. 드래그 선택은 frontend 가 plain drag
        # 임계값 이후 xterm selection 으로 보정하므로 스크롤과 선택을 함께 유지한다.
        try:
            await tmux_manager._run("set-option", "-t", session_id, "mouse", "on", check=False)
            # PageUp/Down 키보드 바인딩 — alternate buffer(vim 등) 이면 앱에 전달,
            # 아니면 tmux copy-mode 로 터미널 히스토리 탐색. 마우스 모드와 무관.
            await tmux_manager._run(
                "bind-key", "-T", "root", "PageUp",
                "if-shell", "-F", "#{alternate_on}",
                "send-keys PageUp", "copy-mode -eu",
                check=False,
            )
            await tmux_manager._run(
                "bind-key", "-T", "root", "PageDown",
                "if-shell", "-F", "#{alternate_on}",
                "send-keys PageDown", "",
                check=False,
            )
        except Exception:
            pass

    bridge = TmuxClientBridge(
        websocket=websocket,
        session_id=session_id,
        attach_argv=tmux_manager.attach_argv(session_id),
        cols=cols,
        rows=rows,
        client_id=client_id,
    )
    usage_event_id = None
    client_token = _register_ws_client("local", session_id, client_id, websocket)
    try:
        usage_event_id = await storage.record_usage_start(
            username, "local", "local", session_id
        )
    except Exception as e:
        logger.warning("usage start record failed (local %s): %s", session_id, e)
    # attach/detach 가 일어났으니 client 수 캐시 즉시 무효화.
    await invalidate_session(session_id)
    ticket_pusher = asyncio.create_task(_push_ws_tickets(bridge, username, ws_path))
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS bridge error (%s): %s", session_id, e)
    finally:
        ticket_pusher.cancel()
        if usage_event_id is not None:
            try:
                await storage.record_usage_end(usage_event_id)
            except Exception as e:
                logger.warning("usage end record failed (local %s): %s", session_id, e)
        await invalidate_session(session_id)
        _unregister_ws_client("local", session_id, client_token)
        log_detach(kind="local", session=session_id, client_id=client_id, opened_at=opened_at)


