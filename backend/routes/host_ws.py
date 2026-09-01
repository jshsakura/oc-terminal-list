"""SSH 호스트 WebSocket — 원격 셸(대개 원격 tmux)에 attach.

인증·티켓 갱신 규칙은 터미널 WS(routes/terminal_ws.py)와 동일하다. 다른 점은
목적지가 로컬 tmux 가 아니라 SSH 연결이라는 것뿐이다.
"""
from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from _deps import is_safe_id
from cache import invalidate_host
from host_manager import HostBridge, resolve_host_secrets
import local_mux
from sqlite_storage import storage
from tickets import _push_ws_tickets
from ws_auth import authenticate_ws
from ws_clients import _register_ws_client, _unregister_ws_client
from ws_observe import log_attach, log_detach

import session_tombstones  # noqa: E402  (지역 모듈 — 위 블록과 분리)

logger = logging.getLogger(__name__)

router = APIRouter()

@router.websocket("/ws/host/{host_id}")
async def host_websocket(
    websocket: WebSocket,
    host_id: str,
    ticket: str | None = Query(None),
    client_id: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    pane_index: int = Query(0, description="0 이면 base 세션, 1+ 면 base.N+1 세션"),
    cwd: str | None = Query(None, description="이 연결에서 사용할 시작 디렉토리. 비우면 host.last_cwd → host.start_path 순으로 폴백."),
    tmux_suffix: str | None = Query(None, description="새 호스트 탭마다 base session 분리용 suffix. 영문/숫자/하이픈만, 32자 이내."),
    tmux_session_name: str | None = Query(None, description="명시적 tmux 세션명 override (기존 영속 세션 Resume). 주어지면 base/suffix/pane 계산 무시."),
    create: bool = Query(True, description="false면 없는 원격 tmux 세션을 새로 만들지 않고 연결만 시도"),
    reason: str | None = Query(None, description="클라이언트가 이 연결을 연 사유(관측 전용, ws_observe 참고)"),
    prev_ms: int | None = Query(None, description="직전 소켓이 살아있던 시간(ms). 요동과 단발 끊김을 구별한다."),
):
    if not is_safe_id(host_id):
        await websocket.close(code=1008, reason="유효하지 않은 호스트 ID")
        return

    ws_path = f"/ws/host/{host_id}"
    # 티켓 우선, 없거나 만료면 same-origin 쿠키 폴백(ws_auth 참고).
    username = await authenticate_ws(websocket, ws_path, ticket)
    if not username:
        await websocket.close(code=1008, reason="인증 필요")
        return

    host = await storage.get_host(host_id, username)
    if not host:
        await websocket.close(code=1008, reason="호스트를 찾을 수 없음")
        return

    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
        if not key_record:
            await websocket.close(code=1008, reason="연결된 SSH 키를 찾을 수 없음")
            return

    secrets = resolve_host_secrets(host, key_record)
    await websocket.accept()
    try:
        await storage.touch_host(host_id, username)
    except Exception:
        pass

    # 무엇으로 열지는 **전역 설정**이 정한다 — "설정에서 herdr 로 두면 앞으로 여는 건
    # 전부 herdr". 호스트 행에 값이 있으면(옛 `use_remote_tmux=0` 포함) 그것이 이긴다.
    default_multiplexer = await local_mux.choice_for(username)

    effective_cwd = (cwd or "").strip() or None
    # cwd 가 명시적으로 들어왔으면 last_cwd 갱신 (다음 접속에서 폴백 기본값으로 사용)
    if effective_cwd:
        try:
            await storage.update_host_last_cwd(host_id, username, effective_cwd)
        except Exception as e:
            logger.warning("update_host_last_cwd failed (%s): %s", host_id, e)

    # tmux_suffix sanitize — 영문/숫자/하이픈만, 32자 이내. 호스트 새 탭마다
    # 이 값이 다르면 base session 자동 분리 (mobile-abc1, mobile-def2 ...).
    safe_suffix: str | None = None
    if tmux_suffix:
        import re as _re
        s = _re.sub(r"[^a-zA-Z0-9-]", "", tmux_suffix)[:32]
        if s:
            safe_suffix = s

    # tmux_session_name sanitize — tmux 세션명 허용 문자: 영문/숫자/하이픈/언더스코어/점, 64자 이내.
    # 점 (.) 은 base.N+1 같은 분할 세션명을 그대로 받기 위함.
    safe_session_name: str | None = None
    if tmux_session_name:
        import re as _re
        s = _re.sub(r"[^a-zA-Z0-9._-]", "", tmux_session_name)[:64]
        if s:
            safe_session_name = s

    from host_manager import DEFAULT_REMOTE_TMUX_SESSION, effective_tmux_session
    if safe_session_name:
        target_tmux_session = safe_session_name
    else:
        base_session = host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION
        if safe_suffix:
            base_session = f"{base_session}-{safe_suffix}"
        target_tmux_session = effective_tmux_session(base_session, pane_index)

    # auth_method == 'tailscale' → tailscale ssh subprocess 로 연결 (SSH 키 불필요)
    # ⚠️ **일부러 지운 세션은 되살리지 않는다.** 브리지는 세션이 없으면 만드는데, 그건
    # 호스트 재부팅 복구용이다. 사용자가 방금 지운 것이라면 그 복구가 정반대로 작동해
    # "지워도 다시 생긴다" 가 된다. 무덤은 수명이 짧아(90s) 재접속 한 번만 막는다.
    # ⚠️ **재접속 루프를 여기서 끊는다.** `create` 만 끄면 붙기는 하고, 세션이 없으니
    # `session-gone` 이 나가고, 클라이언트는 그걸 "새로 만들라" 로 읽어 create=1 로 다시
    # 온다 — 거절해도 그 고리가 계속 돌고 무덤이 만료되는 순간 되살아난다.
    # 사용자가 지운 것은 **끝난 것**이므로, 붙기 전에 그렇게 말하고 닫는다. 클라이언트는
    # 셸이 exit 했을 때와 같은 길로 가서 pane 을 닫는다(재시도하지 않는다).
    if session_tombstones.was_killed(host_id, target_tmux_session):
        logger.info("session was terminated by the user, closing: %s/%s",
                    host_id[:8], target_tmux_session)
        await websocket.accept()
        try:
            await websocket.send_json({
                "type": "session-terminated",
                "message": "이 세션은 종료되었습니다.",
            })
        except Exception:
            pass
        await websocket.close(code=1000)
        return

    if host.get("auth_method") == "tailscale":
        from host_manager import TailscaleHostBridge
        bridge = TailscaleHostBridge(
            websocket=websocket,
            host=host,
            default_multiplexer=default_multiplexer,
            cols=cols,
            rows=rows,
            pane_index=pane_index,
            cwd=effective_cwd,
            tmux_suffix=safe_suffix,
            tmux_session_name=safe_session_name,
            create_session=create,
        )
    else:
        bridge = HostBridge(
            websocket=websocket,
            host=host,
            default_multiplexer=default_multiplexer,
            private_key=secrets["private_key"],
            passphrase=secrets["passphrase"],
            password=secrets["password"],
            cols=cols,
            rows=rows,
            pane_index=pane_index,
            cwd=effective_cwd,
            tmux_suffix=safe_suffix,
            tmux_session_name=safe_session_name,
            create_session=create,
        )
    opened_at = time.monotonic()
    log_attach(
        kind=f"host/{host_id[:8]}", session=target_tmux_session, user=username,
        client_id=client_id, reason=reason, prev_ms=prev_ms, cols=cols, rows=rows,
    )
    usage_event_id = None
    client_token = _register_ws_client("host", f"{host_id}:{target_tmux_session}", client_id, websocket)
    try:
        usage_event_id = await storage.record_usage_start(
            username, "host", host_id, target_tmux_session
        )
    except Exception as e:
        logger.warning("usage start record failed (host %s): %s", host_id, e)
    # 새 attach/spawn 으로 세션 목록/클라이언트 수가 바뀌었을 수 있음 — 캐시 무효화.
    await invalidate_host(host_id)
    ticket_pusher = asyncio.create_task(_push_ws_tickets(bridge, username, ws_path))
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("host WS bridge error (%s): %s", host_id, e, exc_info=True)
    finally:
        ticket_pusher.cancel()
        if usage_event_id is not None:
            try:
                await storage.record_usage_end(usage_event_id)
            except Exception as e:
                logger.warning("usage end record failed (host %s): %s", host_id, e)
        # 연결 종료 시 client 수가 바뀌었을 수 있음 — invalidate.
        await invalidate_host(host_id)
        _unregister_ws_client("host", f"{host_id}:{target_tmux_session}", client_token)
        log_detach(kind=f"host/{host_id[:8]}", session=target_tmux_session,
                   client_id=client_id, opened_at=opened_at)


