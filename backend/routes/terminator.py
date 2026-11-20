"""Terminator: the in-app help companion. It answers "how do I…?" from the guide and
shows where things are. It never acts on its own: it explains, points at the button and
offers that button for the person to press.

This is the one place the backend calls an LLM, and on purpose a narrow one: a GLM model
(glm-5.3-flash unless the settings screen says otherwise) over the Z.ai coding plan, help
text only, no tools that touch files, shells or other terminals. Everything else in the app still keeps the
"backend calls no LLM" rule.

Kept light on purpose:
  - one request per message, and no tool definitions: declaring even one tool took a reply
    from 2.6s to 6s. The model instead ends its answer with short tags
    (`@offer:settings,hosts`, `@point:settings`) that read_reply parses, checks against the
    allowed ids and strips. An `@do` the model still writes becomes an offer: the person asked
    to be shown how, and a pane split they did not press is a surprise, not help.
  - no session process. The conversation lives in memory, last HISTORY_MESSAGES only, so a
    request never carries more than the guide plus a few short turns.
  - thinking off: help answers do not need it, and it was 3x the latency.

  GET  /api/terminator/status    is a key configured? which model?
  GET  /api/terminator/messages  the conversation so far
  POST /api/terminator/say       ask; returns the reply, the buttons to offer and what to point at
  POST /api/terminator/reset     start over
  GET  /api/terminator/config    key set? its last 4 chars, the model (terminator_config.py)
  PUT  /api/terminator/config    set or clear the key, set the model
  POST /api/terminator/check     one tiny request: does this key and model answer?
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from collections import deque
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import terminator_config
from _deps import verify_auth_token

logger = logging.getLogger(__name__)
router = APIRouter()

API_URL = "https://api.z.ai/api/anthropic/v1/messages"
MAX_TOKENS = 700
REQUEST_TIMEOUT_SEC = 40.0
CHECK_TIMEOUT_SEC = 20.0
HISTORY_MESSAGES = 6          # what the model sees again; older turns are only on screen
SHOWN_MESSAGES = 40           # what the panel keeps showing
MAX_SAY_CHARS = 1000
RATE_WINDOW_SEC = 60.0
RATE_MAX = 20
GUIDE_PATH = Path(__file__).resolve().parents[1] / "terminator_guide.md"

# Things a button in the UI does. The frontend's utils/uiActions.js lists the same ids
# (a test keeps them equal); they are only ever offered, the person presses them.
UI_ACTIONS = (
    "new-tab", "split-right", "split-down", "quick-input", "command-palette",
    "settings", "settings-mobile", "hosts", "home",
)
_GUIDE_ID_RE = re.compile(r"`([a-z0-9][a-z0-9-]*)`")
_TAG_RE = re.compile(r"@(do|offer|point)\s*:\s*([a-z0-9][a-z0-9,\s-]*)")
# Removal is wider than parsing: a malformed tag is ignored but must not show as text.
_TAG_STRIP_RE = re.compile(r"@(?:do|offer|point)\s*:[^\n]*")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

PERSONA = """You are Terminator, the help companion inside Terminal List, a terminal in the browser.
You only help people use this app's screen. You never do things for them: you explain how,
show where the button is and offer it. You do not write code, run commands or change files;
if asked, say that is work for a terminal agent.

Voice: answer in the person's language; in Korean always 합니다체. Two or three short sentences
or a few short steps. No em dashes. You may greet once per conversation with
"인간 시대의 끝이 도래했습니다. …농담입니다." and never more.

Answer only from the GUIDE below. Never invent buttons, menus or settings. If the guide does
not cover it, say you do not know.

Always write at least one sentence. Even when asked to do something ("터미널 열어줘",
"아래로 나눠줘"), tell them how to do it: which button, where, or the shortcut. Never say it is
done, and do not say you cannot do it; just explain, the offered button is right below.
End sentences with 합니다/됩니다, never 하세요. Then, on the last line, add screen tags when they help:
- @point:<id>  the button you described, when it is in 화면 안내 대상.
- @offer:<action>,<action>  up to 3 buttons the person can press to do what you explained.
Actions: {actions}. Write tags only on that last line, never inside sentences."""

_history: dict[str, deque] = {}
_shown: dict[str, deque] = {}
_calls: dict[str, deque] = {}


def _key() -> str | None:
    return terminator_config.read_key()


def _guide() -> str:
    return GUIDE_PATH.read_text(encoding="utf-8")


def guide_ids(guide: str) -> list[str]:
    section = guide.split("## 화면 안내 대상", 1)[1] if "## 화면 안내 대상" in guide else ""
    return _GUIDE_ID_RE.findall(section)


def read_reply(data: dict, point_ids: list[str]) -> dict:
    """The model's reply -> {text, did, offer, point}. Tags are read, checked against the
    allowed ids and removed from the text; anything unknown is dropped."""
    raw = "".join(str(b.get("text") or "") for b in data.get("content") or []
                  if isinstance(b, dict) and b.get("type") == "text")
    offer, point = [], None
    for kind, value in _TAG_RE.findall(raw):
        ids = [v.strip() for v in value.split(",") if v.strip()]
        if kind in ("do", "offer"):     # nothing runs by itself; a `do` is offered too
            offer += [i for i in ids if i in UI_ACTIONS and i not in offer]
        elif kind == "point" and ids and ids[0] in point_ids:
            point = ids[0]
    text = re.sub(r"\n{3,}", "\n\n", _TAG_STRIP_RE.sub("", raw)).strip()
    return {"text": text, "offer": offer[:3], "point": point}


def _rate_ok(username: str) -> bool:
    now = time.monotonic()
    calls = _calls.setdefault(username, deque())
    while calls and now - calls[0] > RATE_WINDOW_SEC:
        calls.popleft()
    if len(calls) >= RATE_MAX:
        return False
    calls.append(now)
    return True


class SayRequest(BaseModel):
    text: str


class ConfigRequest(BaseModel):
    api_key: str | None = None      # set or replace; never read back
    clear_key: bool = False
    model: str | None = None        # "" goes back to the default


async def _call_glm(key: str, body: dict, timeout: float) -> dict:
    """One request to GLM. Failures become a 502 with a sentence the panel can show."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(API_URL, json=body, headers={
                "x-api-key": key, "anthropic-version": "2023-06-01"})
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        logger.warning("terminator: GLM %s: %s", status, exc.response.text[:300])
        if status in (401, 403):
            detail = "키가 거절됐습니다. 설정에서 키를 다시 넣습니다"
        elif status in (400, 404):
            detail = "모델을 찾지 못했습니다. 설정에서 모델 이름을 확인합니다"
        else:
            detail = "터미네이터가 지금 답하지 못합니다. 잠시 뒤 다시 물어봅니다"
        raise HTTPException(status_code=502, detail=detail) from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("terminator: GLM request failed: %s", exc)
        raise HTTPException(status_code=502, detail="터미네이터에 닿지 못했습니다. 잠시 뒤 다시 물어봅니다") from exc


@router.get("/api/terminator/config")
async def terminator_config_get(username: str = Depends(verify_auth_token)):
    return terminator_config.describe()


@router.put("/api/terminator/config")
async def terminator_config_put(request: ConfigRequest, username: str = Depends(verify_auth_token)):
    try:
        terminator_config.save(key=request.api_key, model=request.model, clear_key=request.clear_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        logger.warning("terminator: saving config failed: %s", exc)
        raise HTTPException(status_code=500, detail="설정 파일을 쓰지 못했습니다") from exc
    logger.info("terminator: config changed by %s (key %s, model %s)", username,
                "cleared" if request.clear_key else ("set" if request.api_key else "kept"),
                terminator_config.read_model())
    return terminator_config.describe()


@router.post("/api/terminator/check")
async def terminator_check(username: str = Depends(verify_auth_token)):
    key = _key()
    if key is None:
        raise HTTPException(status_code=409, detail="터미네이터 연결 키가 없습니다")
    if not _rate_ok(username):
        raise HTTPException(status_code=429, detail="잠시 뒤에 다시 확인합니다")
    model = terminator_config.read_model()
    started = time.monotonic()
    await _call_glm(key, {"model": model, "max_tokens": 8, "thinking": {"type": "disabled"},
                          "messages": [{"role": "user", "content": "ping"}]}, CHECK_TIMEOUT_SEC)
    return {"ok": True, "model": model, "ms": round((time.monotonic() - started) * 1000)}


@router.get("/api/terminator/status")
async def terminator_status(username: str = Depends(verify_auth_token)):
    return {"configured": _key() is not None, "model": terminator_config.read_model()}


@router.get("/api/terminator/messages")
async def terminator_messages(username: str = Depends(verify_auth_token)):
    return {"messages": list(_shown.get(username, ()))}


@router.post("/api/terminator/reset")
async def terminator_reset(username: str = Depends(verify_auth_token)):
    _history.pop(username, None)
    _shown.pop(username, None)
    return {"ok": True}


@router.post("/api/terminator/say")
async def terminator_say(request: SayRequest, username: str = Depends(verify_auth_token)):
    text = _CONTROL_RE.sub(" ", request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="보낼 내용이 없습니다")
    if len(text) > MAX_SAY_CHARS:
        raise HTTPException(status_code=400, detail=f"{MAX_SAY_CHARS}자까지 보낼 수 있습니다")
    key = _key()
    if key is None:
        raise HTTPException(status_code=409, detail="터미네이터 연결 키가 없습니다")
    if not _rate_ok(username):
        raise HTTPException(status_code=429, detail="잠시 뒤에 다시 물어봅니다")

    guide = _guide()
    point_ids = guide_ids(guide)
    history = _history.setdefault(username, deque(maxlen=HISTORY_MESSAGES))
    messages = [*history, {"role": "user", "content": text}]
    body = {
        "model": terminator_config.read_model(), "max_tokens": MAX_TOKENS, "thinking": {"type": "disabled"},
        "system": f"{PERSONA.format(actions=', '.join(UI_ACTIONS))}\n\nGUIDE:\n{guide}",
        "messages": messages,
    }
    data = await _call_glm(key, body, REQUEST_TIMEOUT_SEC)

    reply = read_reply(data, point_ids)
    history.append({"role": "user", "content": text})
    # Only the words go back next time; replaying our notes taught the model to write
    # "(offered new-tab)" into its sentences.
    history.append({"role": "assistant", "content": reply["text"] or "(done)"})
    shown = _shown.setdefault(username, deque(maxlen=SHOWN_MESSAGES))
    shown.append({"id": uuid.uuid4().hex, "role": "user", "text": text})
    item = {"id": uuid.uuid4().hex, "role": "assistant", **reply}
    shown.append(item)
    usage = data.get("usage") or {}
    logger.info("terminator: %s in=%s out=%s offer=%s", username, usage.get("input_tokens"),
                usage.get("output_tokens"), ",".join(reply["offer"]))
    return {"reply": item, "messages": list(shown)}
