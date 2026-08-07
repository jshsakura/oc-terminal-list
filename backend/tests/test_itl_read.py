"""GET /api/itl/read — terminal screen capture endpoint.

9 cases per ITL_MCP_PLAN.md §10.2 plus unit tests for the _tail /
_truncate_for_response helpers. ``tmux_manager.capture_pane`` and
``session_exists`` are mocked so no real tmux is required.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import routes.itl as itl_route
from _deps import verify_itl_token
from routes.itl import MAX_READ_CHARS, MAX_READ_LINES, _tail, _truncate_for_response, itl_read


def _target(addr: str = "1.1", session_id: str | None = "s1", remote: bool = False) -> dict:
    """Minimal target dict as produced by itl_targets.build_targets / resolve."""
    return {
        "addr": addr,
        "sessionId": session_id,
        "kind": "remote" if remote else "host",
        "tabIndex": 0,
        "paneIndex": 0,
    }


# -------------------------- helper unit tests --------------------------

def test_tail_returns_last_n_lines_preserving_order():
    assert _tail("line1\nline2\nline3\nline4", 2) == "line3\nline4"


def test_tail_returns_full_text_when_under_limit():
    text = "line1\nline2"
    assert _tail(text, 5) == text


def test_tail_empty_text_returns_empty():
    assert _tail("", 10) == ""


def test_tail_zero_or_negative_lines_returns_empty():
    assert _tail("a\nb", 0) == ""
    assert _tail("a\nb", -1) == ""


def test_truncate_under_limit_returns_unchanged():
    assert _truncate_for_response("short") == "short"


def test_truncate_over_limit_prefixes_cut_marker_and_keeps_tail():
    text = "x" * (MAX_READ_CHARS + 100)
    result = _truncate_for_response(text)
    assert result.startswith("…(잘림)\n")
    assert len(result) == MAX_READ_CHARS
    # tail preserved — last chars are still 'x'
    assert result.endswith("x")


# -------------------------- /read endpoint (8 direct-call cases) --------------------------

@pytest.mark.asyncio
async def test_read_excerpt_normal():
    """정상 excerpt — single match, session exists, excerpt applied."""
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "capture_pane", AsyncMock(return_value="raw pane text")), \
         patch.object(itl_route, "extract_excerpt", return_value="excerpted"):
        result = await itl_read(to="1.1", lines=40, mode="excerpt", username="u")
    assert result == {"addr": "1.1", "sessionId": "s1", "mode": "excerpt", "text": "excerpted"}


@pytest.mark.asyncio
async def test_read_raw_mode():
    """정상 raw — _tail returns last N lines, preserving order."""
    long_text = "a\nb\nc\nd\ne"
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "capture_pane", AsyncMock(return_value=long_text)):
        result = await itl_read(to="1.1", lines=2, mode="raw", username="u")
    assert result == {"addr": "1.1", "sessionId": "s1", "mode": "raw", "text": "d\ne"}


@pytest.mark.asyncio
async def test_read_unmatched_returns_404():
    """미매치 — resolve returns [] → 404 with the requested addr in detail."""
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[])), \
         patch.object(itl_route, "resolve", return_value=[]):
        with pytest.raises(HTTPException) as exc:
            await itl_read(to="9.9", username="u")
    assert exc.value.status_code == 404
    assert "9.9" in exc.value.detail


@pytest.mark.asyncio
async def test_read_multi_match_returns_400_with_matched():
    """다중매치 — 400 JSONResponse carrying matched addrs for the model to narrow."""
    t1, t2 = _target(addr="1.1", session_id="s1"), _target(addr="2.1", session_id="s2")
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[t1, t2])), \
         patch.object(itl_route, "resolve", return_value=[t1, t2]):
        result = await itl_read(to="@claude", username="u")
    # Multi-match path returns a JSONResponse (not raises HTTPException) so the
    # matched list can ride in the body alongside detail.
    from fastapi.responses import JSONResponse
    assert isinstance(result, JSONResponse)
    assert result.status_code == 400
    body = json.loads(bytes(result.body))
    assert body["matched"] == ["1.1", "2.1"]


@pytest.mark.asyncio
async def test_read_remote_unsupported_returns_400():
    """원격 pane — target has no sessionId → 400 remote-unsupported."""
    target = _target(addr="3.1", session_id=None, remote=True)
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]):
        with pytest.raises(HTTPException) as exc:
            await itl_read(to="3.1", username="u")
    assert exc.value.status_code == 400
    assert exc.value.detail == "remote-unsupported"


@pytest.mark.asyncio
async def test_read_session_gone_returns_404():
    """세션 없음 — session_exists False → 404 session-gone."""
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await itl_read(to="1.1", username="u")
    assert exc.value.status_code == 404
    assert exc.value.detail == "session-gone"


@pytest.mark.asyncio
async def test_read_disabled_returns_403(monkeypatch):
    """ITL_READ_ENABLED=0 → 403. Read widens a leaked token to ≈ interactive shell."""
    monkeypatch.setenv("ITL_READ_ENABLED", "0")
    with pytest.raises(HTTPException) as exc:
        await itl_read(to="1.1", username="u")
    assert exc.value.status_code == 403
    assert exc.value.detail == "읽기가 비활성화돼 있습니다"


@pytest.mark.asyncio
async def test_read_truncates_over_20k():
    """20k 초과 잘림 — capture returns >MAX_READ_CHARS, response is capped with cut marker."""
    big = "Y" * (MAX_READ_CHARS + 5000)
    target = _target()
    with patch.object(itl_route, "_targets_for", AsyncMock(return_value=[target])), \
         patch.object(itl_route, "resolve", return_value=[target]), \
         patch.object(itl_route.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(itl_route.tmux_manager, "capture_pane", AsyncMock(return_value=big)), \
         patch.object(itl_route, "extract_excerpt", return_value=big):
        result = await itl_read(to="1.1", mode="excerpt", username="u")
    assert isinstance(result, dict)
    assert result["text"].startswith("…(잘림)\n")
    assert len(result["text"]) == MAX_READ_CHARS


# ---- lines over MAX: must go through TestClient so Query(le=MAX) validation runs ----

def _read_app() -> FastAPI:
    app = FastAPI()
    app.include_router(itl_route.router)
    # bypass token auth — this case only exercises Query validation
    app.dependency_overrides[verify_itl_token] = lambda: "u"
    return app


def test_read_lines_over_max_returns_422():
    """lines 상한 초과 — Query(le=MAX_READ_LINES) rejects 201 with 422."""
    client = TestClient(_read_app())
    r = client.get("/api/itl/read", params={"to": "1.1", "lines": MAX_READ_LINES + 1})
    assert r.status_code == 422
