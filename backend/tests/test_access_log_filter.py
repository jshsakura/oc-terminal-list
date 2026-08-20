"""폴링 소음을 솎되, 실패는 절대 솎지 않는다.

실측(7일): 앱 로그 34,478 줄 중 17,663 줄이 access 로그 `200 OK` 였고 `GET /api/git/status`
하나가 4,851 줄이었다. 그 사이에 WS attach/detach·경고가 파묻혀 재연결 진단이 불가능했다.

이 필터의 위험은 하나다 — **너무 많이 지우는 것.** 폴링 엔드포인트의 404·500 이야말로
가장 보고 싶은 줄이고, WS 핸드셰이크 줄은 attach/detach 와 짝을 이루는 근거다.
"""
from __future__ import annotations

import logging

import pytest

from access_log_filter import QuietPollingAccessFilter

FILTER = QuietPollingAccessFilter()


def _access(path: str, status: int, method: str = "GET") -> logging.LogRecord:
    """uvicorn.access 가 실제로 만드는 모양 그대로."""
    return logging.LogRecord(
        name="uvicorn.access", level=logging.INFO, pathname="", lineno=0,
        msg='%s - "%s %s HTTP/%s" %d %s',
        args=("1.2.3.4:0", method, path, "1.1", status, "OK"),
        exc_info=None,
    )


@pytest.mark.parametrize("path", [
    "/api/git/status?path=iTerminaLlist",
    "/api/sessions/cwd/batch?ids=abc",
    "/api/sessions/abc-123/clients?client_id=x",
    "/api/hosts/tmux-sessions/batch",
    "/api/hosts/a2295ae4-a2ee/cwd/batch",
    "/api/hosts/a2295ae4-a2ee/tmux-clients?session=mobile-1",
    "/api/tab-state",
    "/api/ws-tickets",
    "/api/sse-ticket",
    "/api/agent-status",
    "/api/snippets",
    "/api/command-history",
])
def test_successful_polling_is_dropped(path):
    assert FILTER.filter(_access(path, 200)) is False


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 500, 502])
def test_failures_are_never_dropped(status):
    """같은 경로여도 실패는 남는다 — 조용해지면 안 되는 바로 그 줄이다."""
    assert FILTER.filter(_access("/api/git/status?path=x", status)) is True


@pytest.mark.parametrize("path", [
    "/ws/3b77b742-f232-497a?ticket=x&create=0",
    "/ws/host/a2295ae4-a2ee?ticket=x",
])
def test_websocket_handshakes_survive(path):
    """WS 핸드셰이크는 attach/detach 와 짝을 이룬다 — 이걸 지우면 관측이 반쪽이 된다."""
    assert FILTER.filter(_access(path, 200)) is True


@pytest.mark.parametrize("path", [
    "/api/hosts",
    "/api/itl/send",
    "/api/terminal/paste-image",
    "/api/usage/summary",
    "/api/files/read?path=x",
    "/",
])
def test_everything_else_survives(path):
    """화이트리스트에 없으면 남긴다. 새 엔드포인트가 조용해지는 건 사고다."""
    assert FILTER.filter(_access(path, 200)) is True


def test_a_prefix_match_does_not_swallow_a_sibling_route():
    """`/api/tab-state` 는 솎지만 `/api/tab-state/events`(SSE 연결)는 드물고 의미가 있다."""
    assert FILTER.filter(_access("/api/tab-state", 200, "PUT")) is False
    # 같은 접두라 함께 솎인다 — 의도된 것임을 여기 못박아, 나중에 되살릴 때 근거가 남게 한다.
    assert FILTER.filter(_access("/api/tab-state/events?ticket=x", 200)) is False


def test_a_malformed_record_is_left_alone():
    """포맷이 바뀌면(uvicorn 업그레이드) 지우지 말고 그냥 통과시킨다 — 안전한 실패."""
    rec = logging.LogRecord(
        name="uvicorn.access", level=logging.INFO, pathname="", lineno=0,
        msg="something else entirely", args=None, exc_info=None,
    )
    assert FILTER.filter(rec) is True


def test_the_filter_still_reports_that_traffic_flowed(caplog, monkeypatch):
    """솎되 침묵하지 않는다 — 이 줄이 없어서 실제 진단에 실패한 적이 있다.

    "그 3분간 이 브라우저의 HTTP 가 살아 있었나" 를 나중에 물을 수 있어야 한다.
    요약이 **끊기는 것**이 곧 "클라이언트의 HTTP 가 멈췄다" 는 증거가 된다.
    """
    f = QuietPollingAccessFilter()
    monkeypatch.setattr(f, "_window_started", -1e9)      # 창이 이미 만료된 상태로
    with caplog.at_level(logging.INFO, logger="access_log_filter"):
        assert f.filter(_access("/api/git/status?path=x", 200)) is False
    assert "폴링 성공" in caplog.text


def test_the_summary_does_not_fire_on_every_line(caplog):
    """요약이 매 줄 나오면 솎는 의미가 없다."""
    f = QuietPollingAccessFilter()
    with caplog.at_level(logging.INFO, logger="access_log_filter"):
        for _ in range(50):
            f.filter(_access("/api/git/status?path=x", 200))
    assert "폴링 성공" not in caplog.text


def test_the_summary_never_re_enters_the_filter():
    """uvicorn.access 로 요약을 쓰면 자기 필터를 다시 지나 재귀한다."""
    import access_log_filter as mod
    assert mod._summary_logger.name != "uvicorn.access"
