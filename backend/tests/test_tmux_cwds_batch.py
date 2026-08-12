"""parse_tmux_cwds — one `list-panes -a` for every session's cwd.

The batch replaces one SSH exec per pane at boot, so the parse has to agree with
what the per-session command returned: the *active* pane's path.
"""
from __future__ import annotations

from host_sftp import parse_tmux_cwds


def test_active_pane_wins():
    text = "\n".join([
        "mobile\t0\t/home/me/other",
        "mobile\t1\t/home/me/project",
        "mobile_2\t1\t/srv/app",
    ])
    assert parse_tmux_cwds(text) == {"mobile": "/home/me/project", "mobile_2": "/srv/app"}


def test_active_wins_regardless_of_line_order():
    text = "mobile\t1\t/first\nmobile\t0\t/second"
    assert parse_tmux_cwds(text) == {"mobile": "/first"}


def test_session_without_an_active_pane_keeps_the_first_path():
    """A session mid-setup can report no active pane — better a path than a hole."""
    text = "mobile\t0\t/a\nmobile\t0\t/b"
    assert parse_tmux_cwds(text) == {"mobile": "/a"}


def test_blank_and_malformed_lines_are_skipped():
    text = "\n".join([
        "",
        "garbage",
        "onlytwo\t1",
        "mobile\t1\t/ok",
        "empty\t1\t",
    ])
    assert parse_tmux_cwds(text) == {"mobile": "/ok"}


def test_empty_input():
    assert parse_tmux_cwds("") == {}
    assert parse_tmux_cwds(None) == {}


def test_paths_with_spaces_survive():
    text = "mobile\t1\t/home/me/my project"
    assert parse_tmux_cwds(text) == {"mobile": "/home/me/my project"}


# --- local side: same shape, one `list-panes -a` on this box ---

async def test_local_batch_prefers_active_pane(monkeypatch):
    from tmux_manager import tmux_manager

    lines = "\n".join([
        "sess-a\t0\t/home/me/one",
        "sess-a\t1\t/home/me/two",
        "sess-b\t1\t/srv",
    ])

    async def fake_run(*args, **kwargs):
        return 0, lines, ""

    monkeypatch.setattr(tmux_manager, "_run", fake_run)
    assert await tmux_manager.get_all_pane_cwds() == {"sess-a": "/home/me/two", "sess-b": "/srv"}


async def test_local_batch_returns_empty_when_tmux_fails(monkeypatch):
    from tmux_manager import tmux_manager

    async def fake_run(*args, **kwargs):
        return 1, "", "no server"

    monkeypatch.setattr(tmux_manager, "_run", fake_run)
    assert await tmux_manager.get_all_pane_cwds() == {}
