from unittest.mock import patch

import pytest

from tmux_manager import TmuxManager
from host_manager import _build_remote_command


@pytest.fixture
def tmux_manager():
    return TmuxManager(socket_name="test-socket")

@pytest.mark.asyncio
async def test_list_sessions_empty(tmux_manager):
    # Mock _run to return rc=1 (no sessions)
    with patch.object(tmux_manager, '_run', return_value=(1, "", "")):
        sessions = await tmux_manager.list_sessions()
        assert sessions == []

@pytest.mark.asyncio
async def test_list_sessions_parsing(tmux_manager):
    # Mock _run to return session list output
    mock_output = "sess1\t1\t0\t1234567\nsess2\t2\t1\t7654321"
    with patch.object(tmux_manager, '_run', return_value=(0, mock_output, "")):
        sessions = await tmux_manager.list_sessions()
        assert len(sessions) == 2
        assert sessions[0].name == "sess1"
        assert sessions[0].windows == 1
        assert sessions[0].attached is False
        assert sessions[1].name == "sess2"
        assert sessions[1].attached is True

@pytest.mark.asyncio
async def test_session_exists(tmux_manager):
    with patch.object(tmux_manager, '_run', return_value=(0, "", "")):
        exists = await tmux_manager.session_exists("valid")
        assert exists is True
    
    with patch.object(tmux_manager, '_run', return_value=(1, "", "")):
        exists = await tmux_manager.session_exists("invalid")
        assert exists is False

@pytest.mark.asyncio
async def test_record_cwd(tmux_manager):
    tmux_manager._record_cwd("sess_id", "/home/user")
    history = tmux_manager.get_cwd_history("sess_id")
    assert len(history) == 1
    assert history[0]["cwd"] == "/home/user"
    
    # Same CWD should update existing entry
    tmux_manager._record_cwd("sess_id", "/home/user")
    history = tmux_manager.get_cwd_history("sess_id")
    assert len(history) == 1


def test_remote_tmux_command_enables_mouse_for_scroll():
    cmd = _build_remote_command(True, "mobile")

    assert "tmux set-option -t mobile mouse on" in cmd
    assert "mouse off" not in cmd


# ---------------------- send-keys 타겟 문법 ----------------------

@pytest.mark.asyncio
async def test_send_keys_uses_pane_target_syntax(tmux_manager):
    """`=name` 만 쓰면 "can't find pane" 이 난다.

    send-keys 의 -t 는 세션이 아니라 **pane** 타겟이라, 세션 타겟에서 통하는 `=name`
    문법이 여기서는 안 먹는다. `=name:` 이어야 정확 매칭을 유지하면서 "그 세션의
    현재 윈도우"로 해소된다. 조용히 회귀하면 전송이 통째로 죽는다.
    """
    calls = []
    async def fake_run(*args, **kwargs):
        calls.append(args)
        return (0, "", "")
    with patch.object(tmux_manager, '_run', side_effect=fake_run):
        await tmux_manager.send_keys("sess-1", "hello")
    assert calls == [("send-keys", "-t", "=sess-1:", "-l", "--", "hello")]


@pytest.mark.asyncio
async def test_send_keys_ends_flag_parsing(tmux_manager):
    """`--` 가 없으면 대시로 시작하는 메시지가 `unknown flag` 로 죽는다.

    실측: `send-keys -t X -l '-x oops'` → "command send-keys: unknown flag -x".
    `check=False` 라 예외도 안 나고, 그 메시지만 조용히 사라진다.
    """
    calls = []
    async def fake_run(*args, **kwargs):
        calls.append(args)
        return (0, "", "")
    with patch.object(tmux_manager, '_run', side_effect=fake_run):
        await tmux_manager.send_keys("sess-1", "-x oops")
    assert calls == [("send-keys", "-t", "=sess-1:", "-l", "--", "-x oops")]


@pytest.mark.asyncio
async def test_send_keys_submit_appends_enter(tmux_manager):
    calls = []
    async def fake_run(*args, **kwargs):
        calls.append(args)
        return (0, "", "")
    with patch.object(tmux_manager, '_run', side_effect=fake_run):
        await tmux_manager.send_keys("sess-1", "ls", submit=True)
    assert len(calls) == 2
    assert calls[1] == ("send-keys", "-t", "=sess-1:", "Enter")


@pytest.mark.asyncio
async def test_send_keys_ignores_empty_text(tmux_manager):
    """빈 문자열에 엔터만 치는 사고를 막는다."""
    with patch.object(tmux_manager, '_run') as run:
        await tmux_manager.send_keys("sess-1", "", submit=True)
        run.assert_not_called()


@pytest.mark.asyncio
async def test_create_session_injects_env(tmux_manager):
    """itl CLI 가 자기 정체를 아는 통로 — 빠지면 CLI 가 조용히 안 된다."""
    calls = []
    async def fake_run(*args, **kwargs):
        calls.append(args)
        return (0, "", "")
    with patch.object(tmux_manager, '_run', side_effect=fake_run), \
         patch.object(tmux_manager, 'session_exists', side_effect=[False, True]):
        await tmux_manager.create_session("s1", env={"ITL_TOKEN": "t", "ITL_SESSION": "s1"})
    # new-session 은 set-option -g 와 **한 호출로 묶여** 나간다(콜드스타트 시
    # history-limit 이 첫 pane 에 적용되게 하려고). 그래서 argv 를 내용으로 찾는다.
    argv = next(a for a in calls if "new-session" in a)
    assert "-e" in argv
    assert "ITL_TOKEN=t" in argv and "ITL_SESSION=s1" in argv
