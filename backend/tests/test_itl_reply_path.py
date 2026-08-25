"""보내는 쪽에게 "답장이 온다" 를 알리는 계약.

왜 이게 기능인가: 답장 명령은 **받는 쪽 화면에만** 붙는다. 보내는 쪽은 그걸 볼 수 없으므로,
말해주지 않으면 답장이 온다는 사실을 모른 채 되묻는 쪽(terminal_read 반복)을 고른다.
그 되묻기가 토큰을 태운 그 패턴이다 — 도구 호출 한 번마다 컨텍스트 전체가 재청구된다.

⚠️ 그리고 **붙지 않았을 때도 말해야 한다.** 받는 쪽이 셸이거나 그 기계에 itl 이 없으면
답장할 방법이 없는데, 그때도 "답장이 온다" 고 적으면 오지 않을 답을 기다리게 된다
(이 저장소의 "모른다고 적는 것이 기능" 규칙과 같은 자리).
"""
from __future__ import annotations

import importlib.util
import json
import os

import pytest

from itl_origin import build_reply_cmd, format_origin


def _load_mcp_tools():
    """`cli/itl_mcp_tools.py` 를 모듈로 읽는다 — 패키지가 아니라 배포되는 단일 파일이다."""
    path = os.path.join(os.path.dirname(__file__), "..", "cli", "itl_mcp_tools.py")
    spec = importlib.util.spec_from_file_location("itl_mcp_tools_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 답장 명령 자체 ──────────────────────────────────────────────────────────

def test_답장_주소는_번호가_아니라_세션_ID다():
    """번호는 pane 이 닫히면 밀린다. 답장은 항상 원래 그 터미널로 가야 한다."""
    cmd = build_reply_cmd("itl", {"addr": "1.2", "sessionId": "sess-abc"})
    assert "sess-abc" in cmd
    assert "1.2" not in cmd
    assert "--submit" in cmd          # 답장은 상대를 깨워야 의미가 있다


def test_보낸_pane_을_모르면_답장_명령을_짓지_않는다():
    assert build_reply_cmd("itl", None) == ""
    assert build_reply_cmd("itl", {"addr": "1.2"}) == ""      # 세션 ID 가 없다


def test_받는_쪽에_itl_이_없으면_답장_명령을_적지_않는다():
    """못 쓰는 명령을 답장 방법이라고 적어 보내면 command not found 를 답장으로 믿는다."""
    assert build_reply_cmd("", {"sessionId": "sess-abc"}) == ""


def test_꼬리표는_한_줄이다():
    """send-keys -l 은 리터럴이라 개행이 그대로 Enter 다 — 윗줄만 먼저 실행된다."""
    origin = format_origin(
        {"addr": "1.2", "sessionId": "s1", "cwd": "/home/u/work"},
        "a1-ubuntu", "itl send s1 '<답장>' --submit",
    )
    assert "\n" not in origin
    assert origin.endswith(" ")


# ── 보내는 쪽에 알리는 문구 ──────────────────────────────────────────────────

@pytest.fixture(scope="module")
def tools():
    return _load_mcp_tools()


def test_답장이_붙었으면_기다리지_말라고_말한다(tools):
    note = tools._reply_note([{"addr": "1.2", "reply": True}])
    assert "1.2" in note
    assert "기다리지" in note


def test_답장이_없으면_확인_방법을_알려준다(tools):
    note = tools._reply_note([{"addr": "1.3", "reply": False}])
    assert "terminal_read" in note
    assert "기다리지" not in note      # 오지 않을 답을 기다리게 하면 안 된다


def test_섞여_있으면_양쪽_다_말한다(tools):
    note = tools._reply_note([
        {"addr": "1.2", "reply": True},
        {"addr": "1.3", "reply": False},
    ])
    assert "1.2" in note and "1.3" in note
    assert "terminal_read" in note


def test_배달이_없으면_할_말도_없다(tools):
    assert tools._reply_note([]) == ""


def test_reply_필드가_없는_옛_백엔드는_답장을_약속하지_않는다(tools):
    """낡은 서버는 이 필드를 안 준다. 없는 것을 참으로 읽으면 거짓말이 된다."""
    note = tools._reply_note([{"addr": "1.2"}])
    assert "기다리지" not in note


# ── 도구 설명이 실제로 안내하는가 ────────────────────────────────────────────

def _desc_block(src: str, name: str) -> str:
    """`NAME = (` 부터 줄 맨 앞의 `)` 까지. 본문에 괄호가 들어 있어도 안전하게 자른다."""
    body = src.split(f"{name} = (", 1)[1]
    return body.split("\n)", 1)[0]


def test_도구_설명이_답장_경로를_안내한다():
    """설명이 없으면 에이전트는 이 경로의 존재 자체를 모른다 — 기능이 있어도 안 쓰인다."""
    path = os.path.join(os.path.dirname(__file__), "..", "cli", "itl_mcp.py")
    src = open(path, encoding="utf-8").read()
    assert "답장" in _desc_block(src, "DESC_SEND")
    # wait/read 는 되묻기 비용을 경고해야 한다
    assert "답장" in _desc_block(src, "DESC_WAIT")
    assert "반복" in _desc_block(src, "DESC_READ")


def test_cli_도_같은_사실을_출력한다():
    """세 곳이 함께 움직인다 — routes/itl.py · cli/itl · cli/itl_mcp_tools.py."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "cli", "itl"), encoding="utf-8").read()
    assert 'd.get("reply")' in src
    assert "답장 경로 전달됨" in src


def test_백엔드가_reply_를_실어_보낸다():
    """이 필드가 사라지면 위의 모든 안내가 조용히 거짓이 된다."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "routes", "itl.py"), encoding="utf-8").read()
    assert '"reply": replyable' in src
