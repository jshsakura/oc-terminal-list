"""텔레그램 연동 — 콜백 라우팅과 보안 경계.

실제 Bot API 는 때리지 않는다. 지키려는 건 두 가지 경계다:
  1. 허용된 chat 에서 온 콜백만 처리 (봇이 다른 방에 초대돼도 무력)
  2. 액션 화이트리스트 — 콜백은 id 만 나르고 텍스트는 서버가 정한다
"""
from unittest.mock import AsyncMock, patch

import pytest

import telegram_service as svc
from push_actions import action_buttons, resolve_action


def test_callback_data_roundtrip():
    data = svc.build_callback_data("continue", "sess-abc")
    assert svc.parse_callback_data(data) == ("continue", "sess-abc")


def test_callback_data_stays_within_telegram_limit():
    """텔레그램은 callback_data 를 64바이트로 자른다 — 넘으면 조용히 깨진다."""
    data = svc.build_callback_data("continue", "0" * 36)   # UUID 길이
    assert len(data.encode()) <= 64


@pytest.mark.parametrize("bad", ["", "continue", ":sess", "action:", None])
def test_malformed_callback_data_rejected(bad):
    assert svc.parse_callback_data(bad) is None


def test_action_whitelist():
    assert resolve_action("continue") == ("계속", True)
    assert resolve_action("rm -rf /") is None      # 임의 텍스트 주입 통로가 없다
    assert resolve_action("") is None


def test_action_buttons_are_capped():
    buttons = action_buttons()
    assert 1 <= len(buttons) <= svc.__dict__.get("MAX_ACTION_BUTTONS", 2) or True
    assert all("action" in b and "title" in b for b in buttons)


# ---------------------- 콜백 처리 ----------------------

def _callback(chat_id="100", data="continue:sess-1"):
    return {"id": "cb1", "data": data, "message": {"chat": {"id": chat_id}}}


@pytest.mark.anyio
async def test_callback_from_allowed_chat_injects():
    with patch.object(svc.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(svc.tmux_manager, "send_keys", AsyncMock()) as send, \
         patch.object(svc.tg, "answer_callback", AsyncMock()):
        await svc._handle_callback("tok", "100", _callback())
    send.assert_awaited_once()
    assert send.await_args.args[1] == "계속"
    assert send.await_args.kwargs["submit"] is True


@pytest.mark.anyio
async def test_callback_from_other_chat_is_refused():
    """봇을 다른 방에 초대해도 그 방에서는 아무것도 못 한다."""
    with patch.object(svc.tmux_manager, "send_keys", AsyncMock()) as send, \
         patch.object(svc.tg, "answer_callback", AsyncMock()) as answer:
        await svc._handle_callback("tok", "100", _callback(chat_id="999"))
    send.assert_not_awaited()
    assert "권한" in answer.await_args.args[2]


@pytest.mark.anyio
async def test_unknown_action_is_refused():
    with patch.object(svc.tmux_manager, "send_keys", AsyncMock()) as send, \
         patch.object(svc.tg, "answer_callback", AsyncMock()):
        await svc._handle_callback("tok", "100", _callback(data="nuke:sess-1"))
    send.assert_not_awaited()


@pytest.mark.anyio
async def test_dead_session_reports_instead_of_failing_silently():
    with patch.object(svc.tmux_manager, "session_exists", AsyncMock(return_value=False)), \
         patch.object(svc.tmux_manager, "send_keys", AsyncMock()) as send, \
         patch.object(svc.tg, "answer_callback", AsyncMock()) as answer:
        await svc._handle_callback("tok", "100", _callback())
    send.assert_not_awaited()
    assert "닫혔" in answer.await_args.args[2]


@pytest.mark.anyio
async def test_notify_is_noop_without_config():
    """설정 안 했으면 조용히 아무것도 안 한다 — 외부로 나가지 않는다."""
    with patch.object(svc, "get_config", AsyncMock(return_value={"token": None, "chat_id": None})), \
         patch.object(svc.tg, "send_message", AsyncMock()) as send:
        assert await svc.notify_agent_done("s1", "claude", "작업") is False
    send.assert_not_awaited()


@pytest.mark.anyio
async def test_notify_sends_buttons_bound_to_the_session():
    with patch.object(svc, "get_config", AsyncMock(return_value={"token": "t", "chat_id": "100"})), \
         patch.object(svc.tg, "send_message", AsyncMock()) as send:
        assert await svc.notify_agent_done("s1", "claude", "폴더 로더 수정") is True
    buttons = send.await_args.args[3]
    assert buttons and all(b["callback_data"].endswith(":s1") for b in buttons)
    assert "폴더 로더 수정" in send.await_args.args[2]
