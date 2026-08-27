"""붙어 있는 세션은 지우지 않는다 — 그리고 그 판정은 죽이기 직전에 한다.

사고: 홈의 "이어할 수 있는 세션" 에 **지금 쓰고 있는** rpi5 세션이 떠 있었고, 그걸
종료하자 쓰던 세션이 같이 죽었다. 목록 쪽 필터(`!s.attached`)는 있었지만 60초 캐시된
스냅샷 위에서 돌았고, 서버는 아무것도 다시 확인하지 않았다.
"""
import pytest

import host_tmux


def test_parse_reads_the_attached_flag():
    out = "mobile|1|100\nmobile-abc|0|200\n"
    assert host_tmux.parse_sessions(out) == {"mobile": True, "mobile-abc": False}


def test_a_session_name_may_contain_the_separator():
    """`rpartition` 인 이유. 세션 이름에 `|` 가 들어가도 마지막 칸이 플래그다."""
    assert host_tmux.parse_sessions("we|rd|1|100") == {"we|rd": True}


def test_garbage_lines_are_dropped_not_folded_to_false():
    """⚠️ 못 읽은 줄을 '안 붙었다' 로 접으면 이 파일이 막으려는 사고가 그대로 난다."""
    assert host_tmux.parse_sessions("쓰레기\n\nmobile|1|100") == {"mobile": True}


@pytest.mark.anyio
async def test_attached_session_is_refused():
    async def run():
        return "mobile|1|100"
    with pytest.raises(host_tmux.SessionInUseError) as e:
        await host_tmux.assert_not_attached(run, "mobile")
    assert e.value.session == "mobile"


@pytest.mark.anyio
async def test_detached_session_passes():
    async def run():
        return "mobile|0|100\nother|1|200"
    await host_tmux.assert_not_attached(run, "mobile")


@pytest.mark.anyio
async def test_a_session_we_cannot_see_passes():
    """tmux 서버가 없으면 목록이 비고, 그건 '죽일 것이 없다' 이지 '막아라' 가 아니다."""
    async def run():
        return ""
    await host_tmux.assert_not_attached(run, "mobile")


@pytest.mark.anyio
async def test_a_failed_lookup_does_not_block_the_kill():
    """⚠️ 여기서 막으면 '지워지지 않는 유령 카드' 가 된다 — 이미 겪은 실패 모드다."""
    async def run():
        raise RuntimeError("호스트 꺼짐")
    await host_tmux.assert_not_attached(run, "mobile")


def test_the_remote_command_carries_no_shell_syntax():
    """리모트 통로는 argv 만 받는다(셸이 없다). 리다이렉션·`||` 를 실으면 tmux 가
    그걸 인자로 받아 '허용했는데 안 되는' 조용한 실패가 된다 — 실측한 사고다.

    (실제로 리모트가 받아 주는지는 `test_remote_channel.py` 가 **진짜 실행기**에
    물어본다. 여기서는 문자열 자체에 셸이 섞이지 않았는지만 본다.)
    """
    for cmd in (host_tmux.LIST_TMUX_CMD, host_tmux.kill_tmux_cmd("mobile", shell=False)):
        for bad in ("2>", "||", "&&", ";"):
            assert bad not in cmd, f"{cmd!r} 에 셸 구문 {bad!r}"


def test_the_ssh_command_guards_a_missing_session():
    """셸 쪽은 `has-session &&` 가 없으면 없는 세션에서 stderr + 비정상 종료가 난다."""
    cmd = host_tmux.kill_tmux_cmd("mobile", shell=True)
    assert "has-session" in cmd and "&&" in cmd


def test_both_paths_format_the_same_fields():
    """포맷이 갈리면 한쪽만 attached 를 못 읽는다 — 그쪽으로 들어온 종료가 무방비다."""
    assert host_tmux.LIST_SSH_CMD.startswith(host_tmux.LIST_TMUX_CMD)


# --- 호출부 계약: 어디가 붙어 있는 것을 죽여도 되나 -------------------------------

_FRONT = __import__("pathlib").Path(__file__).resolve().parents[2] / "frontend" / "src"


def test_only_restart_and_tab_close_may_kill_an_attached_session():
    """`allow_attached` 는 **그게 목적인 두 곳**에만 있어야 한다.

    ⚠️ 기본값이 안전한 쪽인 이유가 이것이다 — 새 호출부가 아무것도 안 하면 거절로
    떨어진다. 반대로 만들면(기본 허용 + 위험한 곳만 명시) 잊은 곳이 곧 사고다.
    """
    allowed = {"utils/restartSession.js", "App.jsx"}
    for path in _FRONT.rglob("*.js*"):
        if path.suffix not in (".js", ".jsx") or ".test." in path.name:
            continue
        text = path.read_text(encoding="utf-8")
        if "allow_attached" not in text:
            continue
        rel = path.relative_to(_FRONT).as_posix()
        assert rel in allowed, f"{rel} 이 붙어 있는 세션을 죽이려 한다 — 의도한 것인가?"


def test_the_resumable_list_does_not_pass_the_flag():
    """홈의 종료 버튼은 정의상 '안 쓰는 세션' 을 지운다. 여기에 플래그가 붙으면
    이 수정 전체가 무효가 된다 — 사고가 정확히 그 경로에서 났다."""
    app = (_FRONT / "App.jsx").read_text(encoding="utf-8")
    # 다음 블록의 **주석**부터 잘라낸다 — 주석에도 낱말이 나오므로 const 로 자르면 물린다.
    body = app[app.index("const terminateHostSession"):app.index("/* 원격 tmux 세션 kill")]
    assert "kill-tmux" in body
    assert "allow_attached" not in body


# --- 재시작은 무덤을 남기지 않는다 -----------------------------------------------

def test_restart_asks_for_recreate():
    """⚠️ 네 번째로 밟은 같은 가족의 사고. 무덤은 "사용자가 지웠으니 되살리지 마라" 인데,
    **재시작은 그 되살리기가 목적**이다. 표를 남기면 자기 재접속을 자기가 20초 동안
    막고, 거절이 `session-terminated` 라 화면에는 셸이 끝난 것처럼 보인다.

    구별은 의도를 아는 쪽(호출부)이 말해 주어야 한다 — 서버는 우리가 죽인 것과 저절로
    죽은 것을 구별할 수 없다.
    """
    src = (_FRONT / "utils" / "restartSession.js").read_text(encoding="utf-8")
    assert "recreate=true" in src, "재시작이 recreate 를 안 준다 — 무덤에 자기가 걸린다"


def test_tab_close_does_not_ask_for_recreate():
    """탭 닫기는 정반대다 — 이 앱에서 닫기는 종료를 뜻하고, 되살아나면 안 된다."""
    app = (_FRONT / "App.jsx").read_text(encoding="utf-8")
    body = app[app.index("const killRemoteTmuxSession"):]
    body = body[:body.index("}, []);")]
    assert "allow_attached=true" in body
    assert "recreate" not in body, "탭 닫기가 recreate 를 주면 닫은 세션이 되살아난다"


def test_the_created_stamp_survives_the_parse():
    """홈 카드가 "N시간 전" 을 그린다 — 포맷을 늘렸으니 그 칸도 실제로 읽혀야 한다."""
    rows = host_tmux.parse_session_rows("mobile|0|1787813468")
    assert rows == [{"name": "mobile", "attached": False, "created": 1787813468}]


def test_a_name_with_the_separator_keeps_its_created():
    """오른쪽부터 쪼개는 이유 — 왼쪽부터면 이름이 잘려 다른 세션이 된다."""
    rows = host_tmux.parse_session_rows("we|rd|1|1787813468")
    assert rows[0]["name"] == "we|rd" and rows[0]["created"] == 1787813468


# --- 목록의 attached 는 캐시하지 않는다 -------------------------------------------

def test_the_session_list_prefers_the_live_remote():
    """⚠️ 실측 사고: 쓰고 있는 rpi5 세션이 "이어할 수 있는 세션" 에 계속 떴다. tmux 는
    그때 `attached=1` 이라고 말하고 있었는데 화면은 60초 캐시된 `0` 을 들고 있었다.

    "이어할 수 있다" 는 **지금**에 대한 단언이다 — 낡은 값으로 그 단언을 하면 화면이
    쓰는 중인 세션을 지우라고 내민다. 리모트가 붙어 있으면 캐시를 아예 지나친다.
    """
    import inspect

    from routes import hosts as route
    body = inspect.getsource(route._fetch_host_tmux_sessions)
    live = body.index("_sessions_over_remote")
    cached = body.index("cache.get")
    assert live < cached, "캐시를 먼저 본다 — 리모트가 있어도 낡은 값을 준다"

    # 그리고 리모트 경로는 그 결과를 캐시에 넣지 않는다(넣으면 다음 조회가 다시 낡는다).
    assert "cache.set" not in inspect.getsource(route._sessions_over_remote)


def test_both_paths_share_one_parser():
    """포맷을 늘렸다. 손으로 쪼개는 코드가 한쪽에 남아 있으면 그쪽만 칸을 잘못 읽는데
    아무 데서도 안 터진다 — 예전 SSH 경로는 칸 순서까지 달랐다."""
    import inspect

    from routes import hosts as route
    body = inspect.getsource(route._fetch_host_tmux_sessions)
    assert body.count("parse_session_rows") == 0 or "host_tmux.parse_session_rows" in body
    assert 'line.split("|")' not in body, "손으로 쪼개는 코드가 남아 있다"
