"""POST /api/itl/send + /api/itl/key — rate limit (§6.4) and key whitelist (§6.3).

Backend-level tests for the safety mechanisms. The MCP-level conversion of 429
to the verbatim "보내기가 너무 잦습니다..." sentence is covered in
test_itl_mcp.py — here we only verify the backend surfaces 429 / 400.
"""
from __future__ import annotations

import time
from collections import deque
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import rate_limit
import routes.itl as itl_route
from routes.itl import ALLOWED_KEYS, KeyRequest, SendRequest


@pytest.fixture(autouse=True)
def _clear_rate_limit_buckets():
    """Each test starts with an empty rate-limit table. Without this, the
    sliding window from one test bleeds into the next."""
    rate_limit._buckets.clear()
    yield
    rate_limit._buckets.clear()


def _target(addr="1.1", session_id="s1"):
    return {
        "addr": addr, "tabIndex": 0, "paneIndex": int(addr.split(".")[-1]),
        "sessionId": session_id, "tmuxSession": session_id,
        "command": "claude", "status": "idle",
    }


# -------------------------- /send rate limit (§6.4) --------------------------

async def test_send_under_limit_succeeds():
    """30 sends in window -> 31st would 429, but the 30th must still pass."""
    request = SendRequest(to="1.1", text="hi", from_session="src-1")
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "send_keys", AsyncMock()):
        for _ in range(itl_route.RATE_LIMIT_MAX):
            await itl_route.itl_send(request, username="user")
    # Bucket now has RATE_LIMIT_MAX entries; one more must 429.
    with pytest.raises(HTTPException) as exc:
        await itl_route.itl_send(request, username="user")
    assert exc.value.status_code == 429


async def test_send_31st_returns_429_when_bucket_full():
    """The team-lead reproduction case: 30 pre-filled attempts -> next is 429.

    Pre-fills the bucket directly (no 30 real calls) so the test stays fast
    and doesn't depend on side effects of the prior sends.
    """
    key = "itl:send:src-1"
    now = time.monotonic()
    rate_limit._buckets[key] = deque([now - i for i in range(itl_route.RATE_LIMIT_MAX)])
    request = SendRequest(to="1.1", text="hi", from_session="src-1")
    with pytest.raises(HTTPException) as exc:
        await itl_route.itl_send(request, username="user")
    assert exc.value.status_code == 429


async def test_send_rate_limit_scoped_by_source_session():
    """Two different from_session values get independent buckets."""
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "send_keys", AsyncMock()):
        # Burn src-A's bucket to the limit.
        req_a = SendRequest(to="1.1", text="hi", from_session="src-A")
        for _ in range(itl_route.RATE_LIMIT_MAX):
            await itl_route.itl_send(req_a, username="user")
        # src-B must still be allowed.
        req_b = SendRequest(to="1.1", text="hi", from_session="src-B")
        await itl_route.itl_send(req_b, username="user")  # no raise


# -------------------------- /key whitelist (§6.3) --------------------------

async def test_key_whitelist_violation_returns_400():
    """Non-allowed key short-circuits with 400 before rate-limit or resolve."""
    request = KeyRequest(to="1.1", key="C-f", from_session="src-1")
    with pytest.raises(HTTPException) as exc:
        await itl_route.itl_key(request, username="user")
    assert exc.value.status_code == 400
    assert "C-f" in exc.value.detail
    for allowed in ALLOWED_KEYS:
        assert allowed in exc.value.detail


async def test_key_happy_path_uses_send_key_not_send_keys():
    """Whitelisted key reaches tmux_manager.send_key (NOT send_keys -l, which
    would type the literal 'C-c'). The telegram-trap guard (§5.3)."""
    target = _target(session_id="s-tmux")
    request = KeyRequest(to="1.1", key="C-c", from_session="src-1")
    send_key_mock = AsyncMock()
    send_keys_mock = AsyncMock()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "send_key", send_key_mock), \
         patch.object(itl_route.tmux_manager, "send_keys", send_keys_mock):
        result = await itl_route.itl_key(request, username="user")
    send_key_mock.assert_awaited_once_with("s-tmux", "C-c")
    send_keys_mock.assert_not_awaited()
    assert result["delivered"] == [{"addr": "1.1", "sessionId": "s-tmux"}]
    assert result["skipped"] == []


async def test_key_unmatched_returns_404():
    request = KeyRequest(to="@nope", key="C-c", from_session="src-1")
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[])), \
         patch.object(itl_route, "resolve", return_value=[]):
        with pytest.raises(HTTPException) as exc:
            await itl_route.itl_key(request, username="user")
    assert exc.value.status_code == 404


async def test_key_rate_limit_independent_from_send():
    """30 /key calls + 30 /send calls from the same source both pass — separate
    buckets per route, otherwise terminal_key would be starved by terminal_send."""
    target = _target()
    key_req = KeyRequest(to="1.1", key="q", from_session="src-1")
    send_req = SendRequest(to="1.1", text="hi", from_session="src-1")
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "send_key", AsyncMock()), \
         patch.object(itl_route.tmux_manager, "send_keys", AsyncMock()):
        for _ in range(itl_route.RATE_LIMIT_MAX):
            await itl_route.itl_key(key_req, username="user")
        # /send from the same source is still under its own cap.
        await itl_route.itl_send(send_req, username="user")
