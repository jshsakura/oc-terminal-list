"""리모트가 걸어 들어오는 문 — 잠겨 있는가, 그리고 열렸을 때 등록되는가."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from auth_manager import AuthManager
from remote_agent import registry
from remote_agent.credentials import issue_credential
from routes.remote_ws import router as remote_ws_router

HOST_ID = "host-abc"


@pytest.fixture
def manager():
    mgr = AuthManager.__new__(AuthManager)

    async def secret():
        return "test-secret-for-remote-ws"

    mgr.ensure_secret_key = secret
    return mgr


@pytest.fixture
def client(monkeypatch, manager):
    registry.clear()

    class _Storage:
        async def get_host(self, host_id):
            if host_id != HOST_ID:
                return None
            return {"id": HOST_ID, "username": "jsh", "name": "gpu-box"}

    monkeypatch.setattr("routes.remote_ws.storage", _Storage())
    monkeypatch.setattr("routes.remote_ws.get_auth_manager", lambda: manager)
    # ⚠️ main.app 을 쓰면 lifespan 이 통째로 뜬다(워처·레디스·tmux 폴링). 이 테스트가
    # 재려는 것은 **라우트 하나**이므로 그것만 담은 앱을 쓴다 — 빠르고, 앱 전체의
    # 부팅 상태에 결과가 좌우되지 않는다.
    app = FastAPI()
    app.include_router(remote_ws_router)
    with TestClient(app) as c:
        yield c
    registry.clear()


def _connect(client, token):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.websocket_connect("/api/remote/ws", headers=headers)


def test_no_credential_is_refused(client):
    with pytest.raises(WebSocketDisconnect):
        with _connect(client, None) as ws:
            ws.receive_json()


def test_an_itl_token_cannot_attach(client, manager, anyio_backend=None):
    """tmux env 로 새어 나가는 그 토큰으로는 못 붙는다."""
    token = asyncio.run(manager.create_scoped_token("jsh", "itl", extra={"host": HOST_ID}))
    with pytest.raises(WebSocketDisconnect):
        with _connect(client, token) as ws:
            ws.receive_json()


def test_a_credential_for_someone_elses_host_is_refused(client, manager):
    """⚠️ 자격증명이 살아 있어도 그 호스트가 남의 것이면 통로는 안 연다."""
    token = asyncio.run(issue_credential(manager, "someone-else", HOST_ID))
    with pytest.raises(WebSocketDisconnect):
        with _connect(client, token) as ws:
            ws.receive_json()


def test_a_credential_for_a_deleted_host_is_refused(client, manager):
    token = asyncio.run(issue_credential(manager, "jsh", "host-gone"))
    with pytest.raises(WebSocketDisconnect):
        with _connect(client, token) as ws:
            ws.receive_json()


def test_a_valid_remote_attaches_and_detaches(client, manager):
    token = asyncio.run(issue_credential(manager, "jsh", HOST_ID))
    with _connect(client, token):
        assert HOST_ID in registry.connected_host_ids()
    assert registry.connected_host_ids() == []


def test_facts_are_kept_for_natural_language_targeting(client, manager):
    """'GPU 있는 데서 돌려' 를 풀 재료 — 없으면 주소는 영영 숫자로만 고른다."""
    token = asyncio.run(issue_credential(manager, "jsh", HOST_ID))
    with _connect(client, token) as ws:
        ws.send_json({"t": "facts", "facts": {"gpu": "RTX 4090", "os": "Ubuntu 24.04"}})
        ws.send_json({"t": "server"})          # 처리 순서를 보장받기 위한 뒤따르는 한 줄
        for _ in range(50):
            conn = registry.get(HOST_ID)
            if conn and conn.facts:
                break
        assert registry.get(HOST_ID).facts["gpu"] == "RTX 4090"


def test_unknown_message_kinds_are_ignored_not_fatal(client, manager):
    """⚠️ 모르는 낱말 하나에 통로가 끊기면, 리모트를 새 버전으로 올린 순간 전부 끊긴다."""
    token = asyncio.run(issue_credential(manager, "jsh", HOST_ID))
    with _connect(client, token) as ws:
        ws.send_json({"t": "something-from-a-newer-remote", "x": 1})
        ws.send_json({"t": "server"})
        assert HOST_ID in registry.connected_host_ids()
