"""텔레그램 Bot API 최소 클라이언트 — 알림 발송과 버튼 콜백 수신.

**왜 웹푸시가 아니라 텔레그램인가:** 알림에 붙는 액션 버튼(`showNotification`의
`actions`)이 iOS 에서는 렌더되지 않는다. 아이폰에서는 "계속" 버튼 자체가 안 보인다.
텔레그램 인라인 키보드는 플랫폼에 상관없이 같게 동작한다.
웹푸시는 그대로 둔다 — 단순 알림은 그쪽이 더 가볍다. 텔레그램은 **버튼이 필요한**
알림을 맡는다.

**왜 webhook 이 아니라 롱폴링인가:** webhook 은 공개 HTTPS 엔드포인트가 필요하고,
그건 이 앱에 외부에서 들어오는 문을 하나 더 여는 일이다. `getUpdates` 롱폴링은
나가는 연결만 쓰므로 NAT/터널 구성에 영향을 주지 않는다.
"""
from __future__ import annotations

import asyncio
import logging

import aiohttp

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
# 롱폴링 대기 시간. 길수록 왕복이 줄지만 종료 반응이 느려진다.
POLL_TIMEOUT_SECONDS = 25
# 개별 요청 상한 — 롱폴링은 timeout 보다 넉넉해야 한다.
REQUEST_TIMEOUT_SECONDS = POLL_TIMEOUT_SECONDS + 15


class TelegramError(RuntimeError):
    """Bot API 호출 실패."""


async def _call(token: str, method: str, payload: dict | None = None,
                timeout: float = 15.0) -> dict:
    url = f"{API_BASE}/bot{token}/{method}"
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as session:
            async with session.post(url, json=payload or {}) as res:
                body = await res.json(content_type=None)
    except asyncio.TimeoutError as e:
        raise TelegramError(f"{method}: 응답 시간 초과") from e
    except aiohttp.ClientError as e:
        raise TelegramError(f"{method}: 연결 실패 ({e})") from e

    if not body.get("ok"):
        # description 을 그대로 올린다 — "chat not found" 같은 메시지가 곧 진단이다.
        raise TelegramError(f"{method}: {body.get('description') or '알 수 없는 오류'}")
    return body.get("result") or {}


async def get_me(token: str) -> dict:
    """토큰 유효성 확인 — 설정 화면의 '연결 테스트'."""
    return await _call(token, "getMe")


# 텔레그램 메시지 본문 상한. 넘기면 400 으로 통째로 실패하므로 보내기 전에 자른다.
MAX_MESSAGE_CHARS = 4000


def _build_keyboard(buttons: list[dict]) -> list[list[dict]]:
    """버튼 목록 → 인라인 키보드 행들.

    버튼은 두 종류다:
      - **URL 버튼** (`{"text", "url"}`) — 잠금화면에서 눌러 웹 터미널을 여는 링크.
        각자 한 행을 통째로 차지하게 둔다(전폭 = 눈에 잘 띔).
      - **콜백 버튼** (`{"text", "callback_data"}`) — 계속/중단 등. 한 행에 모은다.
    URL 버튼을 위에, 콜백 버튼을 아래 한 줄로 배치한다.
    """
    url_rows = [[{"text": b["text"], "url": b["url"]}] for b in buttons if b.get("url")]
    action_row = [
        {"text": b["text"], "callback_data": b["callback_data"]}
        for b in buttons if b.get("callback_data")
    ]
    rows = url_rows + ([action_row] if action_row else [])
    return rows


async def send_message(token: str, chat_id: str, text: str,
                       buttons: list[dict] | None = None) -> dict:
    """메시지 + 인라인 키보드.

    `buttons` 항목은 콜백형 `{"text", "callback_data"}` 또는 링크형 `{"text", "url"}`.
    callback_data 는 텔레그램이 **64바이트로 제한**하므로 짧게 유지해야 한다(액션명 +
    세션ID 로 충분). url 버튼은 눌러도 봇으로 콜백이 오지 않고 브라우저만 연다.
    """
    # ⚠️ parse_mode 를 **켜지 마라.** 본문에는 터미널 화면 발췌가 들어가는데, 거기엔
    # `*` `_` `[` 백틱 같은 문자가 아무렇게나 섞여 있다. 마크다운으로 해석시키면
    # "unclosed entity" 로 전송이 통째로 실패하거나 글자가 사라진다.
    # 평문이면 텔레그램이 그대로 전달한다(한글·이모지·박스문자 포함, 실측 확인).
    if len(text) > MAX_MESSAGE_CHARS:
        text = text[:MAX_MESSAGE_CHARS - 1] + "…"
    payload: dict = {
        "chat_id": chat_id, "text": text, "disable_notification": False,
        # 발췌에 URL 이 섞이면 텔레그램이 큰 링크 프리뷰 카드를 붙인다 — 순수 노이즈다.
        "disable_web_page_preview": True,
    }
    if buttons:
        rows = _build_keyboard(buttons)
        if rows:
            payload["reply_markup"] = {"inline_keyboard": rows}
    return await _call(token, "sendMessage", payload)


async def answer_callback(token: str, callback_id: str, text: str = "") -> None:
    """버튼을 누른 사용자에게 즉시 반응을 준다.

    이걸 안 보내면 텔레그램 클라이언트가 버튼에 로딩 표시를 계속 띄운다 —
    동작은 했는데 안 된 것처럼 보인다.
    """
    try:
        await _call(token, "answerCallbackQuery",
                    {"callback_query_id": callback_id, "text": text[:200]})
    except TelegramError as e:
        logger.debug("answerCallbackQuery 실패: %s", e)


async def get_updates(token: str, offset: int | None = None) -> list[dict]:
    """롱폴링. `offset` 은 '이 id 이전은 처리했다'는 확인 응답을 겸한다."""
    # callback_query(버튼) + message(직접 입력) 둘 다 받는다.
    payload: dict = {"timeout": POLL_TIMEOUT_SECONDS,
                     "allowed_updates": ["callback_query", "message"]}
    if offset is not None:
        payload["offset"] = offset
    result = await _call(token, "getUpdates", payload, timeout=REQUEST_TIMEOUT_SECONDS)
    return result if isinstance(result, list) else []


async def discover_chats(token: str) -> list[dict]:
    """봇에게 말을 건 대화방 목록 — chat ID 를 알아내는 유일한 실용적 방법이다.

    평소 롱폴링은 `callback_query` 만 받는다(잡음을 줄이려고). 그래서 사용자가 봇에게
    보낸 메시지는 거기 안 잡힌다. 이 함수만 `message` 를 열어 한 번 훑는다.

    ⚠️ offset 을 보내지 않는다 — 확인 응답을 하면 그 업데이트가 사라져서 다시
    누르면 아무것도 안 나온다. 여기서는 읽기만 하고 소비하지 않는다.
    """
    result = await _call(token, "getUpdates",
                         {"timeout": 0, "allowed_updates": ["message"]}, timeout=15)
    chats: dict[str, dict] = {}
    for update in result if isinstance(result, list) else []:
        chat = ((update.get("message") or {}).get("chat") or {})
        chat_id = chat.get("id")
        if chat_id is None:
            continue
        name = chat.get("title") or " ".join(
            v for v in (chat.get("first_name"), chat.get("last_name")) if v
        ) or chat.get("username") or ""
        chats[str(chat_id)] = {"chat_id": str(chat_id), "name": name, "type": chat.get("type") or ""}
    return list(chats.values())
