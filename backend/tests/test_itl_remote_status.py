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


@pytest.mark.asyncio
async def test_fill_asks_each_host_once(monkeypatch):
    """pane 마다 묻지 않는다 — `list-panes -a` 가 그 호스트의 모든 세션을 한 번에 준다."""
    asked = []

    async def fake_list(host_id, username):
        asked.append(host_id)
        return {"a1": ("claude", "⠋ Building the thing"), "a2": ("zsh", "~")}

    monkeypatch.setattr(itl_remote, "list_pane_status", fake_list)
    filled = await itl_route._fill_remote_status(_targets(), "u")
    by_addr = {t["addr"]: t for t in filled}

    assert sorted(asked) == ["h1", "h2"]                 # 호스트 수만큼, pane 수만큼이 아니라
    assert by_addr["1.2"]["status"] == "working"
    assert by_addr["1.2"]["command"] == "claude"
    assert by_addr["1.2"]["statusUnknown"] is False
    # 셸은 상태가 없다 — 그건 "모름" 이 아니라 "일하고 있지 않음" 이다.
    assert by_addr["1.3"]["status"] is None
    assert by_addr["1.3"]["statusUnknown"] is False


@pytest.mark.asyncio
async def test_unreachable_host_stays_unknown(monkeypatch):
    """못 물어본 것을 유휴로 적으면 기다림이 거짓으로 끝난다."""
    async def fake_list(host_id, username):
        return {} if host_id == "h2" else {"a1": ("claude", "✳ x"), "a2": ("zsh", "~")}

    monkeypatch.setattr(itl_remote, "list_pane_status", fake_list)
    by_addr = {t["addr"]: t for t in await itl_route._fill_remote_status(_targets(), "u")}
    assert by_addr["1.4"]["statusUnknown"] is True
    assert by_addr["1.4"]["status"] is None


@pytest.mark.asyncio
async def test_host_answered_but_session_missing_is_gone_not_unknown(monkeypatch):
    async def fake_list(host_id, username):
        return {"a1": ("claude", "✳ x")}          # a2 / b1 없음

    monkeypatch.setattr(itl_remote, "list_pane_status", fake_list)
    by_addr = {t["addr"]: t for t in await itl_route._fill_remote_status(_targets(), "u")}
    assert by_addr["1.3"]["statusGone"] is True
    assert by_addr["1.3"]["statusUnknown"] is False


@pytest.mark.asyncio
async def test_local_targets_and_the_input_list_are_untouched(monkeypatch):
    """원본을 고치지 않는다 — 채운 결과는 새 dict 다(스냅샷을 나중에 다시 쓸 수 있게)."""
    async def fake_list(host_id, username):
        return {"a1": ("claude", "✳ x")}

    monkeypatch.setattr(itl_remote, "list_pane_status", fake_list)
    original = _targets()
    filled = await itl_route._fill_remote_status(original, "u")
    assert original[1]["statusUnknown"] is True          # 입력은 그대로
    assert filled[1]["statusUnknown"] is False
    assert filled[0] is original[0]                      # 로컬은 손대지 않으므로 같은 객체


@pytest.mark.asyncio
async def test_no_remote_targets_means_no_ssh(monkeypatch):
    async def fake_list(host_id, username):      # pragma: no cover - 호출되면 실패
        raise AssertionError("원격이 없는데 SSH 를 걸었다")

    monkeypatch.setattr(itl_remote, "list_pane_status", fake_list)
    local_only = [t for t in _targets() if t["addr"] == "1.1"]
    assert await itl_route._fill_remote_status(local_only, "u") == local_only
