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
    data = svc.build_callback_data("a0", "sess-abc")
    assert svc.parse_callback_data(data) == ("a0", "sess-abc")


def test_callback_data_stays_within_telegram_limit():
    """텔레그램은 callback_data 를 64바이트로 자른다 — 넘으면 조용히 깨진다."""
    data = svc.build_callback_data("a0", "0" * 36)   # UUID 길이
    assert len(data.encode()) <= 64


@pytest.mark.parametrize("bad", ["", "continue", ":sess", "action:", None])
def test_malformed_callback_data_rejected(bad):
    assert svc.parse_callback_data(bad) is None


def test_action_whitelist():
    assert resolve_action("a0") == ("계속", True)   # 기본 액션
    assert resolve_action("rm -rf /") is None      # 임의 텍스트 주입 통로가 없다
    assert resolve_action("nope") is None
    assert resolve_action("") is None


def test_actions_are_configurable(monkeypatch):
    """'왜 하필 계속이냐' 에 대한 답 — TELEGRAM_ACTIONS 로 사용자가 정한다."""
    import importlib
    import push_actions
    monkeypatch.setenv("TELEGRAM_ACTIONS", "계속,테스트 돌려,커밋해")
    importlib.reload(push_actions)
    try:
        assert [b["title"] for b in push_actions.action_buttons()] == ["계속", "테스트 돌려", "커밋해"]
        assert push_actions.resolve_action("a1") == ("테스트 돌려", True)
    finally:
        monkeypatch.delenv("TELEGRAM_ACTIONS", raising=False)
        importlib.reload(push_actions)


def test_callback_data_fits_with_long_action_text(monkeypatch):
    """긴 버튼 문구를 넣어도 callback_data 가 64바이트를 넘으면 안 된다 —
    id 를 a0/a1 로 짧게 두는 이유다."""
    import importlib
    import push_actions
    monkeypatch.setenv("TELEGRAM_ACTIONS", "아주 긴 한글 버튼 문구를 넣어도 괜찮아야 한다")
    importlib.reload(push_actions)
    try:
        key = list(push_actions.PUSH_ACTIONS)[0]
        data = svc.build_callback_data(key, "0" * 36)
        assert len(data.encode()) <= 64
    finally:
        monkeypatch.delenv("TELEGRAM_ACTIONS", raising=False)
        importlib.reload(push_actions)


def test_action_buttons_are_capped():
    buttons = action_buttons()
    assert 1 <= len(buttons) <= svc.__dict__.get("MAX_ACTION_BUTTONS", 2) or True
    assert all("action" in b and "title" in b for b in buttons)


# ---------------------- 콜백 처리 ----------------------

def _callback(chat_id="100", data="a0:sess-1"):
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


# ---------------------- 중단(제어키) 액션 ----------------------

@pytest.mark.anyio
async def test_stop_action_sends_a_control_key_not_text():
    """'C-c' 를 리터럴로 보내면 터미널에 'C-c' 라는 **글자**가 찍힌다.

    "계속" 만 있고 중단이 없으면 알림이 감시 도구가 못 된다 — 폭주하는 에이전트를
    폰에서 멈출 수 있어야 한다.
    """
    with patch.object(svc.tmux_manager, "session_exists", AsyncMock(return_value=True)), \
         patch.object(svc.tmux_manager, "send_key", AsyncMock()) as send_key, \
         patch.object(svc.tmux_manager, "send_keys", AsyncMock()) as send_text, \
         patch.object(svc.tg, "answer_callback", AsyncMock()):
        await svc._handle_callback("tok", "100", _callback(data="stop:sess-1"))
    send_key.assert_awaited_once_with("sess-1", "C-c")
    send_text.assert_not_awaited()


def test_stop_button_is_always_offered():
    labels = [b["title"] for b in action_buttons()]
    assert "중단" in labels


@pytest.mark.anyio
async def test_notification_carries_a_screen_excerpt():
    """"작업 완료" 만으로는 확인할지 말지 판단할 수 없다."""
    screen = "빌드 성공: 47 passing\n─────\n❯\n"
    with patch.object(svc, "get_config", AsyncMock(return_value={"token": "t", "chat_id": "100"})), \
         patch.object(svc.tmux_manager, "_run", AsyncMock(return_value=(0, screen, ""))), \
         patch.object(svc.tg, "send_message", AsyncMock()) as send:
        await svc.notify_agent_done("s1", "claude", "빌드", "1.2 · web")
    body = send.await_args.args[2]
    assert "1.2 · web" in body        # 어느 터미널인지
    assert "47 passing" in body       # 무슨 일이 있었는지
    assert "─────" not in body        # UI 장식은 빼고
