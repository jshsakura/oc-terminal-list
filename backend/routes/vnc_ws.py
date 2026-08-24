"""noVNC WebSocket — 브라우저 ↔ 원격 Xvnc RFB 바이너리 터널.

인증·소유권 규칙은 routes/host_ws.py 와 동일하다. 다른 점은 목적지가
인터랙티브 셸이 아니라 ``127.0.0.1:5900+display`` 의 RFB(Remote Frame Buffer)
바이너리 스트림이라는 것이다.

⚠️ VNC WS 로는 **어떤 제어 메시지도 보내지 않는다.** 스트림은 순수 RFB 바이너리여야
한다. 터미널 WS 의 티켓 푸셼(``_push_ws_tickets``) 을 재사용하면 텍스트 JSON 프레임이
RFB 바이트 사이에 끼어들어 noVNC 핸드셰이크가 깨진다. 재연결은 same-origin 쿠키
인증(ws_auth) 으로 충분하다 — 티켓을 밀어넣을 이유가 없다.

전송 계층은 호스트 종류에 따라 둘로 갈라진다:
  - key/password → asyncssh direct-tcpip 채널 (SSH 터널)
  - tailscale    → tailscale ssh 서브프로세스로 원격 loopback 파이프 (WireGuard 암호화)

⚠️ tailscale 호스트는 asyncssh 연결이 없으므로 direct-tcpip 가 불가능하다. Xvnc 가
``-localhost yes`` 로 127.0.0.1 에만 바인딩되므로 tailscale IP 직접 TCP 도 거부된다.
대신 ``tailscale ssh`` 서브프로세스로 SSH 채널을 열고 원격에서 nc/ncat/bash-dev/tcp
폴백 체인으로 loopback 에 바이너리 파이프한다.

⚠️ ssh_pool 을 쓰지 않는다. ssh_pool janitor 가 300s idle 커넥션을 닫아버리는데,
RFB 스트림은 ssh_pool.run() 을 거치지 않아 last_used 가 갱신되지 않는다 — 그러면
화면을 보는 중에도 5분 뒤 끊긴다. 그래서 전용 연결을 연다.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from _deps import is_safe_id
from host_manager import open_connection, resolve_host_secrets
from routes.vnc import LOCAL_HOST_ID
from sqlite_storage import storage
from ws_auth import authenticate_ws
from ws_clients import _register_ws_client, _unregister_ws_client

logger = logging.getLogger(__name__)

router = APIRouter()

# RFB 한 번의 send 에 허용하는 시간. 처리량이 아니라 **죽은 피어**를 재는 값이다 —
# 근거는 _stream_to_ws 의 docstring 에 있다(5초이던 시절 해상도 변경이 연결을 끊었다).
VNC_SEND_TIMEOUT_SEC = max(5, int(os.getenv("VNC_SEND_TIMEOUT_SEC", "60")))


async def _ws_to_stream(websocket: WebSocket, writer) -> None:
    """브라우저 → RFB 스트림: receive_bytes → writer.write + drain.

    RFB 는 바이너리 프로토콜이므로 반드시 receive_bytes() 를 쓴다 — receive_text() 로
    받으면 UTF-8 디코딩이 RFB 바이트를 망가뜨린다.
    """
    try:
        while True:
            data = await websocket.receive_bytes()
            if not data:
                continue
            writer.write(data)
            await writer.drain()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("ws→stream pump ended (vnc): %s", type(e).__name__)


async def _stream_to_ws(reader, websocket: WebSocket) -> None:
    """RFB 스트림 → 브라우저: reader.read → send_bytes (바이너리).

    상한이 필요한 이유는 그대로다 — 죽은 피어에 대고 send buffer 를 무한히 쌓으면 안 된다.

    ⚠️ **그 상한이 5초이던 시절, 해상도를 바꾸면 연결이 끊겼다.** 원인은 이 값이
    ``HostBridge._stdout_pump`` 에서 그대로 복사돼 왔다는 것이다. 터미널 출력은 조금씩
    계속 나오지만 **RFB 는 몰아친다**: 화면 크기가 바뀌면 서버가 전체 프레임버퍼를 한꺼번에
    보낸다(1868x1594 면 수 MB). 청크는 64KB 씩 읽지만 `send_bytes` 는 전송 버퍼가 고수위를
    넘는 순간 **밀린 것이 다 빠질 때까지** 기다리므로, 공유 터널에서는 한 번의 await 가
    쉽게 5초를 넘는다. 그러면 이 코드가 멀쩡한 연결을 "죽었다" 고 판정해 스스로 끊었다.

    그래서 이 값은 **처리량이 아니라 죽음을 재는 값**이어야 한다. 정말 죽은 피어는 넉넉한
    상한에서도 결국 걸리고, TCP close 는 그 전에 read 쪽에서 잡힌다.
    (`VNC_SEND_TIMEOUT_SEC` 로 조정 — 화질을 올리면 페이로드도 커진다는 점을 같이 볼 것.)
    """
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break  # 스트림 EOF
            if websocket.client_state.name != "CONNECTED":
                break
            try:
                await asyncio.wait_for(
                    websocket.send_bytes(data), timeout=VNC_SEND_TIMEOUT_SEC
                )
            except TimeoutError:
                # 정상 연결을 끊는 자리다 — 왜 끊었는지 로그가 말해야 한다.
                logger.warning(
                    "ws send timeout (vnc): %ds 안에 %d바이트를 못 보냈다 — 닫는다. "
                    "해상도 변경 직후라면 상한이 낮은 것이다(VNC_SEND_TIMEOUT_SEC).",
                    VNC_SEND_TIMEOUT_SEC, len(data),
                )
                break
            except Exception as e:
                logger.info("ws send failed (vnc): %s", e)
                break
    except Exception as e:
        logger.debug("stream→ws pump ended (vnc): %s", type(e).__name__)


async def _spawn_tailscale_vnc_pipe(host: dict, vnc_port: int) -> asyncio.subprocess.Process:
    """tailscale ssh 서브프로세스로 원격 127.0.0.1:vnc_port 에 바이너리 파이프를 연다.

    Xvnc 는 ``-localhost yes`` 로 127.0.0.1 에만 바인딩되므로 tailscale IP 로는 직접
    연결이 거부된다. ``tailscale ssh`` 로 SSH 채널을 열고 원격에서 nc → ncat → bash
    /dev/tcp 폴백 체인으로 loopback 에 파이프한다. WireGuard 가 전송을 암호화한다.

    ``-t`` (PTY) 를 주지 않는다 — RFB 는 바이너리 프로토콜이므로 PTY 라인 디스플린이
    바이트를 망가뜨린다. 순수 파이프(stdin/stdout) 모드로 연다.
    """
    if not shutil.which("tailscale"):
        raise RuntimeError("tailscale 바이너리를 찾을 수 없음")

    ssh_user = host.get("ssh_user") or os.environ.get("USER") or "root"
    target = f"{ssh_user}@{host['hostname']}"

    # SSH quoting: tailscale ssh target <cmd> → 원격 $SHELL -c "<cmd>".
    # 다단 인자를 주면 원격 셸이 단어 단위로 쪼개버리므로 단일 문자열로 전달한다.
    # nc → ncat → bash /dev/tcp 폴백. vnc_port 는 검증된 int (5900-5999) — 주입 위험 없음.
    remote_cmd = (
        f"if command -v nc >/dev/null 2>&1; then exec nc 127.0.0.1 {vnc_port}; "
        f"elif command -v ncat >/dev/null 2>&1; then exec ncat 127.0.0.1 {vnc_port}; "
        f"else exec bash -c 'exec 3<>/dev/tcp/127.0.0.1/{vnc_port}; cat >&3 & cat <&3'; fi"
    )
    argv = ["tailscale", "ssh", target, remote_cmd]

    return await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


async def _drain_stderr(proc: asyncio.subprocess.Process) -> None:
    """서브프로세스 stderr 를 버려 버퍼 가득 참으로 인한 블록을 방지."""
    try:
        stream = proc.stderr
        if stream is None:
            return
        while True:
            data = await stream.read(4096)
            if not data:
                break
            logger.debug(
                "tailscale vnc stderr: %s", data.decode("utf-8", errors="replace").strip()
            )
    except Exception:
        pass


async def _terminate_proc(proc: asyncio.subprocess.Process) -> None:
    """tailscale ssh 서브프로세스 정리 — SIGTERM → 3s 대기 → SIGKILL 폴백 (좀비 방지)."""
    try:
        proc.terminate()
    except ProcessLookupError:
        return  # 이미 종료됨
    except Exception:
        pass
    try:
        await asyncio.wait_for(proc.wait(), timeout=3.0)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        try:
            await proc.wait()
        except Exception:
            pass


def _select_subprotocol(scope: dict) -> str | None:
    """클라이언트가 제시한 서브프로토콜 목록에서 'binary' 를 선택한다.

    RFC 6455: 클라이언트가 Sec-WebSocket-Protocol 로 제시한 값 중 하나를 서버가
    응답에 포함하지 않으면 브라우저가 연결을 실패 처리한다. noVNC(RFB) 는
    ``wsProtocols:['binary']`` 로 열므로 'binary' 가 있으면 반드시 선택해야 한다.
    클라이언트가 제시하지 않은 값을 임의로 고르면 안 된다 — 그것도 실패한다.
    """
    subprotocols = scope.get("subprotocols") or []
    return "binary" if "binary" in subprotocols else None


@router.websocket("/ws/vnc/{host_id}")
async def vnc_websocket(
    websocket: WebSocket,
    host_id: str,
    display: int = Query(...),
    ticket: str | None = Query(None),
    client_id: str | None = Query(None),
):
    # 1. host_id 형식 검증
    if not is_safe_id(host_id):
        await websocket.close(code=1008, reason="유효하지 않은 호스트 ID")
        return

    ws_path = f"/ws/vnc/{host_id}"
    # 2. 인증 — 티켓 우선, same-origin 쿠키 폴백 (ws_auth 참고)
    username = await authenticate_ws(websocket, ws_path, ticket)
    if not username:
        await websocket.close(code=1008, reason="인증 필요")
        return

    # 3. 소유권 — 본인 호스트인지. 'local' 은 이 서버 자신이라 DB 에 없다.
    if host_id == LOCAL_HOST_ID:
        host = {"id": LOCAL_HOST_ID, "name": "local", "is_local": True}
    else:
        host = await storage.get_host(host_id, username)
        if not host:
            await websocket.close(code=1008, reason="호스트를 찾을 수 없음")
            return

    # 4. 디스플레이 번호 검증 — 0..99 (5900..5999)
    if not (0 <= display <= 99):
        await websocket.close(code=1008, reason="잘못된 디스플레이 번호")
        return

    vnc_port = 5900 + display

    # 5. WS 수락 — noVNC 가 'binary' 서브프로토콜을 요청하면 반드시 선택해야 한다.
    chosen = _select_subprotocol(websocket.scope)
    await websocket.accept(subprotocol=chosen)

    # 6. 전송 계층 오픈 — key/password (asyncssh direct-tcpip) vs tailscale (직접 TCP)
    conn = None  # asyncssh.SSHClientConnection | None (tailscale 은 None)
    proc = None  # tailscale ssh subprocess | None (key/pass 는 None)
    reader = None
    writer = None
    auth_method = host.get("auth_method")
    try:
        if host.get("is_local"):
            # 이 서버 자신 — 백엔드가 도는 기계가 곧 대상이다. SSH 채널도 터널도
            # 필요 없고, Xvnc 가 바인딩한 루프백에 그냥 붙는다. 가장 짧은 경로다.
            reader, writer = await asyncio.open_connection("127.0.0.1", vnc_port)
        elif auth_method == "tailscale":
            # tailscale 호스트는 asyncssh 연결이 없다 (tailscale ssh 서브프로세스).
            # direct-tcpip 불가능 — Xvnc 가 -localhost yes 로 127.0.0.1 에만 바인딩되므로
            # tailscale IP 직접 TCP 도 거부된다. tailscale ssh 로 원격 loopback 에 파이프.
            proc = await _spawn_tailscale_vnc_pipe(host, vnc_port)
            reader = proc.stdout
            writer = proc.stdin
        else:
            # key/password — 전용 SSH 연결을 연다 (ssh_pool 절대 사용 금지, 위 주석 참고).
            key_record = None
            if auth_method == "key" and host.get("key_id"):
                key_record = await storage.get_ssh_key(host["key_id"], username)
                if not key_record:
                    await websocket.close(code=1011, reason="연결된 SSH 키를 찾을 수 없음")
                    return
            secrets = resolve_host_secrets(host, key_record)
            conn = await open_connection(
                host,
                private_key=secrets["private_key"],
                passphrase=secrets["passphrase"],
                password=secrets["password"],
            )
            # direct-tcpip 채널 — (SSHReader, SSHWriter) 반환
            reader, writer = await conn.open_connection("127.0.0.1", vnc_port)
    except Exception as e:
        logger.error(
            "VNC transport open failed (%s, display %d): %s",
            host_id, display, e, exc_info=True,
        )
        try:
            await websocket.close(code=1011, reason=f"VNC 포트 {vnc_port} 연결 실패: {e}")
        except Exception:
            pass
        # 열어둔 연결/채널이 있다면 정리
        if writer is not None:
            try:
                writer.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if proc is not None:
            await _terminate_proc(proc)
        return

    # 7. 양방향 바이너리 펌프 (+ tailscale stderr 드레인)
    #    ⚠️ 티켓 푸셔를 쓰지 않는다 — VNC 스트림은 순수 RFB 바이너리여야 한다.
    stderr_drain = None
    if proc is not None:
        stderr_drain = asyncio.create_task(_drain_stderr(proc))
    pump_ws = asyncio.create_task(_ws_to_stream(websocket, writer))
    pump_stream = asyncio.create_task(_stream_to_ws(reader, websocket))

    client_token = _register_ws_client("vnc", f"{host_id}:{display}", client_id, websocket)
    try:
        await asyncio.wait({pump_ws, pump_stream}, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("vnc WS pump error (%s): %s", host_id, e, exc_info=True)
    finally:
        # 8. 정리 — 펌프/stderr 드레인 취소, 채널/연결/서브프로세스 종료
        pump_ws.cancel()
        pump_stream.cancel()
        if stderr_drain is not None:
            stderr_drain.cancel()
            await asyncio.gather(pump_ws, pump_stream, stderr_drain, return_exceptions=True)
        else:
            await asyncio.gather(pump_ws, pump_stream, return_exceptions=True)
        if writer is not None:
            try:
                writer.close()
            except Exception:
                pass
            try:
                await writer.wait_closed()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            try:
                await conn.wait_closed()
            except Exception:
                pass
        if proc is not None:
            await _terminate_proc(proc)
        _unregister_ws_client("vnc", f"{host_id}:{display}", client_token)
