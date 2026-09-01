"""터미널 WebSocket — 이 서버의 pane 에 attach.

무엇이 세션을 붙잡는지는 설정을 따른다(tmux / herdr / none). **tmux 를 밑에 깔지
않는다** — 고른 것 하나만 쓴다(backend/local_mux.py).

WS 는 커스텀 헤더를 못 보내므로 쿼리스트링 일회용 티켓으로 인증한다.
연결 유지 중에는 다음 재연결용 티켓을 주기적으로 밀어준다 — 클라가 stash 해두면
재연결 때 HTTP 왕복 없이 바로 소켓을 연다(wedge 된 연결 풀 우회).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from _deps import is_safe_id
from cache import invalidate_session
from rate_limit import check_rate_limit
from session_launch import _resolve_create_cwd, _resolve_shell
from sqlite_storage import storage
from tickets import _push_ws_tickets
import local_mux
import multiplexer as mux
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

    # **묻지 말고 찾는다.** 이미 있는 세션에는 그것을 **붙잡고 있는 쪽**으로 붙는다 —
    # 설정이 정하는 것은 "새 세션을 무엇으로 열까" 뿐이다. 이 구분이 없으면 설정을
    # herdr 로 바꾼 순간 멀쩡히 살아 있는 tmux 세션에 못 붙고 빈 herdr 세션이 새로 뜬다
    # (그게 "양자택일" 이 되는 자리였다).
    holder = await local_mux.holder_of(session_id)
    choice = holder or await local_mux.choice_for(username)

    # **고른 경로는 무엇이 붙잡든 지켜진다.** tmux 는 세션을 만들 때 `-c` 로 받지만(아래),
    # herdr·none 은 이 파일의 bridge 가 프로세스를 직접 띄운다. 여기서 안 넘기면 bridge 의
    # 기본값인 $HOME 에서 떠서, 폴더를 골라도 매번 같은 자리에 붙는다 — 고른 것이 아무
    # 데도 가 닿지 않는 조용한 실패였다. 원격은 이미 세 선택 모두에 start_path 를 먹인다
    # (host_manager._build_remote_command).
    spawn_cwd: str | None = None
    if choice != mux.TMUX:
        try:
            spawn_cwd = _resolve_create_cwd(cwd)
        except HTTPException as e:
            # 새로 여는 자리면 잘못된 경로를 말해 준다. 재접속이면 닫지 않는다 — 그 사이
            # 폴더가 사라졌다고 pane 을 영영 못 붙게 만들 이유는 없다. 워크스페이스 루트로.
            if create:
                await websocket.close(code=1008, reason=str(e.detail)[:120])
                return
            spawn_cwd = _resolve_create_cwd(None)

    if choice == mux.TMUX:
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

    elif not create and holder is None:
        # 아무도 안 붙잡고 있는데 "이어붙기만" 이라면 이어 붙을 대상이 없다.
        # (herdr 가 붙잡고 있으면 `holder` 가 채워지므로 여기 오지 않는다.)
        await websocket.close(code=1000, reason="session not found")
        return

    if choice != mux.TMUX:
        # 세션 행은 소유권·cwd 기록용이라 무엇이 붙잡느냐와 무관하게 남긴다.
        # `existing_owner` 가 이미 있으면 새로 쓰지 않는다 — `create_session` 은
        # INSERT OR REPLACE 라 재연결마다 created_at 과 이름을 지워 버린다.
        try:
            if existing_owner:
                await storage.update_session_activity(session_id)
            else:
                await storage.create_session(session_id, username, cwd=cwd or "")
        except Exception as e:
            logger.warning("session row bookkeeping failed (%s): %s", session_id, e)

    if local_mux.is_missing(choice):
        # 떨어지는 것 자체는 사고가 아니다 — 말 안 하는 것이 사고다(host_manager 와 같은 규칙).
        try:
            await websocket.send_text(json.dumps({
                "type": "mux-missing", "multiplexer": choice,
                "message": f"{choice} not found on this server — session will not persist",
            }))
        except Exception:
            pass

    bridge = TmuxClientBridge(
        websocket=websocket,
        session_id=session_id,
        attach_argv=local_mux.attach_argv(choice, session_id, shell=_resolve_shell(shell)),
        # TERM 은 실제로 무엇이 도는지에 따른다. tmux 가 아닌데 tmux-256color 를 주면
        # terminfo 가 없는 기계에서 앱이 화면을 못 그린다.
        term="tmux-256color" if choice == mux.TMUX else "xterm-256color",
        # tmux 는 attach 라 이 cwd 가 화면에 안 보인다(세션 생성 때 이미 정해졌다).
        # herdr·none 은 여기가 그 셸이 실제로 서는 자리다.
        cwd=spawn_cwd,
        cols=cols,
        rows=rows,
        client_id=client_id,
        # itl 표식 통로를 켠다 — 배달은 이 사용자의 팬 안에서만 일어난다.
        username=username,
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


