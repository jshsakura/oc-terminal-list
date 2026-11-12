"""Telegram notice on every login, with buttons that log that session (or all) out.

Opt-in: runs only when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are both set, and
LOGIN_ALERT=0 turns it off. Button presses are read by long polling getUpdates, so no
public webhook is needed (the app sits behind Cloudflare Access).

Login must never wait on or fail because of Telegram: notices are fire-and-forget and
every error is logged and swallowed here.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
LONG_POLL_SEC = 50
SEND_TIMEOUT_SEC = 10
ERROR_BACKOFF_SEC = 30
# Callback data is capped at 64 bytes by Telegram; "s:" + a 43-char session id fits.
LOGOUT_SESSION_PREFIX = "s:"
LOGOUT_ALL = "a"

LogoutSession = Callable[[str], Awaitable[bool]]
LogoutAll = Callable[[], Awaitable[None]]


def describe_user_agent(user_agent: str) -> str:
    """Short device label; the raw header is too long to read on a phone."""
    ua = user_agent or ""
    device = next((name for key, name in (
        ("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"),
        ("Windows", "Windows"), ("Macintosh", "Mac"), ("Linux", "Linux"),
    ) if key in ua), "알 수 없는 기기")
    browser = next((name for key, name in (
        ("Edg/", "Edge"), ("SamsungBrowser", "Samsung Internet"), ("Firefox/", "Firefox"),
        ("CriOS", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari"),
    ) if key in ua), "")
    return f"{device} · {browser}" if browser else device


def build_notice(*, method: str, ip: str, user_agent: str, at: float) -> str:
    stamp = datetime.fromtimestamp(at).strftime("%Y-%m-%d %H:%M:%S")
    return (
        "🔐 Terminal List 로그인\n"
        f"방법: {method}\n"
        f"IP: {ip}\n"
        f"기기: {describe_user_agent(user_agent)}\n"
        f"시각: {stamp}\n\n"
        "본인이 아니면 아래 버튼으로 끊으세요."
    )


def logout_keyboard(session_id: str) -> dict:
    return {"inline_keyboard": [[
        {"text": "이 로그인 끊기", "callback_data": f"{LOGOUT_SESSION_PREFIX}{session_id}"},
        {"text": "전체 로그아웃", "callback_data": LOGOUT_ALL},
    ]]}


class LoginAlert:
    def __init__(self, token: str, chat_id: str, *, logout_session: LogoutSession,
                 logout_all: LogoutAll, transport: httpx.AsyncBaseTransport | None = None):
        self._token = token
        self._chat_id = str(chat_id)
        self._logout_session = logout_session
        self._logout_all = logout_all
        self._transport = transport
        self._task: asyncio.Task | None = None
        self._pending: set[asyncio.Task] = set()
        self._offset = 0

    @property
    def enabled(self) -> bool:
        return bool(self._token and self._chat_id)

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self._transport)

    async def _call(self, method: str, payload: dict, timeout: float = SEND_TIMEOUT_SEC) -> dict:
        async with self._client(timeout) as client:
            res = await client.post(f"{API_BASE}/bot{self._token}/{method}", json=payload)
        body = res.json()
        if not body.get("ok"):
            raise RuntimeError(f"{method}: {body.get('description', res.status_code)}")
        return body

    # ---------------------------------------------------------------- notice

    def notify(self, *, session_id: str, method: str, ip: str, user_agent: str) -> None:
        if not self.enabled:
            return
        task = asyncio.create_task(self._send(session_id, method, ip, user_agent))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _send(self, session_id: str, method: str, ip: str, user_agent: str) -> None:
        try:
            await self._call("sendMessage", {
                "chat_id": self._chat_id,
                "text": build_notice(method=method, ip=ip, user_agent=user_agent, at=time.time()),
                "reply_markup": logout_keyboard(session_id),
            })
        except Exception as exc:  # noqa: BLE001 - a lost notice must not break login
            logger.warning("login alert send failed: %s", exc)

    # --------------------------------------------------------------- buttons

    async def handle_update(self, update: dict) -> None:
        query = update.get("callback_query")
        if not query:
            return
        message = query.get("message") or {}
        chat_id = str((message.get("chat") or {}).get("id", ""))
        if chat_id != self._chat_id:
            # Anyone can press a forwarded button; only the configured chat may act.
            logger.warning("login alert button from unexpected chat %s ignored", chat_id)
            await self._answer(query, "권한이 없습니다")
            return

        data = query.get("data") or ""
        if data == LOGOUT_ALL:
            await self._logout_all()
            result = "전체 로그아웃했습니다. 다시 로그인해야 합니다."
        elif data.startswith(LOGOUT_SESSION_PREFIX):
            found = await self._logout_session(data[len(LOGOUT_SESSION_PREFIX):])
            result = "이 로그인을 끊었습니다." if found else "이미 끝난 로그인입니다."
        else:
            await self._answer(query, "알 수 없는 버튼입니다")
            return
        logger.warning("login alert: %s (%s)", result, data[:2])
        await self._answer(query, result)
        await self._mark_done(message, result)

    async def _answer(self, query: dict, text: str) -> None:
        try:
            await self._call("answerCallbackQuery", {"callback_query_id": query.get("id"), "text": text})
        except Exception as exc:  # noqa: BLE001
            logger.warning("login alert answer failed: %s", exc)

    async def _mark_done(self, message: dict, result: str) -> None:
        try:
            await self._call("editMessageText", {
                "chat_id": self._chat_id,
                "message_id": message.get("message_id"),
                "text": f"{message.get('text', '')}\n\n✅ {result}",
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("login alert edit failed: %s", exc)

    # ---------------------------------------------------------------- polling

    async def poll_once(self) -> None:
        body = await self._call(
            "getUpdates",
            {"offset": self._offset, "timeout": LONG_POLL_SEC, "allowed_updates": ["callback_query"]},
            timeout=LONG_POLL_SEC + 10,
        )
        for update in body.get("result", []):
            self._offset = max(self._offset, int(update.get("update_id", 0)) + 1)
            try:
                await self.handle_update(update)
            except Exception:  # noqa: BLE001 - one bad update must not stop the loop
                logger.exception("login alert update failed")

    async def _loop(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("login alert polling failed, retrying in %ss: %s: %s",
                               ERROR_BACKOFF_SEC, type(exc).__name__, exc)
                await asyncio.sleep(ERROR_BACKOFF_SEC)

    def start(self) -> None:
        if self.enabled and (self._task is None or self._task.done()):
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        tasks = [t for t in (self._task, *self._pending) if t is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None


def from_env(*, logout_session: LogoutSession, logout_all: LogoutAll) -> LoginAlert:
    off = os.getenv("LOGIN_ALERT", "1").strip() == "0"
    return LoginAlert(
        "" if off else os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        os.getenv("TELEGRAM_CHAT_ID", "").strip(),
        logout_session=logout_session,
        logout_all=logout_all,
    )
