"""SSH 호스트 WebSocket — 원격 셸(대개 원격 tmux)에 attach.

인증·티켓 갱신 규칙은 터미널 WS(routes/terminal_ws.py)와 동일하다. 다른 점은
목적지가 로컬 tmux 가 아니라 SSH 연결이라는 것뿐이다.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from _deps import is_safe_id
from cache import invalidate_host
from host_manager import HostBridge, resolve_host_secrets
from sqlite_storage import storage
from tickets import _push_ws_tickets
from ws_auth import authenticate_ws
from ws_clients import _register_ws_client, _unregister_ws_client

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
    if host.get("auth_method") == "tailscale":
        from host_manager import TailscaleHostBridge
        bridge = TailscaleHostBridge(
            websocket=websocket,
            host=host,
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


