from unittest.mock import patch

import pytest

from tmux_manager import TmuxManager


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
