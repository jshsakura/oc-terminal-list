"""
host_manager 의 session-gone 알림 검증 — 원격 명령이 exit 42(재접속 대상 tmux 세션 없음)로
끝나면 프론트에 {"type":"session-gone"} 컨트롤을 보내고, 그 외 종료에는 침묵해야 한다.
(프론트는 이 신호로 create=0 refresh 스팸 대신 새 세션 생성으로 전환한다.)
"""
import pytest

from host_manager import (
    HostBridge,
    TMUX_SESSION_GONE_EXIT,
    _build_remote_command,
)


class _FakeWebSocket:
    def __init__(self):
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


class _FakeProcess:
    def __init__(self, exit_status):
        self.exit_status = exit_status


def _make_bridge(exit_status) -> tuple[HostBridge, _FakeWebSocket]:
    ws = _FakeWebSocket()
    bridge = HostBridge(
        websocket=ws,
        host={"id": "h1", "hostname": "example", "use_remote_tmux": 1},
        private_key=None,
        passphrase=None,
        password=None,
        cols=80,
        rows=24,
    )
    bridge.process = _FakeProcess(exit_status)
    return bridge, ws


@pytest.mark.asyncio
async def test_exit_42_sends_session_gone():
    bridge, ws = _make_bridge(TMUX_SESSION_GONE_EXIT)
    await bridge._notify_if_session_gone()
    assert ws.sent == ['{"type":"session-gone"}']


@pytest.mark.asyncio
async def test_normal_exit_stays_silent():
    bridge, ws = _make_bridge(0)
    await bridge._notify_if_session_gone()
    assert ws.sent == []


@pytest.mark.asyncio
async def test_unknown_exit_status_stays_silent():
    # WS 쪽이 먼저 끊겨 프로세스가 아직 안 죽은 경우 — exit_status None.
    bridge, ws = _make_bridge(None)
    await bridge._notify_if_session_gone()
    assert ws.sent == []


def test_refresh_command_marks_missing_session_with_exit_42():
    # create_session=False (refresh) 경로의 원격 명령이 세션 부재 시 마커 exit code 를 쓰는지.
    cmd = _build_remote_command(True, "mobile-abc", None, create_session=False)
    assert f"exit {TMUX_SESSION_GONE_EXIT}" in cmd
    # create=True 경로는 세션을 만들므로 마커 exit 가 없어야 한다.
    cmd_create = _build_remote_command(True, "mobile-abc", None, create_session=True)
    assert f"exit {TMUX_SESSION_GONE_EXIT}" not in cmd_create
