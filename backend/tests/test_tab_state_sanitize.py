"""
_sanitize_tab_state 의 pane 단위 생사 판정 검증.

핵심 회귀: 분할 탭에서 첫 pane(탭 레벨 sessionId 의 주인)을 닫아 그 세션이 죽어도,
남은 pane 이 살아있으면 탭을 지우면 안 된다 — 지우면 프론트가 살아있는 세션들을
단일탭으로 재입양해 "분할이 단일탭으로 풀리는" 사고가 난다.
"""
from unittest.mock import AsyncMock, patch

import pytest

from routes import user_state  # tab-state 로직은 main 에서 분리됨


def _live(*names):
    """살아있는 로컬 세션 이름 집합.

    ⚠️ 예전에는 `tmux_manager.list_sessions` 를 목했다. 지금은 **무엇이 세션을 붙잡는지가
    설정을 따르므로**(tmux / herdr / none) sanitize 도 `local_mux` 에게 묻는다 — tmux 에게만
    물으면 herdr 로 열어 둔 탭이 전부 "죽었다" 로 읽혀 레이아웃이 통째로 날아간다.
    """
    return set(names)


def _local_tab(tab_id, tab_session, pane_sessions):
    return {
        "id": tab_id,
        "type": "local",
        "sessionId": tab_session,
        "panes": [{"id": f"p{i}", "mode": "terminal", "sessionId": s}
                  for i, s in enumerate(pane_sessions)],
    }


@pytest.mark.anyio
async def test_split_tab_kept_when_tab_session_dead_but_pane_alive():
    # 탭 레벨 sessionId("dead")는 죽었지만 pane 하나("alive")가 살아있음 → 유지.
    tab = _local_tab("t1", "dead", ["dead", "alive"])
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("alive"))):
        tabs, active = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == [tab]
    assert active == "t1"


@pytest.mark.anyio
async def test_tab_dropped_when_all_panes_dead():
    tab = _local_tab("t1", "dead1", ["dead1", "dead2"])
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("other"))):
        tabs, active = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == []
    assert active is None


@pytest.mark.anyio
async def test_no_pruning_when_tmux_list_empty():
    # 목록 조회는 일시 오류와 진짜 빈 상태를 구분 못 함 → 빈 결과면 정리 skip.
    # `none` 을 골랐을 때도 이 길로 온다(붙잡아 두는 것이 없으니 목록이 항상 비어 있다).
    tab = _local_tab("t1", "s1", ["s1"])
    with patch.object(user_state.local_mux, "live_session_names",
                      AsyncMock(return_value=set())):
        tabs, active = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == [tab]
    assert active == "t1"


@pytest.mark.anyio
async def test_tab_with_host_pane_kept():
    # 로컬 tmux 로 생사 판정 불가한 호스트 pane 이 섞여 있으면 유지.
    tab = {
        "id": "t1",
        "type": "local",
        "sessionId": "dead",
        "panes": [
            {"id": "p0", "mode": "terminal", "sessionId": "dead"},
            {"id": "p1", "mode": "terminal", "hostId": "h1", "tmuxSessionName": "mobile-abc"},
        ],
    }
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("other"))):
        tabs, _ = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == [tab]


@pytest.mark.anyio
async def test_tab_with_editor_pane_kept():
    tab = {
        "id": "t1",
        "type": "local",
        "sessionId": "dead",
        "panes": [
            {"id": "p0", "mode": "terminal", "sessionId": "dead"},
            {"id": "p1", "mode": "editor"},
        ],
    }
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("other"))):
        tabs, _ = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == [tab]


@pytest.mark.anyio
async def test_tab_with_vnc_pane_kept():
    """mode:'vnc' pane 은 terminal/None 이 아니므로 sanitize 가 보존한다.

    새로고침 후 탭 복원 시 VNC pane 이 살아남아야 한다 (Phase 7 회귀 방지).
    """
    tab = {
        "id": "t1",
        "type": "local",
        "sessionId": "dead",
        "panes": [
            {"id": "p0", "mode": "terminal", "sessionId": "dead"},
            {"id": "p1", "mode": "vnc", "hostId": "h1", "display": 1},
        ],
    }
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("other"))):
        tabs, _ = await user_state._sanitize_tab_state([tab], "t1")
    assert tabs == [tab]
    vnc_pane = tabs[0]["panes"][1]
    assert vnc_pane["mode"] == "vnc"
    assert vnc_pane["hostId"] == "h1"
    assert vnc_pane["display"] == 1


@pytest.mark.anyio
async def test_legacy_tab_without_panes_uses_tab_session():
    dead = {"id": "t1", "type": "local", "sessionId": "dead"}
    alive = {"id": "t2", "type": "local", "sessionId": "alive"}
    host_tab = {"id": "t3", "type": "host", "hostId": "h1"}
    with patch.object(user_state.local_mux, "live_session_names",
                          AsyncMock(return_value=_live("alive"))):
        tabs, active = await user_state._sanitize_tab_state([dead, alive, host_tab], "t1")
    assert [t["id"] for t in tabs] == ["t2", "t3"]
    assert active == "t2"  # 지워진 활성 탭은 첫 생존 탭으로 이동
