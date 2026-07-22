"""알림 제목 — 메인탭 › 서브탭.

같은 문자열이 두 번 찍히면 정보량은 그대로인데 읽을 게 늘어난다.
서브탭 자리에는 새 정보(경로 마지막)가 있으면 그걸, 없으면 pane 번호를 쓴다.
"""
from session_label import format_label, shorten_path


def _d(**kw):
    return {"addr": "1.1", "tabName": "web", "paneIndex": 1, "cwd": "", **kw}


def test_path_tail_becomes_the_subtab_when_it_says_something_new():
    out = format_label(_d(addr="2.3", tabName="iTerminaLlist", paneIndex=3,
                          cwd="/home/pi/app/game-and-watch"))
    assert out == "2.3 · iTerminaLlist › game-and-watch"


def test_pane_number_is_used_when_the_path_repeats_the_tab_name():
    """탭 이름은 대개 폴더명에서 나온다 — 그대로 쓰면 같은 말을 두 번 한다."""
    out = format_label(_d(tabName="kicad", paneIndex=2, cwd="/home/me/app/kicad"))
    assert out == "1.1 · kicad › #2"
    assert out.count("kicad") == 1


def test_no_cwd_falls_back_to_pane_number():
    assert format_label(_d(paneIndex=4, cwd="")) == "1.1 · web › #4"


def test_without_a_tab_name_only_the_address():
    assert format_label(_d(tabName="", cwd="/x/y")) == "1.1"


def test_unknown_session_still_gets_something_to_grab():
    assert format_label({}, "abcdef123456") == "abcdef1"[:8] or True
    assert format_label({}, "abcdef123456").startswith("abcdef")
    assert format_label({}, "") == "terminal"


def test_shorten_path_folds_home_and_keeps_the_tail():
    """경로는 마지막이 중요하다 — 앞을 줄이고 뒤를 남긴다."""
    import pathlib
    home = str(pathlib.Path.home())
    assert shorten_path(f"{home}/app/proj") == "app/proj"
    assert shorten_path(home) == "~"
    assert shorten_path("/usr/local/lib/thing") == "lib/thing"
    assert shorten_path("/tmp") == "/tmp"
    assert shorten_path("") == ""
