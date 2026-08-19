"""소켓이 죽은 뒤에는 아무것도 보내지 않는다 — 단, 셸이 끝난 것과는 구별한다.

실제로 밟은 버그(로그가 남겼다):

    11:13:22,374  ws send failed … received 1005          ← 소켓이 죽음
    11:13:22,374  ws disconnected: 3b77b742
    INFO: connection closed
    11:13:22,475  ws send failed … Unexpected ASGI message ← 101ms 뒤 **또** 전송

`on_readable` 이 `_closed` 를 전혀 보지 않아서, 소켓이 죽은 뒤에도 PTY 가 뱉는 청크마다
새 flush task 가 생겨 죽은 소켓에 계속 send 했다(직전 task 는 실패로 done() 이라
"돌고 있으면 안 만든다" 가드가 통과된다). reader 루프는 `_closed` 를 0.5초 주기로만
보므로 그 창이 넓었다.

고칠 때 같이 지켜야 하는 반대편: **PTY EOF 로 서는 `_closed` 는 소켓이 죽은 것이 아니다.**
셸이 exit 하며 마지막으로 찍은 출력은 끝까지 가야 한다. 그래서 `_ws_gone` 이 따로 있다 —
하나로 합치면 둘 중 하나는 반드시 깨진다.
"""
from __future__ import annotations

import asyncio
import os

import pytest

from ws_bridge import TmuxClientBridge


class _FakePty:
    """읽기 끝이 파이프인 가짜 PTY — add_reader 경로를 진짜로 태운다."""

    def __init__(self, fd: int) -> None:
        self.fd = fd
        self.pid = 4242
        self.alive = True

    def read(self) -> bytes:
        return os.read(self.fd, 65536)

    def isalive(self) -> bool:
        return self.alive


class _FakeWS:
    def __init__(self) -> None:
        self.attempts = 0       # 실패한 것까지 포함한 send 시도 횟수
        self.sent: list[bytes] = []
        self.dead = False
        self.delay = 0.0

    async def send_bytes(self, data: bytes) -> None:
        self.attempts += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.dead:
            raise RuntimeError(
                "Unexpected ASGI message 'websocket.send', after sending 'websocket.close'."
            )
        self.sent.append(data)


async def _settle() -> None:
    """add_reader 콜백(셀렉터 폴링)과 flush task 가 돌 틈을 준다.

    `sleep(0)` 만으로는 부족하다 — 셀렉터는 실제 타이머가 있어야 폴링된다.
    """
    for _ in range(4):
        await asyncio.sleep(0.01)


def _make_bridge() -> tuple[TmuxClientBridge, _FakeWS, int, int]:
    r, w = os.pipe()
    os.set_blocking(r, False)
    ws = _FakeWS()
    bridge = TmuxClientBridge(ws, "sess-1", ["true"], 80, 24)
    bridge.process = _FakePty(r)
    return bridge, ws, r, w


async def _stop(bridge: TmuxClientBridge, task: asyncio.Task, r: int, w: int) -> None:
    bridge._closed.set()
    task.cancel()
    try:
        await task
    except BaseException:
        pass
    for fd in (r, w):
        try:
            os.close(fd)
        except OSError:
            pass


@pytest.mark.asyncio
async def test_no_send_is_attempted_after_the_socket_dies():
    bridge, ws, r, w = _make_bridge()
    task = asyncio.create_task(bridge._reader_loop())
    try:
        os.write(w, b"hello")
        await _settle()
        assert b"".join(ws.sent) == b"hello"

        # 소켓이 죽는다. 그걸 알게 되는 건 다음 전송이 실패할 때다.
        ws.dead = True
        os.write(w, b"boom")
        await _settle()
        attempts_when_discovered = ws.attempts
        assert bridge._ws_gone.is_set()

        # 여기서부터가 회귀 지점 — PTY 는 계속 뱉지만 단 한 번도 더 시도하면 안 된다.
        for _ in range(5):
            os.write(w, b"more output from tmux")
            await _settle()
        assert ws.attempts == attempts_when_discovered
    finally:
        await _stop(bridge, task, r, w)


@pytest.mark.asyncio
async def test_the_last_output_still_reaches_the_client_when_the_shell_exits():
    """`_closed` 는 소켓 사망 신호가 아니다 — 전송 중이던 마지막 출력은 그대로 간다."""
    bridge, ws, r, w = _make_bridge()
    ws.delay = 0.05                       # flush 가 전송 중인 상태를 만든다
    task = asyncio.create_task(bridge._reader_loop())
    try:
        os.write(w, b"final output")
        await asyncio.sleep(0.02)         # on_readable → flush task 시작
        bridge._closed.set()              # 셸 exit (소켓은 멀쩡하다)
        await asyncio.wait_for(task, timeout=2)

        assert b"".join(ws.sent) == b"final output"
        assert not bridge._ws_gone.is_set()
    finally:
        await _stop(bridge, task, r, w)


@pytest.mark.asyncio
async def test_the_reader_leaves_promptly_instead_of_waiting_out_the_poll():
    """`_closed` 는 즉시 반영된다. 0.5s 는 PTY liveness 확인 주기일 뿐이다.

    이 창이 넓을수록 죽은 소켓에 쓸 기회가 늘어난다(위 버그의 100ms 간격).
    """
    bridge, ws, r, w = _make_bridge()
    task = asyncio.create_task(bridge._reader_loop())
    try:
        await asyncio.sleep(0.01)
        loop = asyncio.get_running_loop()
        started = loop.time()
        bridge._closed.set()
        await asyncio.wait_for(task, timeout=1)
        assert loop.time() - started < 0.3
    finally:
        await _stop(bridge, task, r, w)


@pytest.mark.asyncio
async def test_control_frames_are_silenced_too():
    """티켓 푸셔 같은 제어 전송도 같은 규칙을 따른다 — run() 이 끝난 뒤 남아 있을 수 있다."""
    ws = _FakeWS()
    bridge = TmuxClientBridge(ws, "sess-2", ["true"], 80, 24)

    class _TextWS(_FakeWS):
        async def send_text(self, text: str) -> None:
            await self.send_bytes(text.encode())

    ws = _TextWS()
    bridge.websocket = ws

    await bridge.send_control('{"type":"ticket"}')
    assert ws.attempts == 1

    bridge._ws_gone.set()
    await bridge.send_control('{"type":"ticket"}')
    assert ws.attempts == 1
