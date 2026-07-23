"""텔레그램 연동 — 에이전트 알림을 보내고, 버튼 응답을 터미널로 되돌린다.

흐름:
  워처가 완료/허락대기 감지
    → 텔레그램으로 [계속] 버튼이 달린 메시지
    → 잠금화면에서 버튼 탭
    → 롱폴링 워커가 callback_query 수신
    → 그 pane 으로 텍스트 주입

보안 전제 두 가지:

1. **chat_id 허용목록.** 봇이 들어가 있는 방이면 누구나 버튼을 누를 수 있다.
   설정에 저장된 chat_id 에서 온 콜백만 처리한다.
2. **액션 화이트리스트.** 콜백은 액션 id 만 나르고, 실제 텍스트는 서버(push_actions)
   가 정한다. 임의 문자열이 터미널로 들어가는 통로를 만들지 않는다.

그리고 이건 **나가는 데이터**다 — pane 타이틀(작업 내용)이 텔레그램 서버를 지난다.
설정에서 켠 사용자만 동작한다.
"""
from __future__ import annotations

import asyncio
import logging
import os

import telegram_client as tg
from itl_targets import build_targets, resolve
from notify_message import build_done_message
from pane_excerpt import extract_excerpt
from telegram_command import parse_command
from push_actions import action_buttons, resolve_action, resolve_key_action
from sqlite_storage import storage
from tmux_manager import tmux_manager
from vault import decrypt_str, encrypt_str

logger = logging.getLogger(__name__)

CONFIG_TOKEN_KEY = "telegram_bot_token_enc"
CONFIG_CHAT_KEY = "telegram_chat_id"

# 폴링이 실패했을 때의 재시도 간격 — 토큰이 잘못됐거나 네트워크가 끊긴 상황에서
# 초당 수십 번 두드리지 않도록.
RETRY_BACKOFF_SECONDS = 15
# callback_data 는 텔레그램이 64바이트로 자른다. "action:session" 형태를 쓴다.
CALLBACK_SEPARATOR = ":"
# 한 메시지가 한 번에 칠 수 있는 pane 수 상한 — @all 오타로 전 터미널에 명령이
# 박히는 걸 막는다(itl send 와 같은 이유).
MAX_MESSAGE_FANOUT = 20


async def get_config() -> dict:
    """봇 토큰과 chat ID.

    **env 가 DB 를 이긴다.** `.env` 에 넣어두면 설정 화면에서 다시 입력할 필요가 없고,
    백업/이관 시 DB 에 비밀이 실려 나가지 않는다. env 가 없을 때만 DB 값을 쓴다.
    """
    env_token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    env_chat = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()

    token = env_token or None
    if not token:
        token_enc = await storage.get_config(CONFIG_TOKEN_KEY)
        token = decrypt_str(token_enc) if token_enc else None

    chat_id = env_chat or None
    if not chat_id:
        chat_id = (await storage.get_config(CONFIG_CHAT_KEY)) or None

    return {"token": token, "chat_id": chat_id, "from_env": bool(env_token)}


async def save_config(token: str | None, chat_id: str | None) -> None:
    """토큰은 SSH 키와 같은 방식으로 vault 암호화해 저장한다."""
    await storage.set_config(CONFIG_TOKEN_KEY, encrypt_str(token) if token else "")
    await storage.set_config(CONFIG_CHAT_KEY, chat_id or "")


async def is_enabled() -> bool:
    config = await get_config()
    return bool(config["token"] and config["chat_id"])


def build_callback_data(action: str, session_id: str) -> str:
    return f"{action}{CALLBACK_SEPARATOR}{session_id}"


def parse_callback_data(data: str) -> tuple[str, str] | None:
    action, sep, session_id = (data or "").partition(CALLBACK_SEPARATOR)
    if not sep or not action or not session_id:
        return None
    return action, session_id


async def notify_agent_done(session_id: str, command: str, title: str,
                            label: str = "", *, duration_seconds: float | None = None,
                            described: dict | None = None, others: str = "",
                            excerpt: str | None = None) -> bool:
    """완료 알림 + 액션 버튼. 설정이 없으면 조용히 no-op.

    있는 정보는 다 담는다 — 주소·에이전트·소요시간·호스트·경로·작업내용·화면 발췌·
    다른 터미널 상태. 알림 하나로 "지금 봐야 하나" 를 판단할 수 있어야 한다.
    """
    config = await get_config()
    if not (config["token"] and config["chat_id"]):
        return False

    described = described or {}
    # 발췌는 호출부에서 한 번 뽑아 넘겨준다(지문 계산과 공유). 없으면 여기서 뽑는다.
    if excerpt is None:
        try:
            _rc, pane_text, _err = await tmux_manager._run(
                "capture-pane", "-p", "-t", f"={session_id}:", check=False,
            )
            excerpt = extract_excerpt(pane_text)
        except Exception as e:
            logger.debug("발췌 실패 (%s): %s", session_id, e)
            excerpt = ""

    body = build_done_message(
        label=label, command=command, title=title,
        cwd=described.get("cwd", ""), host=described.get("host", ""),
        duration_seconds=duration_seconds, excerpt=excerpt, others=others,
    )
    buttons = [
        {"text": b["title"], "callback_data": build_callback_data(b["action"], session_id)}
        for b in action_buttons()
    ]
    try:
        await tg.send_message(config["token"], config["chat_id"], body, buttons)
        return True
    except tg.TelegramError as e:
        logger.warning("텔레그램 알림 실패 (%s): %s", session_id, e)
        return False


async def _handle_message(token: str, allowed_chat: str, message: dict) -> None:
    """폰에서 친 자유 텍스트를 주소가 가리키는 pane 으로 보낸다.

    ⚠️ 임의 문자열이 터미널로 들어간다. 유일한 방벽은 chat_id 가드다 — 설정된
    방에서 온 게 아니면 즉시 버린다. 봇을 다른 방에 초대해도 무력.
    """
    chat_id = str((message.get("chat") or {}).get("id") or "")
    if chat_id != str(allowed_chat):
        logger.warning("텔레그램: 허용되지 않은 chat 의 메시지 무시 (%s)", chat_id)
        return

    text = message.get("text") or ""
    parsed = parse_command(text)
    if not parsed:
        # 주소 없는 메시지 — 봇에게 그냥 말을 건 것일 수 있다. 사용법만 조용히 안내.
        if text.strip():
            await tg.send_message(
                token, allowed_chat,
                "보낼 곳을 앞에 붙여주세요:\n  1.1 <내용>  ·  @claude <내용>  ·  @all <내용>\n"
                "여는 터미널 목록은 앱의 알림에 붙는 주소(예: 1.1)를 쓰면 됩니다.",
            )
        return

    address, body = parsed
    # 이 앱은 단일 사용자(admin) 다. 텔레그램에는 사용자 개념이 없으므로 탭 상태는
    # admin 것을 본다 — chat_id 가드가 이미 "이 방 = 소유자" 를 보장한다.
    admin = await storage.get_admin()
    if not admin:
        return
    state = await storage.get_tab_state(admin["username"]) or {}
    targets = resolve(build_targets(state.get("tabs") or []), address)
    if not targets:
        await tg.send_message(token, allowed_chat, f"'{address}' 에 해당하는 터미널이 없습니다.")
        return

    delivered, skipped = [], []
    for target in targets[:MAX_MESSAGE_FANOUT]:
        session_id = target.get("sessionId")
        if not session_id:
            skipped.append(target["addr"])          # 원격 pane — 아직 미지원
            continue
        if not await tmux_manager.session_exists(session_id):
            skipped.append(target["addr"])
            continue
        # 폰에서 한 줄 보내는 건 "실행해" 라는 뜻 — 엔터까지 친다.
        await tmux_manager.send_keys(session_id, body, submit=True)
        delivered.append(target["addr"])

    parts = []
    if delivered:
        parts.append(f"→ {', '.join(delivered)} 전송")
    if skipped:
        parts.append(f"건너뜀: {', '.join(skipped)}")
    await tg.send_message(token, allowed_chat, " · ".join(parts) or "보낼 대상이 없습니다.")
    logger.info("텔레그램 직접입력 '%s' → %s", address, delivered)


async def _handle_callback(token: str, allowed_chat: str, callback: dict) -> None:
    callback_id = callback.get("id") or ""
    chat_id = str(((callback.get("message") or {}).get("chat") or {}).get("id") or "")
    if chat_id != str(allowed_chat):
        # 봇이 다른 방에 초대돼도 그 방에서는 아무것도 못 하게 한다.
        logger.warning("텔레그램: 허용되지 않은 chat 에서 온 콜백 (%s)", chat_id)
        await tg.answer_callback(token, callback_id, "권한이 없습니다")
        return

    parsed = parse_callback_data(callback.get("data") or "")
    if not parsed:
        await tg.answer_callback(token, callback_id, "알 수 없는 요청")
        return
    action, session_id = parsed

    key = resolve_key_action(action)
    resolved = resolve_action(action)
    if not key and not resolved:
        await tg.answer_callback(token, callback_id, "알 수 없는 동작")
        return

    if not await tmux_manager.session_exists(session_id):
        await tg.answer_callback(token, callback_id, "터미널이 이미 닫혔습니다")
        return

    if key:
        # 제어키는 리터럴로 보내면 "C-c" 라는 글자가 입력된다 — 별도 경로.
        await tmux_manager.send_key(session_id, key)
        await tg.answer_callback(token, callback_id, "중단 신호를 보냈습니다")
    else:
        text, submit = resolved
        await tmux_manager.send_keys(session_id, text, submit=submit)
        await tg.answer_callback(token, callback_id, f"보냈습니다: {text}")
    logger.info("텔레그램 액션 '%s' → session=%s", action, session_id)


class TelegramWorker:
    """콜백 롱폴링 루프. 설정이 없으면 붙었다 떨어지길 반복하지 않고 그냥 쉰다."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._offset: int | None = None

    async def _loop(self) -> None:
        while True:
            try:
                config = await get_config()
                token, chat_id = config["token"], config["chat_id"]
                if not (token and chat_id):
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS)
                    continue
                updates = await tg.get_updates(token, self._offset)
                for update in updates:
                    self._offset = int(update.get("update_id", 0)) + 1
                    if update.get("callback_query"):
                        await _handle_callback(token, chat_id, update["callback_query"])
                    elif update.get("message"):
                        await _handle_message(token, chat_id, update["message"])
            except asyncio.CancelledError:
                raise
            except tg.TelegramError as e:
                logger.warning("텔레그램 폴링 실패: %s", e)
                await asyncio.sleep(RETRY_BACKOFF_SECONDS)
            except Exception as e:
                logger.warning("텔레그램 폴링 예외: %s", e)
                await asyncio.sleep(RETRY_BACKOFF_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None


telegram_worker = TelegramWorker()
