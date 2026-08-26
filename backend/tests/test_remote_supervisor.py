"""원격 관찰자 감독자 — SSH 없이 프로세스 대역으로 검증한다."""
from __future__ import annotations

import asyncio
import base64
import json

import pytest

from remote_agent.supervisor import (
    BACKOFF_SECONDS,
    HELLO_TIMEOUT_SEC,
    SHUTDOWN_TIMEOUT_SEC,
    RemoteProbeSession,
    backoff_for,
    build_command,
)


class FakeStdin:
    def __init__(self):
        self.written = []
        self.closed = False

    def write(self, data):
        if self.closed:
            raise BrokenPipeError("closed")
        self.written.append(data)

    def close(self):
        self.closed = True


class FakeStdout:
    def __init__(self, lines):
        self._lines = list(lines)

    async def readline(self):
        if not self._lines:
            return ""
        return self._lines.pop(0)


class FakeProc:
    def __init__(self, lines, hang=False):
        self.stdin = FakeStdin()
        self.stdout = FakeStdout(lines)
        self.terminated = False
        self._hang = hang

    async def wait(self):
        if self._hang:
            await asyncio.sleep(3600)
        return 0

    def terminate(self):
        self.terminated = True


def _session(lines, events, hang=False, states=None):
    proc = FakeProc(lines, hang=hang)

    async def spawn(_cmd):
        return proc

    async def on_event(host_id, event):
        events.append((host_id, event))

    async def on_state(host_id, state, detail):
        (states if states is not None else []).append((host_id, state, detail))

    return RemoteProbeSession("h1", spawn, on_event, on_state), proc


HELLO = json.dumps({"t": "hello", "interval": 1.5}) + "\n"


@pytest.mark.asyncio
async def test_streams_events_until_eof():
    events = []
    session, _ = _session(
        [HELLO,
         json.dumps({"t": "server"}) + "\n",
         json.dumps({"t": "panes", "lines": ["s\t1\tclaude\t/tmp\t✳ done"]}) + "\n"],
        events,
    )
    await session.run_once("cmd")
    assert [e["t"] for _, e in events] == ["server", "panes"]


@pytest.mark.asyncio
async def test_a_probe_that_never_greets_is_a_failure():
    """⚠️ 인사가 없으면 **연결이 열린 것**과 **쓸 수 있는 것**을 구별할 수 없다.
    이 저장소가 두 번 밟은 그 함정이다(도달 불가 호스트 · 원격 세션 소멸)."""
    events = []
    session, _ = _session(["not json at all\n"], events)
    with pytest.raises(RuntimeError):
        await session.run_once("cmd")


@pytest.mark.asyncio
async def test_garbage_lines_do_not_kill_the_stream():
    """로그인 셸이 끼워 넣는 배너 한 줄에 관찰자가 죽으면 안 된다."""
    events = []
    session, _ = _session(
        [HELLO, "Welcome to Ubuntu 24.04\n", json.dumps({"t": "server"}) + "\n"],
        events,
    )
    await session.run_once("cmd")
    assert ("h1", {"t": "server"}) in events


@pytest.mark.asyncio
async def test_shutdown_is_bounded():
    """끊긴 망에서 wait 가 안 돌아와도 감독자는 풀려나야 한다."""
    events = []
    session, proc = _session([HELLO], events, hang=True)
    await asyncio.wait_for(session.run_once("cmd"), timeout=SHUTDOWN_TIMEOUT_SEC + 3)
    assert proc.terminated


@pytest.mark.asyncio
async def test_writing_to_a_dead_process_is_false_not_an_exception():
    events = []
    session, proc = _session([HELLO], events)
    session._proc, session._closing = proc, False
    proc.stdin.closed = True
    assert await session.send({"t": "excerpt", "session": "s"}) is False


@pytest.mark.asyncio
async def test_up_is_reported_only_after_the_greeting():
    states, events = [], []
    session, _ = _session([HELLO, json.dumps({"t": "server"}) + "\n"], events, states=states)
    await session.run_once("cmd")
    assert states == [("h1", "up", None)]


def test_backoff_climbs_and_then_holds():
    """꺼진 호스트를 영원히 15초마다 두드리지 않는다."""
    assert backoff_for(0) == BACKOFF_SECONDS[0]
    assert backoff_for(99) == BACKOFF_SECONDS[-1]
    assert list(BACKOFF_SECONDS) == sorted(BACKOFF_SECONDS)


def test_command_carries_the_script_in_argv_not_stdin():
    """⚠️ stdin 은 제어 채널이다. 소스를 거기 흘리면 `python3 -` 가 EOF 를 기다리며
    프로그램으로 삼켜서 제어를 다시 쓸 수 없다."""
    cmd = build_command("iterminallist-app")
    assert "ITL_TMUX_SOCKET=iterminallist-app" in cmd
    assert "python3 -u -c" in cmd
    blob = cmd.rsplit(" ", 1)[-1]
    decoded = base64.b64decode(blob).decode("utf-8")
    assert "def changed_lines" in decoded
    assert "__STATUS_GLYPHS__" not in decoded      # 글리프가 실제로 박혀 나간다


def test_hello_timeout_is_shorter_than_the_first_backoff():
    """상한이 재시도 간격보다 길면 시도가 겹쳐 쌓인다."""
    assert HELLO_TIMEOUT_SEC < BACKOFF_SECONDS[-1]
