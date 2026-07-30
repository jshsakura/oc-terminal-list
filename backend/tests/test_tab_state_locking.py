"""
PUT /api/tab-state 의 optimistic locking 동작 검증.

stale ifMatch → 409 + current state.
matching ifMatch → 200 + new updatedAt.
ifMatch 없음 → 200 (초기 save 허용).
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from routes import user_state  # tab-state 로직은 main 에서 분리됨


@pytest.fixture
def client():
    main.app.dependency_overrides[main.verify_auth_token] = lambda: "testuser"
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.clear()


@pytest.fixture
def storage_mock():
    """storage 의 호출되는 메소드들을 모두 mock."""
    with patch.object(user_state, "storage", autospec=False) as m:
        m.get_tab_state_updated_at = AsyncMock(return_value=None)
        m.get_tab_state = AsyncMock(return_value=None)
        m.save_tab_state = AsyncMock(return_value="2026-05-18T03:00:00")
        yield m


@pytest.fixture
def tmux_mock():
    """_sanitize_tab_state 가 호출하는 tmux_manager.list_sessions 모킹."""
    with patch.object(user_state, "tmux_manager", autospec=False) as m:
        m.list_sessions = AsyncMock(return_value=[])
        yield m


def test_put_without_ifmatch_saves_normally(client, storage_mock, tmux_mock):
    storage_mock.get_tab_state_updated_at.return_value = "2026-05-18T02:00:00"
    res = client.put("/api/tab-state", json={
        "tabs": [{"id": "host:x", "type": "host", "panes": []}],
        "activeTabId": "host:x",
    })
    assert res.status_code == 200
    assert res.json()["updatedAt"] == "2026-05-18T03:00:00"
    storage_mock.save_tab_state.assert_awaited_once()


def test_put_with_matching_ifmatch_saves(client, storage_mock, tmux_mock):
    storage_mock.get_tab_state_updated_at.return_value = "2026-05-18T02:00:00"
    res = client.put("/api/tab-state", json={
        "tabs": [{"id": "host:x", "type": "host", "panes": []}],
        "activeTabId": "host:x",
        "ifMatch": "2026-05-18T02:00:00",
    })
    assert res.status_code == 200
    storage_mock.save_tab_state.assert_awaited_once()


def test_put_with_stale_ifmatch_returns_409_and_current(client, storage_mock, tmux_mock):
    storage_mock.get_tab_state_updated_at.return_value = "2026-05-18T05:00:00"
    storage_mock.get_tab_state.return_value = {
        "tabs": [{"id": "preserved", "type": "host", "panes": [{"id": "p1"}, {"id": "p2"}]}],
        "activeTabId": "preserved",
        "updatedAt": "2026-05-18T05:00:00",
    }
    res = client.put("/api/tab-state", json={
        "tabs": [{"id": "stale", "type": "host", "panes": []}],
        "activeTabId": "stale",
        "ifMatch": "2026-05-18T02:00:00",  # 서버는 이미 05:00:00
    })
    assert res.status_code == 409
    body = res.json()
    assert body["detail"] == "tab-state version mismatch"
    assert body["current"]["tabs"][0]["id"] == "preserved"
    # stale 한 PUT 은 save 호출되면 안 됨
    storage_mock.save_tab_state.assert_not_awaited()


def test_put_with_ifmatch_when_server_has_no_state_saves(client, storage_mock, tmux_mock):
    # 처음 사용자 — DB 에 row 없음 → get_tab_state_updated_at=None → ifMatch 검사 통과
    storage_mock.get_tab_state_updated_at.return_value = None
    res = client.put("/api/tab-state", json={
        "tabs": [{"id": "x", "type": "host", "panes": []}],
        "activeTabId": "x",
        "ifMatch": "2026-05-18T02:00:00",
    })
    assert res.status_code == 200


def test_put_with_identical_content_does_not_bump_version(client, storage_mock, tmux_mock):
    """내용이 같은 PUT 은 저장도 SSE 통지도 하지 않는다 — 기기 간 에코 루프의 연료 차단."""
    stored = {
        "tabs": [{"id": "host:x", "type": "host", "panes": []}],
        "activeTabId": "host:x",
        "updatedAt": "2026-05-18T02:00:00",
    }
    storage_mock.get_tab_state_updated_at.return_value = "2026-05-18T02:00:00"
    storage_mock.get_tab_state.return_value = stored

    with patch.object(user_state, "_notify_tab_state_change") as notify:
        res = client.put("/api/tab-state", json={
            "tabs": stored["tabs"],
            "activeTabId": stored["activeTabId"],
            "ifMatch": "2026-05-18T02:00:00",
        })

    assert res.status_code == 200
    assert res.json() == {"status": "unchanged", "updatedAt": "2026-05-18T02:00:00"}
    storage_mock.save_tab_state.assert_not_awaited()
    notify.assert_not_called()


def test_put_with_changed_active_tab_still_saves(client, storage_mock, tmux_mock):
    """활성 탭만 달라져도 실제 변경이므로 저장된다."""
    storage_mock.get_tab_state_updated_at.return_value = "2026-05-18T02:00:00"
    storage_mock.get_tab_state.return_value = {
        "tabs": [{"id": "host:x", "type": "host", "panes": []}],
        "activeTabId": "host:x",
        "updatedAt": "2026-05-18T02:00:00",
    }
    res = client.put("/api/tab-state", json={
        "tabs": [{"id": "host:x", "type": "host", "panes": []}],
        "activeTabId": None,
    })
    assert res.status_code == 200
    assert res.json()["status"] == "saved"
    storage_mock.save_tab_state.assert_awaited_once()


def test_put_rejects_non_list_tabs(client, storage_mock, tmux_mock):
    res = client.put("/api/tab-state", json={
        "tabs": "not a list",
        "activeTabId": "x",
    })
    # Pydantic 이 422 로 막거나 우리 400 으로 막거나 — 둘 다 4xx 면 OK.
    assert 400 <= res.status_code < 500
