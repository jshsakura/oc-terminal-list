"""지운 세션은 되살아나지 않는다.

⚠️ 원격 브리지는 세션이 사라지면 `create=1` 로 다시 만든다 — 호스트 재부팅 복구용이다.
그런데 사용자가 **직접 지운** 경우엔 그 복구가 정반대로 작동해 곧바로 되살아난다.
화면에서는 "지워도 새로고침하면 다시 뜬다" 로 보인다.
"""
from __future__ import annotations

import time

import pytest

import session_tombstones as graves


@pytest.fixture(autouse=True)
def _clean():
    graves.clear()
    yield
    graves.clear()


def test_a_killed_session_is_remembered():
    graves.mark_killed("h1", "mobile-a")
    assert graves.was_killed("h1", "mobile-a") is True


def test_other_sessions_are_untouched():
    """⚠️ 한 세션을 지웠다고 그 호스트의 다른 세션까지 막으면 안 된다."""
    graves.mark_killed("h1", "mobile-a")
    assert graves.was_killed("h1", "mobile-b") is False
    assert graves.was_killed("h2", "mobile-a") is False


def test_the_grave_is_short_lived():
    """⚠️ 무덤은 **붙는 것 자체**를 막는다. 길게 두면 같은 이름으로 새로 여는 것까지
    막혀 호스트가 안 열린다(기본 세션명을 지운 직후라면 바로 그렇게 된다).
    길 필요도 없다 — 클라이언트가 `session-terminated` 를 받으면 재접속을 멈춘다."""
    assert graves.TOMBSTONE_TTL_SEC <= 30


def test_the_grave_expires(monkeypatch):
    monkeypatch.setattr(graves, "TOMBSTONE_TTL_SEC", 0.05)
    graves.mark_killed("h1", "mobile-a")
    time.sleep(0.08)
    assert graves.was_killed("h1", "mobile-a") is False


def test_forget_clears_it():
    graves.mark_killed("h1", "mobile-a")
    graves.forget("h1", "mobile-a")
    assert graves.was_killed("h1", "mobile-a") is False


def test_blank_inputs_are_not_graves():
    graves.mark_killed("", "")
    assert graves.was_killed("", "") is False


# ---------------------- 배선 ----------------------

def test_killing_a_session_marks_it():
    """`kill-tmux` 가 표를 남기지 않으면 아래 거절 로직이 쓸모없다."""
    import inspect
    import routes.hosts as hosts_route
    body = inspect.getsource(hosts_route.kill_host_tmux)
    assert "session_tombstones.mark_killed" in body
    # ⚠️ force(kill-server)는 표를 남기지 않는다 — 그건 "이 호스트를 통째로 리셋" 이라
    # 다음 연결이 정상적으로 새 세션을 여는 게 맞다.
    assert "not force" in body.split("session_tombstones.mark_killed")[0].rsplit("if ", 1)[-1]


def test_the_bridge_consults_the_grave():
    import inspect
    import routes.host_ws as host_ws
    assert "session_tombstones.was_killed" in inspect.getsource(host_ws.host_websocket)


def test_the_bridge_closes_instead_of_letting_the_loop_spin():
    """⚠️ `create` 만 끄면 붙기는 하고 → session-gone → 클라이언트가 create=1 로 다시 온다.
    그 고리가 돌면 무덤이 만료되는 순간 세션이 되살아난다. 붙기 전에 닫아야 한다."""
    import inspect
    import routes.host_ws as host_ws
    body = inspect.getsource(host_ws.host_websocket)
    at = body.index("session_tombstones.was_killed")
    block = body[at:at + 700]
    assert "session-terminated" in block
    assert "websocket.close" in block


def test_the_bridge_does_not_accept_twice():
    """⚠️ 소켓은 secrets 해석 직후 한 번만 accept 한다.

    무덤 분기가 또 accept 하면 starlette 가 RuntimeError 를 던지고, 그러면 이 분기가
    하려던 `session-terminated` 통보가 통째로 날아가 클라이언트는 재접속 고리에 남는다.
    실제 로그에 `Expected ASGI message "websocket.send" or "websocket.close", but got
    'websocket.accept'` 로 남아 있었다(2026-09-04).
    """
    import inspect
    import routes.host_ws as host_ws
    body = inspect.getsource(host_ws.host_websocket)
    assert body.count("websocket.accept()") == 1


def test_the_client_stops_reconnecting_on_that_signal():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components"
           / "Terminal.jsx").read_text(encoding="utf-8")
    assert "session-terminated" in src
    # onclose 에서 재접속을 끊는 가드가 있어야 한다.
    assert "if (endedByServerRef.current) return;" in src
