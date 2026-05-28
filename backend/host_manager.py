"""
SSH 호스트 연결 매니저.

asyncssh 로 호스트에 접속한 뒤, 원격에 tmux 가 있으면 `tmux new -A -s <name>`
으로 영속 세션에 attach 한다. 세션은 원격 tmux 서버가 보유하므로 우리 백엔드가
재시작되어도, 사용자가 SSH 로 직접 같은 호스트에 붙어도 같은 화면이 보인다.
"""
from __future__ import annotations

import asyncio
import codecs
import json
import logging
import os
import re
import shlex
import shutil as _shutil
from collections import deque

import asyncssh
import ptyprocess
from fastapi import WebSocket, WebSocketDisconnect

from vault import decrypt_str

logger = logging.getLogger(__name__)

DEFAULT_REMOTE_TMUX_SESSION = "mobile"
CONNECT_TIMEOUT = 15  # 초
# RPi5 등 wifi/배터리 호스트의 idle drop 빠르게 감지 — 15s × 4 = 1분 안에 끊긴 것 검출.
KEEPALIVE_INTERVAL = 15
KEEPALIVE_COUNT_MAX = 4

# WS 백프레셔 캡 — ws_bridge.py 와 동일한 의미.
# tailscale ssh PTY → WS 펌프가 동기 콜백(add_reader)으로 읽고 메인 루프가 비우는
# 구조라 WS 가 느려지거나 끊긴 동안 무한 누적 가능. byte/item 양쪽으로 캡 걸어
# 오래된 청크부터 폐기한다.
WS_MAX_BACKPRESSURE_BYTES = 4 * 1024 * 1024
WS_MAX_PENDING_ITEMS = 8192
WS_FLUSH_CHUNK_BYTES = 65536
PTY_INPUT_CHUNK_BYTES = 8192


class HostConnectError(RuntimeError):
    """호스트 연결 실패"""


_SAFE_PATH_RE = re.compile(r"[\w./~+\-]+")

def _shell_path(p: str) -> str:
    """경로를 원격 셸이 ~ 확장 가능한 형태로 안전하게 표현.

    - 안전한 문자만 있으면 quote 없이 그대로 (`~/...`, `/var/foo` → 그대로 통과).
    - 그 외에는 shlex.quote (이 경우 ~ 확장 안 됨, 안전 우선).
    """
    if _SAFE_PATH_RE.fullmatch(p or ""):
        return p
    return shlex.quote(p)


def effective_tmux_session(base: str, pane_index: int = 0) -> str:
    """pane index 별 tmux 세션 이름 부여.

    pane 0 = 기본 이름 (영속/재attach 용도). pane 1+ = `base_N+1` 자동 접미.

    NOTE: 분리자로 `.` 을 쓰면 안 됨 — tmux 의 target spec 이 `session:window.pane`
    형식이라 `name.2` 가 "session=name, pane=2" 로 파싱되어 "can't find pane: 2"
    에러. tmux 는 세션명의 `.` 도 내부적으로 `_` 로 치환하므로 우리도 `_` 사용.
    """
    base = base or DEFAULT_REMOTE_TMUX_SESSION
    if not pane_index:
        return base
    return f"{base}_{int(pane_index) + 1}"


def _build_remote_command(
    use_tmux: bool,
    tmux_session: str,
    start_path: str | None = None,
    *,
    create_session: bool = True,
) -> str | None:
    """원격에서 실행할 명령. tmux 없으면 기본 셸로 fallback.

    - tmux -CC (control mode) 는 xterm.js 와 프로토콜 불일치라 사용 안 함.
    - start_path 가 주어지면 tmux -c 로 신규 세션 시작 디렉토리 지정. 기존 세션 재attach 시엔 무시됨(tmux 동작).
    - window-size latest + 연결 직후 resize 메시지로 새 클라이언트 PTY 크기 즉시 적용.
    - -d 없이 attach — 여러 기기 동시 접속 허용, 마지막 resize 를 보낸 클라이언트 크기로 동기화.
    - 셸 fallback 에서는 cd 로 진입 후 로그인 셸.
    """
    if not use_tmux:
        if not create_session:
            return "printf '\\r\\n\\033[33m[session not found] this host does not keep a tmux shell to reconnect\\033[0m\\r\\n'; exit 42"
        if start_path:
            return f"cd {_shell_path(start_path)} 2>/dev/null; exec ${{SHELL:-bash}} -l"
        return None
    safe = shlex.quote(tmux_session or DEFAULT_REMOTE_TMUX_SESSION)
    cwd_arg = f" -c {_shell_path(start_path)}" if start_path else ""
    cd_prefix = f"cd {_shell_path(start_path)} 2>/dev/null; " if start_path else ""
    create_clause = (
        f"tmux has-session -t {safe} 2>/dev/null || tmux new-session -d -s {safe}{cwd_arg}; "
        if create_session
        else (
            f"tmux has-session -t {safe} 2>/dev/null || "
            f"{{ printf '\\r\\n\\033[33m[session not found] refresh could not find {tmux_session}\\033[0m\\r\\n'; exit 42; }}; "
        )
    )
    # 핵심: new-session 단계에서 stty size 로 PTY 차원 그대로 주입 → 80x24 기본 아래 시작 후
    # attach 시 리사이즈하느라 prompt 가 안 그려지는 race 방지.
    # mouse on — frontend 가 wheel/touch 를 SGR mouse 이벤트로 전달하고 tmux 가
    # copy-mode 스크롤을 담당한다. plain drag 선택은 frontend 의 보정층에서 처리한다.
    return (
        f"command -v tmux >/dev/null 2>&1 && {{ "
        f"{create_clause}"
        f"tmux set-option -t {safe} aggressive-resize on >/dev/null 2>&1; "
        f"tmux set-option -t {safe} mouse on >/dev/null 2>&1; "
        f"tmux set-option -t {safe} window-size latest >/dev/null 2>&1; "
        f"tmux set-option -t {safe} focus-events on >/dev/null 2>&1; "
        f"tmux set-option -t {safe} status off >/dev/null 2>&1; "
        f"tmux set-option -ag -t {safe} terminal-overrides ',*256col*:Tc' >/dev/null 2>&1; "
        f"tmux bind-key -T root PageUp if-shell -F '#{{alternate_on}}' 'send-keys PageUp' 'copy-mode -eu' >/dev/null 2>&1; "
        f"tmux bind-key -T root PageDown if-shell -F '#{{alternate_on}}' 'send-keys PageDown' '' >/dev/null 2>&1; "
        f"exec tmux attach-session -t {safe}; "
        f"}} || "
        f"{cd_prefix}exec ${{SHELL:-bash}} -l"
    )


def _make_kbdint_client(on_prompt):
    """asyncssh SSHClient subclass — keyboard-interactive 챌린지를 외부 콜백으로 위임.
    on_prompt(name, instructions, prompts) → list[str] (각 prompt 에 대한 응답).
    TrueNAS Scale 등 2FA 호스트의 TOTP/OTP prompt 를 사용자 모달로 받아 처리.
    """
    class _KbdIntClient(asyncssh.SSHClient):
        def kbdint_auth_requested(self):
            return ''  # 모든 submethod 허용

        async def kbdint_challenge_received(self, name, instructions, lang, prompts):
            try:
                values = await on_prompt(name or '', instructions or '', list(prompts))
            except Exception:
                return None
            if values is None:
                return None
            return [str(v) for v in values]
    return _KbdIntClient


async def open_connection(
    host: dict,
    *,
    private_key: str | None = None,
    passphrase: str | None = None,
    password: str | None = None,
    known_hosts: bool = False,  # v1: TOFU off (모든 호스트 키 수락). v2: known_hosts 관리.
    kbdint_prompter=None,  # async (name, instructions, prompts) → list[str], OTP/2FA 인터랙티브용
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

    if kbdint_prompter is not None:
        options["client_factory"] = _make_kbdint_client(kbdint_prompter)

    auth_method = host.get("auth_method") or "key"
    if auth_method == "key":
        if not private_key:
            raise HostConnectError("개인키가 필요한 호스트인데 키를 찾을 수 없음")
        options["client_keys"] = [
            asyncssh.import_private_key(private_key, passphrase or None)
        ]
        # password 자동 응답 금지 — kbd-interactive 챌린지는 항상 인터랙티브 prompt 로 받음.
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
    except (TimeoutError, OSError) as e:
        raise HostConnectError(f"연결 실패: {e}") from e


class HostBridge:
    """WebSocket ↔ asyncssh 인터랙티브 셸 양방향 펌프."""

    def __init__(
        self,
        websocket: WebSocket,
        host: dict,
        *,
        private_key: str | None,
        passphrase: str | None,
        password: str | None,
        cols: int,
        rows: int,
        pane_index: int = 0,
        cwd: str | None = None,
        tmux_suffix: str | None = None,
        tmux_session_name: str | None = None,
        create_session: bool = True,
    ):
        self.websocket = websocket
        self.host = host
        self.private_key = private_key
        self.passphrase = passphrase
        self.password = password
        self.cols = max(int(cols or 80), 1)
        self.rows = max(int(rows or 24), 1)
        self.pane_index = max(int(pane_index or 0), 0)
        self.cwd = (cwd or "").strip() or None
        self.tmux_suffix = (tmux_suffix or "").strip() or None
        # 명시적 세션명 override (Home 의 영속 세션 Resume 등). 주어지면 base/suffix/pane 계산 무시.
        self.tmux_session_name = (tmux_session_name or "").strip() or None
        self.create_session = bool(create_session)
        self.conn: asyncssh.SSHClientConnection | None = None
        self.process: asyncssh.SSHClientProcess | None = None
        self._closed = asyncio.Event()
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        # 출력 펌프와 pong 응답이 동시에 send 하지 않도록 직렬화.
        self._send_lock = asyncio.Lock()

    async def _ws_kbdint_prompter(self, name: str, instructions: str, prompts: list) -> list | None:
        """asyncssh keyboard-interactive 챌린지를 WS 로 사용자에게 전달하고 응답 수신.
        TOTP 같은 동적 2FA 에 필요. _connect 도중 호출되며 _input_pump 가 아직 안 켜져있어
        websocket.receive_text 직접 사용 가능."""
        try:
            payload = {
                "type": "auth-prompt",
                "name": name,
                "instructions": instructions,
                "prompts": [{"prompt": p[0], "echo": bool(p[1])} for p in prompts],
            }
            await self.websocket.send_text(json.dumps(payload))
        except Exception as e:
            logger.warning("auth-prompt send failed: %s", e)
            return None

        # 사용자 응답 (auth-response) 까지 다른 메시지 무시. 타임아웃 120s.
        try:
            deadline = 120.0
            while True:
                data = await asyncio.wait_for(self.websocket.receive_text(), timeout=deadline)
                if not data:
                    continue
                stripped = data.strip()
                if stripped.startswith("{") and stripped.endswith("}"):
                    try:
                        msg = json.loads(stripped)
                    except Exception:
                        msg = None
                    if isinstance(msg, dict):
                        if msg.get("type") == "auth-response":
                            values = msg.get("values") or []
                            return [str(v) for v in values]
                        if msg.get("type") == "auth-cancel":
                            return None
        except (TimeoutError, WebSocketDisconnect):
            return None
        except Exception as e:
            logger.warning("auth-prompt response wait failed: %s", e)
            return None

    async def _connect(self) -> None:
        self.conn = await open_connection(
            self.host,
            private_key=self.private_key,
            passphrase=self.passphrase,
            password=self.password,
            kbdint_prompter=self._ws_kbdint_prompter,
        )

        use_tmux = bool(self.host.get("use_remote_tmux", 1))
        if self.tmux_session_name:
            # 명시적 override — 기존 세션 그대로 attach (Home 의 Resume).
            tmux_session = self.tmux_session_name
        else:
            base_session = self.host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION
            # 호스트 새 탭 = 새 base session 분리. suffix 없으면 기존 동작 (옛 클라이언트 호환).
            if self.tmux_suffix:
                base_session = f"{base_session}-{self.tmux_suffix}"
            tmux_session = effective_tmux_session(base_session, self.pane_index)
        # 우선순위: 호출자 cwd (브라우저로 고른 경로) > host.last_cwd > host.start_path
        start_path = (
            self.cwd
            or (self.host.get("last_cwd") or "").strip()
            or (self.host.get("start_path") or "").strip()
            or None
        )
        cmd = _build_remote_command(use_tmux, tmux_session, start_path, create_session=self.create_session)

        if use_tmux:
            try:
                chk = await self.conn.run("command -v tmux 2>/dev/null", check=False)
                _tmux_found = bool((chk.stdout or "").strip())
            except Exception:
                _tmux_found = False
            if not _tmux_found:
                try:
                    import json as _json
                    await self.websocket.send_text(_json.dumps({
                        "type": "tmux-missing",
                        "message": "tmux not found on remote host — session will not persist",
                    }))
                except Exception:
                    pass

        # PTY 요청해서 인터랙티브 셸로 동작
        # encoding=None → bytes 스트림. read(n) 으로 비라인버퍼 읽기 (async for 는 줄단위라 화면갱신 지연됨)
        self.process = await self.conn.create_process(
            command=cmd,  # None 이면 기본 셸
            term_type="xterm-256color",
            term_size=(self.cols, self.rows),
            encoding=None,
        )

    async def _stdout_pump(self) -> None:
        """asyncssh PTY → WebSocket 출력 펌프.

        await read → await send 직렬 패턴이라 asyncssh 의 SSH window 가 자연
        backpressure 를 주지만, starlette/uvicorn 의 send_bytes 가 transport
        write buffer 에 fire-and-forget 으로 enqueue 만 하는 경우 (느린 클라
        + 죽은 TCP) 버퍼가 무한 누적될 수 있음. 매 send 전에 client_state 를
        재확인하고, 단일 send 가 5초 안에 안 끝나면 죽은 것으로 보고 종료.
        """
        assert self.process is not None
        try:
            while True:
                chunk: bytes = await self.process.stdout.read(65536)
                if not chunk:
                    break
                if self.websocket.client_state.name != "CONNECTED":
                    break
                try:
                    async with self._send_lock:
                        await asyncio.wait_for(self.websocket.send_bytes(chunk), timeout=5.0)
                except asyncio.TimeoutError:
                    logger.info("ws send timeout (host bridge) — closing")
                    break
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
                    except Exception:
                        msg = None
                    if isinstance(msg, dict) and msg.get("type") == "resize":
                        try:
                            cols = int(msg.get("cols") or self.cols)
                            rows = int(msg.get("rows") or self.rows)
                            if cols != self.cols or rows != self.rows:
                                self.cols, self.rows = cols, rows
                                self.process.change_terminal_size(cols, rows)
                        except Exception as e:
                            logger.debug("resize control ignored (%s): %s", self.host.get("id"), e)
                        continue
                    if isinstance(msg, dict) and msg.get("type") == "ping":
                        try:
                            async with self._send_lock:
                                await self.websocket.send_text('{"type":"pong"}')
                        except Exception as e:
                            logger.debug("pong send failed (%s): %s", self.host.get("id"), e)
                        continue
                raw = data.encode("utf-8", errors="replace") if isinstance(data, str) else data
                off = 0
                while off < len(raw):
                    self.process.stdin.write(raw[off:off + PTY_INPUT_CHUNK_BYTES])
                    drain = getattr(self.process.stdin, "drain", None)
                    if drain:
                        await drain()
                    off += PTY_INPUT_CHUNK_BYTES
                    await asyncio.sleep(0)
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


class TailscaleHostBridge:
    """`tailscale ssh user@host` 로 PTY spawn → WS 브리지.

    백엔드 서버의 tailscale 인증을 그대로 사용 (SSH 키 / 비밀번호 불필요).
    원격 명령(tmux attach 등) 은 `_build_remote_command` 결과를 그대로 인자로 전달.
    """

    READ_CHUNK = 65536

    def __init__(
        self,
        websocket: WebSocket,
        host: dict,
        *,
        cols: int,
        rows: int,
        pane_index: int = 0,
        cwd: str | None = None,
        tmux_suffix: str | None = None,
        tmux_session_name: str | None = None,
        create_session: bool = True,
    ):
        self.websocket = websocket
        self.host = host
        self.cols = max(int(cols or 80), 1)
        self.rows = max(int(rows or 24), 1)
        self.pane_index = max(int(pane_index or 0), 0)
        self.cwd = (cwd or "").strip() or None
        self.tmux_suffix = (tmux_suffix or "").strip() or None
        self.tmux_session_name = (tmux_session_name or "").strip() or None
        self.create_session = bool(create_session)
        self.process: ptyprocess.PtyProcess | None = None
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._closed = asyncio.Event()
        # 출력 펌프와 pong 응답이 동시에 send 하지 않도록 직렬화.
        self._send_lock = asyncio.Lock()

    def _build_argv(self) -> list[str]:
        ssh_user = self.host.get("ssh_user") or os.environ.get("USER") or "root"
        hostname = self.host["hostname"]
        target = f"{ssh_user}@{hostname}"
        use_tmux = bool(self.host.get("use_remote_tmux", 1))
        if self.tmux_session_name:
            tmux_session = self.tmux_session_name
        else:
            base_session = self.host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION
            if self.tmux_suffix:
                base_session = f"{base_session}-{self.tmux_suffix}"
            tmux_session = effective_tmux_session(base_session, self.pane_index)
        start_path = (
            self.cwd
            or (self.host.get("last_cwd") or "").strip()
            or (self.host.get("start_path") or "").strip()
            or None
        )
        cmd = _build_remote_command(use_tmux, tmux_session, start_path, create_session=self.create_session)
        argv = ["tailscale", "ssh", "-t", target]
        if cmd:
            argv.append(cmd)
        return argv

    def _spawn(self) -> None:
        if not _shutil.which("tailscale"):
            raise HostConnectError("tailscale binary not found on server")
        env = os.environ.copy()
        env.update({
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "LANG": env.get("LANG") or "ko_KR.UTF-8",
        })
        self.process = ptyprocess.PtyProcess.spawn(
            self._build_argv(),
            dimensions=(self.rows, self.cols),
            env=env,
        )
        try:
            os.set_blocking(self.process.fd, False)
        except Exception as e:
            logger.warning("failed to set tailscale pty nonblocking: %s", e)
        logger.info(
            "tailscale ssh spawned: target=%s pid=%s size=%dx%d",
            self.host.get("hostname"), self.process.pid, self.cols, self.rows,
        )

    async def _stdout_pump(self) -> None:
        """PTY → WebSocket 출력 펌프. 백프레셔 캡 + WS 단절 시 즉시 종료.

        add_reader 콜백은 동기라 await 못 함 → 버퍼링 후 메인 루프에서 비움.
        WS send 가 막혀있거나 client_state 가 CONNECTED 아닐 때 무한 누적 방지로
        byte/item 캡을 둔다 (가장 오래된 청크부터 폐기). 캡 없을 때 6.8GB 까지
        부풀어 OOM 으로 호스트가 사망하던 게 발견되어 추가됨.
        """
        assert self.process is not None
        loop = asyncio.get_event_loop()
        pending: deque[bytes] = deque()
        pending_bytes = 0

        def on_readable() -> None:
            nonlocal pending_bytes
            try:
                data = self.process.read(self.READ_CHUNK)
            except OSError as e:
                if getattr(e, "errno", None) in (11, 35):
                    return
                self._closed.set()
                return
            except Exception:
                self._closed.set()
                return
            if not data:
                return
            pending.append(data)
            pending_bytes += len(data)
            while (
                (pending_bytes > WS_MAX_BACKPRESSURE_BYTES or len(pending) > WS_MAX_PENDING_ITEMS)
                and len(pending) > 1
            ):
                pending_bytes -= len(pending.popleft())

        try:
            loop.add_reader(self.process.fd, on_readable)
        except Exception as e:
            logger.error("tailscale add_reader failed: %s", e)
            self._closed.set()
            return

        try:
            while not self._closed.is_set():
                if pending:
                    # WS 끊긴 상태면 즉시 종료 — 안 그러면 pending 만 계속 쌓임.
                    if self.websocket.client_state.name != "CONNECTED":
                        self._closed.set()
                        break
                    buf_parts: list[bytes] = []
                    size = 0
                    while pending and size < WS_FLUSH_CHUNK_BYTES:
                        chunk = pending.popleft()
                        buf_parts.append(chunk)
                        size += len(chunk)
                        pending_bytes = max(0, pending_bytes - len(chunk))
                    try:
                        async with self._send_lock:
                            await self.websocket.send_bytes(b"".join(buf_parts))
                    except Exception:
                        self._closed.set()
                        break
                if self.process and not self.process.isalive():
                    self._closed.set()
                    break
                await asyncio.sleep(0.02)
        finally:
            try:
                loop.remove_reader(self.process.fd)
            except Exception:
                pass

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
                    except Exception:
                        msg = None
                    if isinstance(msg, dict) and msg.get("type") == "resize":
                        try:
                            cols = max(int(msg.get("cols") or self.cols), 1)
                            rows = max(int(msg.get("rows") or self.rows), 1)
                            if cols != self.cols or rows != self.rows:
                                self.cols, self.rows = cols, rows
                                try:
                                    self.process.setwinsize(rows, cols)
                                except Exception:
                                    pass
                        except Exception as e:
                            logger.debug("resize control ignored (%s): %s", self.host.get("id"), e)
                        continue
                    if isinstance(msg, dict) and msg.get("type") == "ping":
                        try:
                            async with self._send_lock:
                                await self.websocket.send_text('{"type":"pong"}')
                        except Exception as e:
                            logger.debug("pong send failed (%s): %s", self.host.get("id"), e)
                        continue
                try:
                    raw = data.encode("utf-8") if isinstance(data, str) else data
                    off = 0
                    while off < len(raw):
                        piece = raw[off:off + PTY_INPUT_CHUNK_BYTES]
                        attempt = 0
                        while piece:
                            try:
                                n = os.write(self.process.fd, piece)
                            except OSError as e:
                                # PTY buffer 가득 차서 EAGAIN — 출력 펌프가 drain 되도록 양보 후 재시도.
                                if getattr(e, "errno", None) in (11, 35):
                                    attempt += 1
                                    if attempt % 500 == 0:
                                        logger.warning("tailscale write backpressure persists")
                                    await asyncio.sleep(0.002)
                                    continue
                                raise
                            if not isinstance(n, int) or n <= 0:
                                break
                            if n >= len(piece):
                                break
                            piece = piece[n:]
                            attempt = 0
                        off += PTY_INPUT_CHUNK_BYTES
                        await asyncio.sleep(0)
                except Exception as e:
                    logger.warning("tailscale write failed: %s", e)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.info("ws recv error (tailscale bridge): %s", e)
        finally:
            self._closed.set()

    async def run(self) -> None:
        try:
            self._spawn()
        except HostConnectError as e:
            try:
                await self.websocket.send_text(f"\r\n\x1b[31m[연결 실패] {e}\x1b[0m\r\n")
                await self.websocket.close(code=1011, reason=str(e))
            except Exception:
                pass
            return
        except Exception as e:
            logger.error("tailscale spawn unexpected: %s", e, exc_info=True)
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
            try:
                if self.process and self.process.isalive():
                    self.process.terminate(force=True)
            except Exception:
                pass


def resolve_host_secrets(host: dict, key_record: dict | None) -> dict:
    """저장된 호스트/키 레코드에서 vault 복호화한 secret 들을 추출.
    auth_method=key 는 password 로드 X — kbd-interactive 챌린지는 사용자 인터랙티브 prompt 로 처리.
    (저장된 password 가 자동 응답되어 우리 핸들러가 우회되는 사고 방지.)"""
    private_key: str | None = None
    passphrase: str | None = None
    password: str | None = None

    auth_method = host.get("auth_method") or "key"
    if auth_method == "key" and key_record is not None:
        private_key = decrypt_str(key_record.get("private_key_enc"))
        passphrase = decrypt_str(key_record.get("passphrase_enc"))
    elif auth_method == "password":
        password = decrypt_str(host.get("password_enc"))
    # 'tailscale' 은 secret 불필요 (tailscale auth 가 알아서 함)

    return {
        "private_key": private_key,
        "passphrase": passphrase,
        "password": password,
    }
