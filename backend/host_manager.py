"""
SSH 호스트 연결 매니저.

asyncssh 로 호스트에 접속한 뒤, 원격에 tmux 가 있으면 `tmux new -A -s <name>`
으로 영속 세션에 attach 한다. 세션은 원격 tmux 서버가 보유하므로 우리 백엔드가
재시작되어도, 사용자가 SSH 로 직접 같은 호스트에 붙어도 같은 화면이 보인다.
"""
from __future__ import annotations

import asyncio
import logging
import shlex
from typing import Optional

import asyncssh
from fastapi import WebSocket, WebSocketDisconnect

from vault import decrypt_str

logger = logging.getLogger(__name__)

DEFAULT_REMOTE_TMUX_SESSION = "mobile"
CONNECT_TIMEOUT = 15  # 초
KEEPALIVE_INTERVAL = 30
KEEPALIVE_COUNT_MAX = 3


class HostConnectError(RuntimeError):
    """호스트 연결 실패"""


def _build_remote_command(use_tmux: bool, tmux_session: str) -> Optional[str]:
    """원격에서 실행할 명령. tmux 없으면 기본 셸을 그대로 띄운다."""
    if not use_tmux:
        return None
    safe = shlex.quote(tmux_session or DEFAULT_REMOTE_TMUX_SESSION)
    # tmux 가 없을 때 graceful fallback — 기본 로그인 셸로 떨어짐
    return (
        f"command -v tmux >/dev/null 2>&1 && "
        f"exec tmux -CC new-session -A -s {safe} 2>/dev/null || "
        f"exec tmux new-session -A -s {safe} 2>/dev/null || "
        f"exec ${{SHELL:-bash}} -l"
    )


async def open_connection(
    host: dict,
    *,
    private_key: Optional[str] = None,
    passphrase: Optional[str] = None,
    password: Optional[str] = None,
    known_hosts: bool = False,  # v1: TOFU off (모든 호스트 키 수락). v2: known_hosts 관리.
) -> asyncssh.SSHClientConnection:
    """SSH 연결을 연다. 호출자가 finally 에서 close() 해야 함."""
    options = {
        "host": host["hostname"],
        "port": int(host.get("port") or 22),
        "username": host["ssh_user"],
        "known_hosts": None if not known_hosts else None,  # TOFU
        "connect_timeout": CONNECT_TIMEOUT,
        "keepalive_interval": KEEPALIVE_INTERVAL,
        "keepalive_count_max": KEEPALIVE_COUNT_MAX,
    }

    auth_method = host.get("auth_method") or "key"
    if auth_method == "key":
        if not private_key:
            raise HostConnectError("개인키가 필요한 호스트인데 키를 찾을 수 없음")
        options["client_keys"] = [
            asyncssh.import_private_key(private_key, passphrase or None)
        ]
    elif auth_method == "password":
        if not password:
            raise HostConnectError("비밀번호 인증인데 비밀번호가 없음")
        options["password"] = password
    elif auth_method == "agent":
        # 사용자 머신의 SSH 에이전트 forwarding (v2)
        raise HostConnectError("agent 인증은 아직 지원하지 않음")
    else:
        raise HostConnectError(f"알 수 없는 인증 방식: {auth_method}")

    try:
        conn = await asyncssh.connect(**options)
        return conn
    except (asyncssh.PermissionDenied, asyncssh.misc.ChannelOpenError) as e:
        raise HostConnectError(f"인증 실패: {e}") from e
    except (OSError, asyncio.TimeoutError) as e:
        raise HostConnectError(f"연결 실패: {e}") from e


class HostBridge:
    """WebSocket ↔ asyncssh 인터랙티브 셸 양방향 펌프."""

    def __init__(
        self,
        websocket: WebSocket,
        host: dict,
        *,
        private_key: Optional[str],
        passphrase: Optional[str],
        password: Optional[str],
        cols: int,
        rows: int,
    ):
        self.websocket = websocket
        self.host = host
        self.private_key = private_key
        self.passphrase = passphrase
        self.password = password
        self.cols = max(int(cols or 80), 1)
        self.rows = max(int(rows or 24), 1)
        self.conn: Optional[asyncssh.SSHClientConnection] = None
        self.process: Optional[asyncssh.SSHClientProcess] = None
        self._closed = asyncio.Event()

    async def _connect(self) -> None:
        self.conn = await open_connection(
            self.host,
            private_key=self.private_key,
            passphrase=self.passphrase,
            password=self.password,
        )

        use_tmux = bool(self.host.get("use_remote_tmux", 1))
        tmux_session = self.host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION
        cmd = _build_remote_command(use_tmux, tmux_session)

        # PTY 요청해서 인터랙티브 셸로 동작
        self.process = await self.conn.create_process(
            command=cmd,  # None 이면 기본 셸
            term_type="xterm-256color",
            term_size=(self.cols, self.rows),
        )

    async def _stdout_pump(self) -> None:
        assert self.process is not None
        try:
            async for chunk in self.process.stdout:
                if not chunk:
                    continue
                if self.websocket.client_state.name != "CONNECTED":
                    break
                try:
                    await self.websocket.send_text(chunk)
                except Exception as e:
                    logger.info("ws send failed (host bridge): %s", e)
                    break
        except (asyncssh.ChannelOpenError, asyncssh.ConnectionLost):
            pass
        finally:
            self._closed.set()

    async def _input_pump(self) -> None:
        assert self.process is not None
        import json
        try:
            while not self._closed.is_set():
                data = await self.websocket.receive_text()
                stripped = data.strip()
                if stripped.startswith("{") and stripped.endswith("}"):
                    try:
                        msg = json.loads(stripped)
                        if isinstance(msg, dict) and msg.get("type") == "resize":
                            cols = int(msg.get("cols") or self.cols)
                            rows = int(msg.get("rows") or self.rows)
                            if cols != self.cols or rows != self.rows:
                                self.cols, self.rows = cols, rows
                                self.process.change_terminal_size(cols, rows)
                            continue
                    except Exception:
                        pass
                self.process.stdin.write(data)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.info("ws recv error (host bridge): %s", e)
        finally:
            self._closed.set()

    async def run(self) -> None:
        try:
            await self._connect()
        except HostConnectError as e:
            try:
                await self.websocket.send_text(f"\r\n\x1b[31m[연결 실패] {e}\x1b[0m\r\n")
                await self.websocket.close(code=1011, reason=str(e))
            except Exception:
                pass
            return
        except Exception as e:
            logger.error("host connect unexpected error: %s", e, exc_info=True)
            try:
                await self.websocket.send_text(f"\r\n\x1b[31m[연결 오류] {e}\x1b[0m\r\n")
                await self.websocket.close(code=1011, reason=str(e))
            except Exception:
                pass
            return

        out_task = asyncio.create_task(self._stdout_pump())
        in_task = asyncio.create_task(self._input_pump())
        try:
            await self._closed.wait()
        finally:
            for t in (out_task, in_task):
                if not t.done():
                    t.cancel()
            for t in (out_task, in_task):
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
            await self._teardown()

    async def _teardown(self) -> None:
        try:
            if self.process is not None:
                self.process.terminate()
        except Exception:
            pass
        try:
            if self.conn is not None:
                self.conn.close()
                await self.conn.wait_closed()
        except Exception:
            pass


def resolve_host_secrets(host: dict, key_record: Optional[dict]) -> dict:
    """저장된 호스트/키 레코드에서 vault 복호화한 secret 들을 추출."""
    private_key: Optional[str] = None
    passphrase: Optional[str] = None
    password: Optional[str] = None

    auth_method = host.get("auth_method") or "key"
    if auth_method == "key" and key_record is not None:
        private_key = decrypt_str(key_record.get("private_key_enc"))
        passphrase = decrypt_str(key_record.get("passphrase_enc"))
    elif auth_method == "password":
        password = decrypt_str(host.get("password_enc"))

    return {
        "private_key": private_key,
        "passphrase": passphrase,
        "password": password,
    }
