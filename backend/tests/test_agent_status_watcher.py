"""AgentStatusWatcher — tmux 폴링 결과를 상태 전이 이벤트로 바꾸는 부분.

tmux 자체는 fake lister 로 대체해 전이 로직만 검증한다.
"""
import pytest

from agent_status_watcher import AgentStatusWatcher, parse_pane_lines


# ---------------------- tmux 출력 파싱 ----------------------

def test_parse_pane_lines():
    raw = "\n".join([
        "sess-a\t1\tclaude\t⠂ 폴더 로더 수정",
        "sess-b\t1\tzsh\t~/app/front",
        "sess-c\t0\tnode\t비활성 pane 은 버린다",
    ])
    panes = parse_pane_lines(raw)
    assert [p["sessionId"] for p in panes] == ["sess-a", "sess-b"]
    assert panes[0]["status"] == "working"
    assert panes[0]["title"] == "폴더 로더 수정"
    assert panes[1]["status"] is None


def test_parse_pane_lines_keeps_tabs_inside_title():
    """타이틀 안에 탭이 들어가도 앞 3개 필드만 잘라야 한다."""
    panes = parse_pane_lines("s1\t1\tclaude\t✳ a\tb")
    assert panes[0]["title"] == "a\tb"


def test_parse_pane_lines_tolerates_garbage():
    assert parse_pane_lines("") == []
    assert parse_pane_lines("깨진줄\n\n") == []


# ---------------------- 전이 감지 ----------------------

@pytest.fixture
def watcher():
    return AgentStatusWatcher(list_panes=None)


def test_first_poll_emits_everything(watcher):
    changes = watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 작업중"))
    assert len(changes) == 1
    assert changes[0]["status"] == "working"


def test_unchanged_poll_emits_nothing(watcher):
    raw = "s1\t1\tclaude\t⠂ 작업중"
    watcher._diff(parse_pane_lines(raw))
    assert watcher._diff(parse_pane_lines(raw)) == []


def test_spinner_frame_alone_emits_nothing(watcher):
    """스피너는 초당 10~12 프레임이다. 이게 새면 SSE 가 그 자체로 폭주한다."""
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 폴더 로더 수정"))
    assert watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠴ 폴더 로더 수정")) == []
    assert watcher._diff(parse_pane_lines("s1\t1\tclaude\t⣾ 폴더 로더 수정")) == []


def test_working_to_idle_is_a_completion(watcher):
    """P1(웹푸시)이 물릴 지점 — '에이전트가 끝났다'."""
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 폴더 로더 수정"))
    changes = watcher._diff(parse_pane_lines("s1\t1\tclaude\t✳ 폴더 로더 수정"))
    assert len(changes) == 1
    assert changes[0]["status"] == "idle"
    assert changes[0]["previousStatus"] == "working"
    assert changes[0]["completed"] is True


def test_idle_to_working_is_not_a_completion(watcher):
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t✳ 대기"))
    changes = watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 시작"))
    assert changes[0]["completed"] is False


def test_title_change_alone_emits(watcher):
    """상태는 그대로여도 작업 내용이 바뀌면 탭 이름을 갱신해야 한다."""
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 첫번째 작업"))
    changes = watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠴ 두번째 작업"))
    assert len(changes) == 1
    assert changes[0]["title"] == "두번째 작업"
    assert changes[0]["completed"] is False


def test_disappeared_session_is_forgotten(watcher):
    """세션이 사라지면 상태도 지운다 — 안 그러면 죽은 세션이 영원히 working 으로 남는다."""
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 작업중"))
    changes = watcher._diff(parse_pane_lines(""))
    assert changes[0]["sessionId"] == "s1"
    assert changes[0]["gone"] is True
    assert watcher.snapshot() == {}


def test_reappeared_session_emits_again(watcher):
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 작업중"))
    watcher._diff(parse_pane_lines(""))
    changes = watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 작업중"))
    assert len(changes) == 1


def test_snapshot_shape(watcher):
    watcher._diff(parse_pane_lines("s1\t1\tclaude\t⠂ 작업중"))
    snap = watcher.snapshot()
    assert snap["s1"]["status"] == "working"
    assert snap["s1"]["command"] == "claude"
    assert snap["s1"]["title"] == "작업중"
