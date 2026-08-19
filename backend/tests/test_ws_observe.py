"""재연결 사유는 클라이언트만 안다 — 그걸 로그에 남기는 계약.

서버는 소켓이 다시 열린 것만 본다. 하트비트 오탐인지, 터널이 끊은 것인지, 그냥 폰을
다시 켠 것인지는 **클라이언트만** 안다. 그래서 핸드셰이크에 `reason`/`prev_ms` 를 싣고,
여기서 그것을 로그로 옮긴다.

⚠️ 그 값은 클라이언트가 준 것이다. 인증에는 절대 쓰지 않고 로그로만 나가지만, 로그
injection 을 막기 위해 화이트리스트로 접는다.
"""
from __future__ import annotations

import logging
import time

import pytest

from ws_observe import KNOWN_REASONS, log_attach, log_detach, sanitize_reason


@pytest.mark.parametrize("raw,expected", [
    ("heartbeat", "heartbeat"),
    ("session-gone", "session-gone"),
    ("close-1006", "close-1006"),
    ("close-1000", "close-1000"),
    (None, "unset"),
    ("", "unset"),
])
def test_known_shapes_pass_through(raw, expected):
    assert sanitize_reason(raw) == expected


@pytest.mark.parametrize("raw", [
    "heartbeat\n2026-01-01 - root - CRITICAL - 침입",   # 개행으로 가짜 로그 줄 만들기
    "close-99999999",                                    # 코드 자리수 초과
    "close-abc",
    "'; DROP TABLE",
    "x" * 500,
    "  heartbeat  extra",
])
def test_anything_else_is_folded(raw):
    out = sanitize_reason(raw)
    assert out == "other"
    assert "\n" not in out and len(out) <= 24


def test_the_vocabulary_matches_what_the_client_sends():
    """프론트(`Terminal.jsx` 의 markConnectReason)와 같은 낱말을 써야 한다.

    어긋나면 전부 `other` 로 접혀 로그가 조용히 쓸모없어진다 — 에러는 안 난다.
    """
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "Terminal.jsx"
    used = set(re.findall(r"markConnectReason\('([a-z-]+)'\)", src.read_text(encoding="utf-8")))
    assert used, "markConnectReason 호출이 하나도 없다 — 배선이 빠졌다"
    unknown = used - KNOWN_REASONS
    assert not unknown, f"프론트가 서버가 모르는 사유를 보낸다: {unknown}"


def test_attach_line_carries_the_reason_and_previous_lifetime(caplog):
    with caplog.at_level(logging.INFO, logger="ws_observe"):
        log_attach(
            kind="local", session="3b77b742-f232-497a-8346-3a27fd09894b", user="jshsakura",
            client_id="eed35ded-2e58-4cee-adda-49cb0fe164b2", reason="heartbeat", prev_ms=13200,
            cols=73, rows=34,
        )
    line = caplog.text
    assert "reason=heartbeat" in line
    assert "prev=13.2s" in line, "직전 소켓 수명이 없으면 요동과 단발 끊김을 구별 못 한다"
    assert "session=3b77b742" in line and "3b77b742-f232" not in line, "UUID 는 8자로 줄인다"


@pytest.mark.parametrize("a,b", [
    ("mobile-2b4a0a2ee6f8", "mobile-239e7229610c"),   # 앞 8자가 둘 다 "mobile-2"
    ("mobile-8f025992a5c4", "mobile-8f0259920000"),
])
def test_two_different_tmux_sessions_never_look_the_same(caplog, a, b):
    """짧게 줄이려다 구별을 잃으면 로그가 거짓말을 한다 — 서로 다른 pane 이 같아 보인다."""
    from ws_observe import _short
    assert _short(a) != _short(b)


def test_uuids_are_still_trimmed():
    """UUID 는 랜덤이라 앞 8자로 갈린다 — 폭을 낭비할 이유가 없다."""
    from ws_observe import _short
    assert _short("3b77b742-f232-497a-8346-3a27fd09894b") == "3b77b742"


def test_detach_line_reports_how_long_the_socket_lived(caplog):
    with caplog.at_level(logging.INFO, logger="ws_observe"):
        log_detach(kind="local", session="mobile-abcdef12", client_id="cccccccc-x",
                   opened_at=time.monotonic() - 2.5)
    assert "lived=2.5s" in caplog.text


def test_missing_prev_is_not_reported_as_zero(caplog):
    """첫 연결에는 직전 소켓이 없다. 0.0s 로 적으면 '즉시 끊겼다' 로 읽힌다."""
    with caplog.at_level(logging.INFO, logger="ws_observe"):
        log_attach(kind="local", session="s", user="u", client_id=None,
                   reason="initial", prev_ms=None, cols=80, rows=24)
    assert "prev=-" in caplog.text
