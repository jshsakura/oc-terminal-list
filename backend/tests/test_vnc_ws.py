"""VNC WS 터널 — 바이너리 펌프 + 제어 프레임 직렬화 단위 테스트.

RFB 는 바이너리 프로토콜이므로 펌프가 반드시 receive_bytes/send_bytes 를 써야 한다.
실제 SSH/VNC 서버 없이 펌프 함수와 bridge 직렬화만 검증한다.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import WebSocketDisconnect

from routes.vnc_ws import (
    _drain_stderr,
    _select_subprotocol,
    _spawn_tailscale_vnc_pipe,
    _stream_to_ws,
    _terminate_proc,
    _ws_to_stream,
)


class _FakeWriter:
    """asyncio/asyncssh writer 최소 흉내 — write/drain/close/wait_closed."""

    def __init__(self):
        self.written: list[bytes] = []
        self.closed = False

    def write(self, data: bytes) -> None:
        self.written.append(data)

    async def drain(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        pass


class _FakeReader:
    """asyncio/asyncssh reader 최소 흉내 — read(n) → bytes."""

    def __init__(self, chunks: list[bytes]):
        self._chunks = list(chunks)

    async def read(self, n: int) -> bytes:
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


class _FakeWS:
    """WebSocket 최소 흉내 — receive_bytes/send_bytes/client_state."""

    def __init__(self, incoming: list[bytes] | None = None):
        self._incoming = list(incoming or [])
        self.sent: list[bytes] = []
        self.text_sent: list[str] = []

        class _State:
            name = "CONNECTED"

        self.client_state = _State()

    async def receive_bytes(self) -> bytes:
        if not self._incoming:
            raise WebSocketDisconnect(1000, "closed")
        return self._incoming.pop(0)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)

    async def send_text(self, text: str) -> None:
        self.text_sent.append(text)


# ── _ws_to_stream: 브라우저 → RFB ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_ws_to_stream_pumps_bytes_to_writer():
    """receive_bytes 로 받은 바이트가 writer.write 로 그대로 전달되는지."""
    ws = _FakeWS(incoming=[b"RFB 003.008\n", b"\x01\x02\x03"])
    writer = _FakeWriter()
    await _ws_to_stream(ws, writer)
    assert b"".join(writer.written) == b"RFB 003.008\n\x01\x02\x03"


@pytest.mark.asyncio
async def test_ws_to_stream_stops_on_disconnect():
    """WS 단절(WebSocketDisconnect) 시 펌프가 조용히 종료되는지."""
    ws = _FakeWS(incoming=[])  # receive_bytes → WebSocketDisconnect
    writer = _FakeWriter()
    await _ws_to_stream(ws, writer)  # 예외 없이 종료
    assert writer.written == []


# ── _stream_to_ws: RFB → 브라우저 ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_stream_to_ws_pumps_bytes_to_ws():
    """reader.read 로 읽은 바이트가 send_bytes 로 전달되는지 (바이너리 프레임)."""
    reader = _FakeReader([b"framebuffer-update", b"\x00\x01"])
    ws = _FakeWS()
    await _stream_to_ws(reader, ws)
    assert b"".join(ws.sent) == b"framebuffer-update\x00\x01"


@pytest.mark.asyncio
async def test_stream_to_ws_stops_on_eof():
    """reader 가 빈 바이트(EOF)를 반환하면 펌프가 종료되는지."""
    reader = _FakeReader([b"data", b""])  # 두 번째 read → b"" (EOF)
    ws = _FakeWS()
    await _stream_to_ws(reader, ws)
    assert ws.sent == [b"data"]


@pytest.mark.asyncio
async def test_stream_to_ws_stops_when_ws_not_connected():
    """WS client_state 가 CONNECTED 가 아니면 즉시 종료."""
    reader = _FakeReader([b"should-not-send"])
    ws = _FakeWS()
    ws.client_state.name = "DISCONNECTED"
    await _stream_to_ws(reader, ws)
    assert ws.sent == []  # 전송되지 않음


@pytest.mark.asyncio
async def test_stream_to_ws_first_frame_is_rfb_handshake():
    """첫 프레임이 RFB 인사(RFB 003. 로 시작)이고, 텍스트 프레임이 단 하나도 없어야 한다.

    티켓 푸셔(JSON send_text) 가 제거되었으므로, noVNC 가 받는 첫 바이트는
    Xvnc 의 RFB 핸드셰이크 여야 한다 — 그렇지 않으면 noVNC 가 프로토콜을
    파싱하지 못하고 화면이 검게 남는다.
    """
    rfb_greeting = b"RFB 003.008\n"
    reader = _FakeReader([rfb_greeting, b""])
    ws = _FakeWS()
    await _stream_to_ws(reader, ws)
    assert ws.sent == [rfb_greeting]
    assert ws.text_sent == []  # 텍스트 프레임은 단 하나도 없어야 함


# ── tailscale 서브프로세스 파이프 ─────────────────────────────────────────────


class _FakeProc:
    """asyncio.subprocess.Process 최소 흉내 — terminate/kill/wait + stdout/stderr."""

    def __init__(self, stdout_chunks=None, stderr_chunks=None):
        self.stdout = _FakeReader(stdout_chunks or [])
        self.stdin = _FakeWriter()
        self.stderr = _FakeReader(stderr_chunks or [])
        self.terminated = False
        self.killed = False
        self.wait_count = 0

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    async def wait(self):
        self.wait_count += 1
        return 0


@pytest.mark.asyncio
async def test_spawn_tailscale_pipe_builds_correct_argv():
    """tailscale ssh 서브프로세스 argv 가 올바르게 조립되는지."""
    host = {"hostname": "host.ts.net", "ssh_user": "admin"}
    fake_proc = _FakeProc()
    with (
        patch("routes.vnc_ws.shutil.which", return_value="/usr/bin/tailscale"),
        patch("routes.vnc_ws.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)) as mock_exec,
    ):
        proc = await _spawn_tailscale_vnc_pipe(host, 5901)
    assert proc is fake_proc
    argv = mock_exec.call_args.args
    assert argv[0] == "tailscale"
    assert argv[1] == "ssh"
    assert argv[2] == "admin@host.ts.net"
    # remote_cmd 에 nc 폴백 체인 + 포트 포함
    remote_cmd = argv[3]
    assert "nc 127.0.0.1 5901" in remote_cmd
    assert "ncat 127.0.0.1 5901" in remote_cmd
    assert "/dev/tcp/127.0.0.1/5901" in remote_cmd


@pytest.mark.asyncio
async def test_spawn_tailscale_pipe_defaults_ssh_user():
    """ssh_user 가 없으면 환경 변수 USER (또는 'root') 를 폴백으로 쓰는지."""
    host = {"hostname": "node.ts.net"}
    with (
        patch("routes.vnc_ws.shutil.which", return_value="/usr/bin/tailscale"),
        patch.dict("os.environ", {"USER": "deploy"}),
        patch("routes.vnc_ws.asyncio.create_subprocess_exec", new=AsyncMock(return_value=_FakeProc())) as mock_exec,
    ):
        await _spawn_tailscale_vnc_pipe(host, 5900)
    assert mock_exec.call_args.args[2] == "deploy@node.ts.net"


@pytest.mark.asyncio
async def test_spawn_tailscale_pipe_raises_without_binary():
    """tailscale 바이너리가 없으면 RuntimeError."""
    host = {"hostname": "h.ts.net"}
    with patch("routes.vnc_ws.shutil.which", return_value=None):
        with pytest.raises(RuntimeError, match="tailscale"):
            await _spawn_tailscale_vnc_pipe(host, 5901)


@pytest.mark.asyncio
async def test_terminate_proc_sends_sigterm_then_waits():
    """정상 종료: SIGTERM → wait 성공 → kill 미사용."""
    proc = _FakeProc()
    await _terminate_proc(proc)
    assert proc.terminated
    assert not proc.killed
    assert proc.wait_count >= 1


@pytest.mark.asyncio
async def test_terminate_proc_falls_back_to_kill_on_timeout():
    """wait 타임아웃 시 SIGKILL 폴백."""
    proc = _FakeProc()

    async def _wait_for_timeout(coro, **kwargs):
        coro.close()  # 미소비 코루틴 정리
        raise TimeoutError()

    with patch("routes.vnc_ws.asyncio.wait_for", new=_wait_for_timeout):
        await _terminate_proc(proc)
    assert proc.terminated
    assert proc.killed


@pytest.mark.asyncio
async def test_terminate_proc_already_dead():
    """이미 종료된 프로세스 (ProcessLookupError) → 즉시 반환, kill 미사용."""
    proc = _FakeProc()

    def boom():
        raise ProcessLookupError(123)

    proc.terminate = boom
    await _terminate_proc(proc)
    assert not proc.killed


@pytest.mark.asyncio
async def test_drain_stderr_reads_until_eof():
    """stderr 를 끝까지 읽고 조용히 종료하는지."""
    proc = _FakeProc(stderr_chunks=[b"warning: blah\n", b"another line\n"])
    await _drain_stderr(proc)
    # _FakeReader 가 chunks 를 모두 소진했는지 확인
    assert proc.stderr._chunks == []


@pytest.mark.asyncio
async def test_drain_stderr_handles_none_stderr():
    """stderr 가 None 이어도 예외 없이 종료."""
    proc = _FakeProc()
    proc.stderr = None
    await _drain_stderr(proc)  # 예외 없음


# ── _select_subprotocol: RFC 6455 서브프로토콜 협상 ────────────────────────


def test_select_subprotocol_returns_binary_when_offered():
    """클라이언트가 'binary' 를 제시하면 'binary' 를 선택한다."""
    assert _select_subprotocol({"subprotocols": ["binary"]}) == "binary"
    assert _select_subprotocol({"subprotocols": ["binary", "base64"]}) == "binary"


def test_select_subprotocol_returns_none_when_binary_absent():
    """클라이언트가 'binary' 를 제시하지 않으면 None (인자 없이 accept)."""
    assert _select_subprotocol({"subprotocols": ["base64"]}) is None
    assert _select_subprotocol({"subprotocols": []}) is None


def test_select_subprotocol_does_not_pick_unoffered_protocol():
    """클라이언트가 제시하지 않은 서브프로토콜을 임의로 고르지 않는다."""
    # 'binary' 가 없으면 'base64' 만 있어도 None 이 나와야 한다.
    assert _select_subprotocol({"subprotocols": ["base64", "chat"]}) is None


def test_select_subprotocol_handles_missing_scope_key():
    """scope 에 subprotocols 키 자체가 없어도 None."""
    assert _select_subprotocol({}) is None
    assert _select_subprotocol({"subprotocols": None}) is None
