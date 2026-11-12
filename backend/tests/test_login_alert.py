"""Login notice + logout buttons. Telegram is replaced by an httpx MockTransport."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

import login_alert
from login_alert import LoginAlert, describe_user_agent

CHAT = "12345"


class FakeTelegram:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.updates: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content or b"{}")
        self.calls.append((method, body))
        if method == "getUpdates":
            result, self.updates = self.updates, []
            return httpx.Response(200, json={"ok": True, "result": result})
        return httpx.Response(200, json={"ok": True, "result": {}})

    def methods(self) -> list[str]:
        return [m for m, _ in self.calls]


def make(fake: FakeTelegram, *, token="tok", chat=CHAT):
    revoked: list[str] = []
    everyone: list[bool] = []

    async def logout_session(sid):
        revoked.append(sid)
        return sid == "live"

    async def logout_all():
        everyone.append(True)

    alert = LoginAlert(token, chat, logout_session=logout_session, logout_all=logout_all,
                       transport=httpx.MockTransport(fake.handler))
    return alert, revoked, everyone


def press(data: str, chat=CHAT) -> dict:
    return {"update_id": 7, "callback_query": {
        "id": "q1", "data": data,
        "message": {"message_id": 3, "text": "notice", "chat": {"id": int(chat)}},
    }}


async def test_로그인하면_IP와_기기와_끊기_버튼을_보낸다():
    fake = FakeTelegram()
    alert, *_ = make(fake)
    alert.notify(session_id="sid-1", method="패스키", ip="1.2.3.4",
                 user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
    await asyncio.gather(*alert._pending)

    method, body = fake.calls[0]
    assert method == "sendMessage"
    assert body["chat_id"] == CHAT
    assert "1.2.3.4" in body["text"] and "iPhone · Safari" in body["text"] and "패스키" in body["text"]
    buttons = body["reply_markup"]["inline_keyboard"][0]
    assert [b["callback_data"] for b in buttons] == ["s:sid-1", "a"]


async def test_토큰이나_채팅이_없으면_아무것도_안_한다():
    fake = FakeTelegram()
    alert, *_ = make(fake, token="")
    alert.notify(session_id="s", method="m", ip="i", user_agent="")
    alert.start()
    assert not alert.enabled and alert._task is None and fake.calls == []


async def test_전송이_실패해도_예외가_새지_않는다():
    def boom(_request):
        raise httpx.ConnectError("down")
    alert = LoginAlert("tok", CHAT, logout_session=None, logout_all=None,
                       transport=httpx.MockTransport(boom))
    alert.notify(session_id="s", method="m", ip="i", user_agent="")
    await asyncio.gather(*alert._pending)   # would raise if the error escaped


async def test_이_로그인_끊기_버튼은_그_세션만_끊고_메시지를_고친다():
    fake = FakeTelegram()
    alert, revoked, everyone = make(fake)
    fake.updates = [press("s:live")]
    await alert.poll_once()

    assert revoked == ["live"] and everyone == []
    assert fake.methods() == ["getUpdates", "answerCallbackQuery", "editMessageText"]
    assert "끊었습니다" in fake.calls[2][1]["text"]
    assert alert._offset == 8                 # the update is acknowledged, not replayed


async def test_전체_로그아웃_버튼():
    fake = FakeTelegram()
    alert, revoked, everyone = make(fake)
    await alert.handle_update(press("a"))
    assert everyone == [True] and revoked == []


async def test_다른_채팅에서_누른_버튼은_무시한다():
    fake = FakeTelegram()
    alert, revoked, everyone = make(fake)
    await alert.handle_update(press("a", chat="999"))
    assert everyone == [] and revoked == []
    assert fake.methods() == ["answerCallbackQuery"]


@pytest.mark.parametrize("ua,label", [
    ("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36", "Android · Chrome"),
    ("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130", "Windows · Edge"),
    ("", "알 수 없는 기기"),
])
def test_기기_이름(ua, label):
    assert describe_user_agent(ua) == label


def test_LOGIN_ALERT_0_이면_꺼진다(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", CHAT)
    monkeypatch.setenv("LOGIN_ALERT", "0")
    assert not login_alert.from_env(logout_session=None, logout_all=None).enabled


async def test_empty_poll_timeout_reports_exception_type(monkeypatch, caplog):
    def timeout(_request):
        raise httpx.ReadTimeout('')

    async def stop_after_backoff(_delay):
        raise asyncio.CancelledError

    alert = LoginAlert('test-token', CHAT, logout_session=None, logout_all=None,
                       transport=httpx.MockTransport(timeout))
    monkeypatch.setattr(login_alert.asyncio, 'sleep', stop_after_backoff)
    with caplog.at_level('WARNING', logger='login_alert'), pytest.raises(asyncio.CancelledError):
        await alert._loop()
    assert any(record.args[1] == 'ReadTimeout' for record in caplog.records if record.name == 'login_alert')
