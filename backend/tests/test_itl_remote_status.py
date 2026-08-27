"""원격 pane 의 상태 — "모른다" 를 "일 안 한다" 로 읽지 않기.

백엔드 워처는 원격 tmux 를 볼 수 없다(CLAUDE.md 상태감지 절). 그래서 원격 pane 의 상태는
**기본이 모름**이고, 필요할 때만 그 호스트에 물어본다. 이 구분이 없으면 `terminal_wait` 가
0 초에 "완료" 를 돌려주고, 일을 넘긴 에이전트는 결과 없이 다음으로 넘어간다.
"""
import pytest

import itl_remote
import routes.itl as itl_route
from itl_targets import build_targets, format_table

TABS = [
    {
        "name": "fleet",
        "activePaneId": "p1",
        "panes": [
            {"id": "p1", "sessionId": "local-1"},
            {"id": "p2", "hostId": "h1", "tmuxSessionName": "a1"},
            {"id": "p3", "hostId": "h1", "tmuxSessionName": "a2"},
            {"id": "p4", "hostId": "h2", "tmuxSessionName": "b1"},
        ],
    },
]


def _targets():
    return build_targets(TABS, {"local-1": {"command": "zsh", "status": None}})


def test_remote_status_is_unknown_by_default():
    """워처가 못 보는 것을 유휴로 적으면, 확인하지 않은 것이 확인된 것처럼 보인다."""
    targets = _targets()
    by_addr = {t["addr"]: t for t in targets}
    assert by_addr["1.1"]["statusUnknown"] is False      # 로컬은 워처가 본다
    assert by_addr["1.2"]["statusUnknown"] is True
    assert by_addr["1.4"]["statusUnknown"] is True


def test_table_says_question_mark_for_unknown():
    """`-` 는 "일 안 함", `?` 는 "안 물어봤음" — 표에서도 구분돼야 한다."""
    rows = format_table(_targets()).splitlines()
    # TITLE 이 비어 rstrip 되므로 STATE 가 각 행의 마지막 글자다.
    assert rows[1].endswith("-")      # 1.1 로컬 — 확인했고 일하고 있지 않다
    assert rows[2].endswith("?")      # 1.2 원격 — 물어보지 않았다


@pytest.fixture(autouse=True)
def _clean_stream():
    from remote_agent import ingest
    for host in ("h1", "h2"):
        ingest.forget(host)
    yield
    for host in ("h1", "h2"):
        ingest.forget(host)


async def _stream(host, panes):
    """리모트가 상태를 밀어 준 상황을 만든다."""
    from remote_agent import ingest
    await ingest.handle_event(host, "server", {})
    lines = [f"{session}\t1\t{command}\t/tmp\t{title}" for session, command, title in panes]
    await ingest.handle_event(host, "panes", {"lines": lines})


@pytest.mark.asyncio
async def test_status_comes_from_the_stream_not_from_ssh():
    """⚠️ SSH 로 묻지 않는다. 예전에는 호스트마다 왕복이었고 `terminal_wait` 가 그걸
    5초마다 했다 — 꺼진 호스트 하나가 홈 화면을 15초씩 멈춰 세우던 원인이다."""
    await _stream("h1", [("a1", "claude", "⠋ building")])
    filled = await itl_route._fill_remote_status(_targets(), "u")
    by_addr = {t["addr"]: t for t in filled}
    assert by_addr["1.2"]["status"] == "working"
    assert by_addr["1.2"]["statusUnknown"] is False


def test_the_polling_path_has_no_way_to_reach_ssh():
    """🔐 상태 채우기에서 SSH 를 다시 부를 길이 아예 없어야 한다 — 있으면 언젠가 쓰인다."""
    import inspect
    body = inspect.getsource(itl_route._fill_remote_status)
    for banned in ("itl_remote", "open_channel", "run_remote_cmd"):
        assert banned not in body, f"폴링 경로에 {banned} 가 다시 들어왔다"


@pytest.mark.asyncio
async def test_a_host_without_a_remote_stays_unknown():
    """리모트가 없으면 우리가 볼 방법이 없다 — 그건 결함이 아니라 **사실**이다.
    화면이 그 호스트에 "리모트 설치" 를 권하는 것이 답이지, 추측이 답이 아니다."""
    await _stream("h1", [("a1", "claude", "✳ idle")])
    filled = await itl_route._fill_remote_status(_targets(), "u")
    by_addr = {t["addr"]: t for t in filled}
    assert by_addr["1.4"]["statusUnknown"] is True        # h2 는 리모트가 없다
    assert by_addr["1.2"]["statusUnknown"] is False       # h1 은 있다


@pytest.mark.asyncio
async def test_a_session_the_remote_does_not_report_is_gone_not_unknown():
    """호스트는 답했는데 그 세션이 없다 — 사라진 것이지 모르는 게 아니다."""
    await _stream("h1", [("a1", "claude", "✳ idle")])     # a2 는 없다
    filled = await itl_route._fill_remote_status(_targets(), "u")
    by_addr = {t["addr"]: t for t in filled}
    assert by_addr["1.3"]["statusGone"] is True
    assert by_addr["1.3"]["statusUnknown"] is False


@pytest.mark.asyncio
async def test_local_targets_and_the_input_list_are_untouched():
    """입력을 제자리에서 고치면 호출부가 옛 값을 들고 있다고 믿는다."""
    await _stream("h1", [("a1", "claude", "✳ idle")])
    original = _targets()
    filled = await itl_route._fill_remote_status(original, "u")
    assert original[1]["statusUnknown"] is True           # 입력은 그대로
    assert filled[1]["statusUnknown"] is False
    assert filled[0] is original[0]                       # 로컬은 손대지 않는다
