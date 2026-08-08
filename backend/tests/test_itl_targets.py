"""터미널 주소 해소 — "3번 터미널", "1번 탭 3번", "@backend" 를 세션으로.

핵심 불변식: **번호는 사람이 부르는 이름이고 신원은 세션 ID 다.** pane 을 닫으면
번호가 밀리므로, 번호는 호출 시점에 즉시 해소돼야 하고 그 뒤로는 세션 ID 만 쓴다.
"""
import pytest

from itl_targets import build_targets, filter_targets, format_table, resolve

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


CALLER = "s1"


@pytest.mark.parametrize(
    ("expr", "from_session", "expected_addrs"),
    [
        ("3", CALLER, []),                      # §4.5: no pane 3 in caller's tab
        ("2", CALLER, ["1.2"]),                 # §4.5: caller tab pane 2
        ("1.2", CALLER, ["1.2"]),               # §4.5: INT.INT form
        ("1:2", CALLER, ["1.2"]),               # §4.5: INT:INT form, same target
        ("@frontend", CALLER, ["1.2"]),         # §4.5: tab name → active pane
        ("@frontend.1", CALLER, ["1.1"]),       # §4.5: tab name + pane index
        ("@all", CALLER, ["1.1", "1.2", "2.1", "2.2"]),  # §4.5: all group
        ("@here", CALLER, ["1.1", "1.2"]),      # §4.5: caller tab incl self
        ("@siblings", CALLER, ["1.2"]),         # §4.5: caller tab excl self
        ("@working", CALLER, ["1.1"]),          # §4.5: status group, global
        ("@claude", CALLER, ["1.1", "2.1"]),    # §4.5: command group, global
        ("2.@claude", CALLER, ["2.1"]),         # §4.5: tab 2 scoped, then claude
        ("@backend.@claude", CALLER, ["2.1"]),  # §4.5: named tab scoped, then claude
        ("@here.@claude", CALLER, ["1.1"]),     # §4.5: caller tab scoped, then claude
        ("1.@idle", CALLER, []),                # §4.5: no idle pane in tab 1
        ("@here", None, []),                    # §4.5: no anchor → empty, not global
        ("@siblings", None, []),                # §4.5: no anchor → empty
        ("2.@nope", CALLER, []),                # §4.5: unknown command in scoped tab
        ("@working.@claude", CALLER, []),       # §4.5: tabsel status group ≠ tab name
        ("1 . 2", CALLER, ["1.2"]),             # §4.5: whitespace around SEP is tolerated
    ],
)
def test_address_syntax_v2_table(targets, expr, from_session, expected_addrs):
    got = resolve(targets, expr, from_session=from_session)
    assert [t["addr"] for t in got] == expected_addrs


DOTS_TABS = TABS + [{
    "name": "api.v2", "activePaneId": "d1",
    "panes": [
        {"id": "d1", "sessionId": "sd1"},
        {"id": "d2", "sessionId": "sd2"},
    ],
}]
DOTS_STATUS = {
    **STATUS,
    "sd1": {"status": "idle", "command": "python", "title": "api dev"},
    "sd2": {"status": None, "command": "zsh", "title": ""},
}


@pytest.mark.parametrize(
    ("expr", "expected_addrs"),
    [
        # §4.5 (extended fixture): tab name with a dot, single-token → active pane.
        ("@api.v2", ["3.1"]),
        # §4.5 (extended fixture): tab name with a dot, with pane index.
        ("@api.v2.1", ["3.1"]),
    ],
)
def test_address_syntax_v2_dotted_tab_name(expr, expected_addrs):
    """Tab names may contain '.' — rsplit cut at the LAST separator keeps them intact."""
    targets = build_targets(DOTS_TABS, DOTS_STATUS)
    got = resolve(targets, expr, from_session=CALLER)
    assert [t["addr"] for t in got] == expected_addrs


def test_filter_targets_default_is_all(targets):
    assert filter_targets(targets) == targets


def test_filter_targets_same_tab_scopes_to_caller(targets):
    got = filter_targets(targets, scope="same_tab", from_session="s1")
    assert {t["addr"] for t in got} == {"1.1", "1.2"}
    got = filter_targets(targets, scope="same_tab", from_session="mobile-aaa")
    assert {t["addr"] for t in got} == {"2.1", "2.2"}


def test_filter_targets_same_tab_without_session_is_empty(targets):
    # Route converts this branch to HTTP 422; the pure function returns [].
    assert filter_targets(targets, scope="same_tab", from_session=None) == []
    assert filter_targets(targets, scope="same_tab", from_session="없는세션") == []


def test_filter_targets_status(targets):
    got = filter_targets(targets, status="working")
    assert [t["addr"] for t in got] == ["1.1"]
    got = filter_targets(targets, status="permission")
    assert [t["addr"] for t in got] == ["2.2"]


def test_filter_targets_command_is_case_insensitive(targets):
    got = filter_targets(targets, command="claude")
    assert {t["addr"] for t in got} == {"1.1", "2.1"}
    got = filter_targets(targets, command="CLAUDE")
    assert {t["addr"] for t in got} == {"1.1", "2.1"}


def test_filter_targets_combination(targets):
    got = filter_targets(
        targets, scope="same_tab", from_session="mobile-aaa",
        status="idle", command="claude",
    )
    assert [t["addr"] for t in got] == ["2.1"]
    # Same tab, but codex is the wrong command — intersection must empty out.
    got = filter_targets(
        targets, scope="same_tab", from_session="mobile-aaa",
        status="idle", command="codex",
    )
    assert got == []


def test_filter_targets_exclude_self_drops_caller_by_session_id(targets):
    got = filter_targets(targets, from_session="s1", exclude_self=True)
    assert {t["addr"] for t in got} == {"1.2", "2.1", "2.2"}


def test_filter_targets_exclude_self_drops_caller_by_tmux_session(targets):
    got = filter_targets(targets, from_session="mobile-aaa", exclude_self=True)
    assert {t["addr"] for t in got} == {"1.1", "1.2", "2.2"}


def test_filter_targets_exclude_self_without_session_is_noop(targets):
    got = filter_targets(targets, exclude_self=True)
    assert {t["addr"] for t in got} == {"1.1", "1.2", "2.1", "2.2"}
