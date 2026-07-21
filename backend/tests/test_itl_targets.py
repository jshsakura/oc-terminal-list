"""터미널 주소 해소 — "3번 터미널", "1번 탭 3번", "@backend" 를 세션으로.

핵심 불변식: **번호는 사람이 부르는 이름이고 신원은 세션 ID 다.** pane 을 닫으면
번호가 밀리므로, 번호는 호출 시점에 즉시 해소돼야 하고 그 뒤로는 세션 ID 만 쓴다.
"""
import pytest

from itl_targets import build_targets, resolve, format_table

TABS = [
    {
        "name": "frontend", "type": "local", "activePaneId": "p2",
        "panes": [
            {"id": "p1", "sessionId": "s1"},
            {"id": "p2", "sessionId": "s2"},
            {"id": "pe"},                                  # 빈 picker pane
        ],
    },
    {
        "name": "backend", "type": "host", "activePaneId": "h1",
        "panes": [
            {"id": "h1", "hostId": "H", "tmuxSessionName": "mobile-aaa"},
            {"id": "h2", "hostId": "H", "tmuxSessionName": "mobile-bbb"},
        ],
    },
]
STATUS = {
    "s1": {"status": "working", "command": "claude", "title": "리팩토링"},
    "s2": {"status": None, "command": "zsh", "title": "~/app"},
    "mobile-aaa": {"status": "idle", "command": "claude", "title": "대기"},
    "mobile-bbb": {"status": "permission", "command": "codex", "title": "허락 대기"},
}


@pytest.fixture
def targets():
    return build_targets(TABS, STATUS)


def test_empty_panes_are_not_addressable(targets):
    """빈 picker pane 은 보낼 곳이 없다 — 번호를 차지하면 안 된다."""
    assert [t["addr"] for t in targets] == ["1.1", "1.2", "2.1", "2.2"]


def test_targets_carry_identity_and_state(targets):
    first = targets[0]
    assert first["sessionId"] == "s1"
    assert first["kind"] == "local"
    assert first["status"] == "working"
    assert targets[2]["kind"] == "host"
    assert targets[2]["tmuxSession"] == "mobile-aaa"


def test_tab_dot_pane(targets):
    assert [t["sessionId"] for t in resolve(targets, "1.2")] == ["s2"]
    assert [t["tmuxSession"] for t in resolve(targets, "2.1")] == ["mobile-aaa"]


def test_colon_form_is_the_same(targets):
    assert resolve(targets, "1:2") == resolve(targets, "1.2")


def test_bare_number_uses_the_callers_tab(targets):
    """`itl send 2` 는 보내는 쪽이 있는 탭의 2번이다."""
    assert [t["sessionId"] for t in resolve(targets, "2", from_session="s1")] == ["s2"]
    # 같은 "2" 라도 호출자가 다른 탭이면 다른 터미널을 가리킨다.
    assert [t["tmuxSession"] for t in resolve(targets, "2", from_session="mobile-aaa")] == ["mobile-bbb"]


def test_bare_number_without_context_refuses(targets):
    """기준 탭을 모르면 전역 번호로 넘겨짚지 않는다 — 엉뚱한 터미널에 보내느니 실패."""
    assert resolve(targets, "2") == []
    assert resolve(targets, "2", from_session="없는세션") == []


def test_tab_name_targets_the_active_pane(targets):
    assert [t["sessionId"] for t in resolve(targets, "@frontend")] == ["s2"]   # activePaneId=p2


def test_tab_name_with_pane_index(targets):
    assert [t["sessionId"] for t in resolve(targets, "@frontend.1")] == ["s1"]


def test_tab_name_is_case_insensitive(targets):
    assert resolve(targets, "@FrontEnd") == resolve(targets, "@frontend")


def test_status_groups(targets):
    assert [t["sessionId"] for t in resolve(targets, "@working")] == ["s1"]
    assert [t["tmuxSession"] for t in resolve(targets, "@idle")] == ["mobile-aaa"]
    assert [t["tmuxSession"] for t in resolve(targets, "@permission")] == ["mobile-bbb"]


def test_command_group(targets):
    """@claude 는 claude 가 돌고 있는 pane 전부 — 로컬·원격을 가리지 않는다."""
    got = resolve(targets, "@claude")
    assert {t["addr"] for t in got} == {"1.1", "2.1"}


def test_all_group(targets):
    assert len(resolve(targets, "@all")) == 4


def test_user_tab_name_beats_reserved_word(targets):
    """탭 이름이 예약어와 겹치면 사용자가 지은 이름이 이긴다 — 그게 덜 놀랍다."""
    tabs = TABS + [{"name": "working", "activePaneId": "w1",
                    "panes": [{"id": "w1", "sessionId": "sw"}]}]
    t2 = build_targets(tabs, STATUS)
    assert [t["sessionId"] for t in resolve(t2, "@working")] == ["sw"]


def test_unknown_address_is_empty(targets):
    for expr in ("", "@nope", "9.9", "1.9", "쓰레기", None):
        assert resolve(targets, expr) == []


def test_format_table_marks_the_caller(targets):
    out = format_table(targets, from_session="s1")
    assert "ADDR" in out and "1.1" in out and "@" not in out.split("\n")[0]
    assert out.splitlines()[1].startswith(">")     # 호출자 행에 표시


def test_format_table_when_empty():
    assert "없습니다" in format_table([])
