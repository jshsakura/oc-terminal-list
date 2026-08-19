"""윈도우 호스트를 조용히 실패시키지 않기 위한 판정 — 실제 셸이 뱉는 문구로 잠근다."""
from __future__ import annotations

from remote_platform import classify_platform


def test_posix_unames():
    for out in ("Linux\n", "Darwin", "FreeBSD\n", "SunOS", "CYGWIN_NT-10.0-19045"):
        assert classify_platform(out) == "posix", out


def test_windows_cmd_and_powershell():
    cmd_exe = "'uname' is not recognized as an internal or external command,\noperable program or batch file."
    powershell = ("uname : The term 'uname' is not recognized as the name of a cmdlet, "
                  "function, script file, or operable program.")
    assert classify_platform(cmd_exe) == "windows"
    assert classify_platform(powershell) == "windows"
    assert classify_platform("CommandNotFoundException") == "windows"


def test_silence_is_unknown_not_windows():
    """잠긴 셸은 아무 말도 안 한다. 거기에 경고를 붙이면 멀쩡한 호스트를 겁준다."""
    assert classify_platform("") == "unknown"
    assert classify_platform(None) == "unknown"
    assert classify_platform("   \n ") == "unknown"


def test_a_posix_line_wins_over_noise():
    """로그인 배너가 먼저 찍히는 호스트가 흔하다."""
    assert classify_platform("Welcome to example.com\nLinux\n") == "posix"
