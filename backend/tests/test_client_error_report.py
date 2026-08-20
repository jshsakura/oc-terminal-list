"""브라우저에서만 아는 실패는 **살아있는 WS 로** 올라온다.

2026-08-20: 원격 pane 이미지 업로드가 실패했는데 서버·터널 어디에도 흔적이 없었다 —
요청이 브라우저를 나가질 못했다(공유 HTTP/2 연결이 막힘). 그래서 원인을 추정으로만
좁혀야 했다. 그 순간에도 WebSocket 은 멀쩡히 붙어 있었다(매번 새 TCP 라서).

그러니 보고는 **HTTP 로 받으면 안 된다.** 알려야 할 상황이 바로 그 HTTP 가 막힌 때다.
"""
from __future__ import annotations

import logging

import pytest

from ws_observe import CLIENT_ERROR_KINDS, CLIENT_ERROR_SCOPES, log_client_error


def _log(caplog, **kw):
    base = {"session": "s1", "client_id": "c1", "scope": "paste-image",
            "kind": "blocked", "detail": "TypeError"}
    with caplog.at_level(logging.WARNING, logger="ws_observe"):
        log_client_error(**{**base, **kw})
    return caplog.text


def test_a_blocked_upload_is_recorded(caplog):
    out = _log(caplog)
    assert "scope=paste-image" in out and "kind=blocked" in out


def test_it_is_a_warning_not_info(caplog):
    """폴링 소음 사이에서 눈에 띄어야 한다 — 이건 사용자가 실제로 겪은 실패다."""
    with caplog.at_level(logging.WARNING, logger="ws_observe"):
        log_client_error(session="s", client_id="c", scope="paste-image",
                         kind="blocked", detail="")
    assert any(r.levelno >= logging.WARNING for r in caplog.records)


@pytest.mark.parametrize("bad", ["../../etc", "'; DROP", "x" * 200, "unknown-scope"])
def test_unknown_scopes_fold(caplog, bad):
    assert "scope=other" in _log(caplog, scope=bad)


@pytest.mark.parametrize("bad", ["hacked", "", "x" * 100])
def test_unknown_kinds_fold(caplog, bad):
    assert "kind=other" in _log(caplog, kind=bad)


def test_detail_cannot_forge_a_log_line(caplog):
    """막아야 할 것은 **새 줄을 만드는 것**이다.

    문자열 자체를 검열할 필요는 없다 — `detail=` 뒤에 남아 있는 한 데이터로 읽힌다.
    위험한 건 개행을 흘려 '독립된 다음 줄'처럼 보이게 만드는 것이다.
    """
    out = _log(caplog, detail="ok\n2026-01-01 - root - CRITICAL - 침입했다")
    lines = [ln for ln in out.splitlines() if ln.strip()]
    assert len(lines) == 1, "개행이 살아 남아 줄이 쪼개졌다"
    assert "CRITICAL" in lines[0]          # 데이터로는 남는다 (검열이 목적이 아니다)
    assert lines[0].index("CRITICAL") > lines[0].index("detail="), "detail 필드 밖으로 샜다"


def test_detail_is_capped(caplog):
    out = _log(caplog, detail="z" * 5000)
    line = [ln for ln in out.splitlines() if "client error" in ln][0]
    assert len(line) < 400


def test_the_vocabulary_matches_the_client():
    """프론트가 서버가 모르는 낱말을 보내면 전부 other 로 접혀 조용히 쓸모없어진다."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[2] / "frontend" / "src"
    src = (root / "components" / "terminal" / "attachTerminalInteractions.js").read_text(encoding="utf-8")
    scopes = set(re.findall(r"reportClientError\([^)]*scope:\s*'([a-z-]+)'", src, re.S))
    assert scopes, "reportClientError 호출이 없다 — 배선이 빠졌다"
    assert scopes <= CLIENT_ERROR_SCOPES, f"서버가 모르는 scope: {scopes - CLIENT_ERROR_SCOPES}"
    helpers = (root / "components" / "terminal" / "terminalHelpers.js").read_text(encoding="utf-8")
    assert "'client-error'" in helpers or '"client-error"' in helpers
    kinds = set(re.findall(r"new UploadError\('([a-z]+)'", helpers))
    assert kinds <= CLIENT_ERROR_KINDS, f"서버가 모르는 kind: {kinds - CLIENT_ERROR_KINDS}"


def test_both_bridges_accept_it():
    """원격 pane 이 실제 실패 사례였다 — 로컬만 받으면 그 케이스를 통째로 놓친다."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    local = (root / "ws_bridge.py").read_text(encoding="utf-8")
    remote = (root / "host_manager.py").read_text(encoding="utf-8")
    assert '"client-error"' in local
    # host_manager 에는 브리지가 둘이다(asyncssh / tailscale). 둘 다 받아야 한다.
    assert remote.count('"client-error"') == 2


def test_it_never_reaches_the_shell():
    """제어 메시지가 PTY 로 흘러 셸에 타이핑되면 그게 더 큰 사고다."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "ws_bridge.py").read_text(encoding="utf-8")
    seg = src[src.index('if mtype == "client-error"'):]
    assert "continue" in seg[:600], "처리 후 continue 가 없으면 write_input 으로 떨어진다"
