"""Pane → backend channel. **No new port, no new credential.**

An agent inside a pane needs a way to talk to this backend so it can reach a pane on
another tab. That pane may sit on somebody else's machine, and the moment a token or SSH
key lands there, any code running on that machine can read it — that is the one thing
this design refuses to do.

So instead of opening a new path we use the one that already exists: the pane's PTY
output already flows to this backend over an authenticated channel. The agent prints one
marker line and the bridge picks it up. What the sender holds is its own address, the
text, and the pane's key — none of which is a secret of any value elsewhere.

    __ITL_SEND__ {"to": "1.2", "text": "build done", "key": "<pane key>", "n": "<nonce>"}

⚠️ **The line is not erased.** Cutting bytes out of the middle of a stream breaks the
terminal renderer (and at chunk boundaries you would cut half of it). Leaving it visible
is also the honest choice — the user sees what went out.

🔐 **The line is data the pane produced.** Any code — and any *output* — in the pane can
print it, so:
  - **The key must match the pane** (itl_key). Without this, a `curl`ed page or a `cat`ed
    file that happens to contain a marker types — and submits — a command into another
    pane of the user, possibly on another host. Code inside the pane can read the key;
    bytes merely printed through the pane cannot know it.
  - **An identical line is delivered once.** The agent's own transcript contains the
    line it printed; `cat`ing that transcript would replay every send. The per-send nonce
    keeps legitimate repeats distinct.
  - `to` is folded to the address shape only. The sender is **resolved by the backend
    from the session** — trusting a self-declared sender makes impersonation free.
  - Length and rate caps: two panes answering each other is an infinite loop.
  - Delivery targets are **this user's panes only** (the address book is per user).
"""
from __future__ import annotations

import codecs
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict

import itl_key

logger = logging.getLogger(__name__)

MARKER = "__ITL_SEND__"

#: 붙어 있지 않은 팬의 통로 — tmux 사용자 옵션. 표식과 **같은 JSON** 을 담는다.
#: 이름을 바꾸면 `cli/itl` 과 `agent_status_watcher.PANE_FORMAT` 도 같이 바꿔야 한다.
OUTBOX_OPTION = "@itl_outbox"

#: Cap on one marker line. Longer lines are dropped — this is also what keeps a stream
#: with no newline from growing the carry buffer forever.
MAX_LINE_CHARS = 16384

#: Sends one pane may make inside the window. Cuts the answer-each-other loop.
RATE_WINDOW_SEC = 10.0
RATE_MAX_SENDS = 5

#: Recently seen lines remembered for replay suppression. Bounded; shared by every
#: scanner in the process, because a reconnect makes a new scanner and tmux's attach
#: redraw can re-emit a marker line that is still on screen.
SEEN_MAX = 1024
_seen: OrderedDict[str, None] = OrderedDict()

#: Address shape (`tab.pane`) — the only thing this channel can deliver to.
ADDR_RE = re.compile(r"^\d+\.\d+$")
#: Bytes that would break a typed line or move the cursor. A line feed typed into a
#: shell *is* Enter, which would void the agent-only Enter rule downstream.
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
#: One "key mismatch" warning per scanner per this many seconds — a cat'ed file with a
#: million forged lines must not become a million log lines.
MISMATCH_LOG_INTERVAL_SEC = 30.0


class SentinelScanner:
    """PTY bytes → marker messages. **Survives chunk boundaries.**

    This repo deliberately avoids PTY scanning for status detection (spinners redraw the
    title 10–12×/s, so scanning itself was the load). Here it is different — sends happen
    at human frequency, and the work is splitting on newlines and looking for a prefix.

    `expected_key` is the key the pane was given (itl_key). Until it is set, every
    marker is dropped and logged — a scanner with no key must never deliver.
    """

    def __init__(self, expected_key: str | None = None) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._carry = ""
        self._hits: list[float] = []
        self._last_mismatch_log = 0.0
        self.expected_key = expected_key

    def set_key(self, expected_key: str | None) -> None:
        self.expected_key = expected_key

    def _rate_ok(self, now: float) -> bool:
        self._hits = [t for t in self._hits if now - t < RATE_WINDOW_SEC]
        if len(self._hits) >= RATE_MAX_SENDS:
            return False
        self._hits.append(now)
        return True

    @staticmethod
    def _seen_before(line: str) -> bool:
        digest = hashlib.sha256(line.encode("utf-8", errors="replace")).hexdigest()
        if digest in _seen:
            return True
        _seen[digest] = None
        while len(_seen) > SEEN_MAX:
            _seen.popitem(last=False)
        return False

    def _log_mismatch(self, now: float, to: str) -> None:
        if now - self._last_mismatch_log < MISMATCH_LOG_INTERVAL_SEC:
            return
        self._last_mismatch_log = now
        logger.warning("itl sentinel rejected — key mismatch (to=%s)", to)

    def feed_safe(self, data: bytes) -> list[dict]:
        """`feed`, but **never raises.** This is what the output pumps call: an
        exception there closes the pane (or drops the chunk from the screen), and a
        line any web page can print must not have that power."""
        try:
            return self.feed(data)
        except Exception as e:  # noqa: BLE001
            logger.warning("itl scanner error: %s", e)
            return []

    def feed(self, data: bytes) -> list[dict]:
        """Feed bytes; get back only **complete** marker messages.

        A partial line is carried to the next call — PTY reads are not line-aligned.
        """
        try:
            text = self._decoder.decode(data)
        except Exception:
            return []
        if not text:
            return []

        buf = self._carry + text
        lines = buf.split("\n")
        # The last piece is not a line yet. It is not kept without bound, though.
        self._carry = lines.pop()
        if len(self._carry) > MAX_LINE_CHARS:
            self._carry = ""

        out: list[dict] = []
        now = time.monotonic()
        for line in lines:
            # The marker is searched anywhere in the line, not at column 0: an agent
            # TUI (Claude Code, codex) prints tool output indented inside its own box.
            # Column anchoring would break the main use case; the key is the defense.
            idx = line.find(MARKER)
            if idx < 0:
                continue
            if len(line) > MAX_LINE_CHARS:
                logger.info("itl sentinel dropped — line too long")
                continue
            payload = line[idx + len(MARKER):]
            msg = parse_sentinel(payload)
            if not msg:
                continue
            if not itl_key.matches(self.expected_key, msg.get("key")):
                # Not silent: this is the signature of a reflected marker (or a pane
                # that has no key yet), and both are worth seeing in the log.
                self._log_mismatch(now, msg["to"])
                continue
            if self._seen_before(payload.strip()):
                logger.info("itl sentinel dropped — replay (to=%s)", msg["to"])
                continue
            if not self._rate_ok(now):
                # ⚠️ Not silent. A pane stuck in a loop is only visible in the log.
                logger.warning("itl sentinel rate-limited (>%d/%ss)",
                               RATE_MAX_SENDS, RATE_WINDOW_SEC)
                continue
            out.append({"to": msg["to"], "text": msg["text"], "n": msg.get("n")})
        return out


def parse_sentinel(payload: str) -> dict | None:
    """JSON after the marker → `{"to", "text", "key"}`. Wrong shape → **silently None**.

    Shouting errors at ordinary output (logs, source code) that happens to contain the
    marker would be noise. `key` is passed through untouched for the scanner to check;
    a line without one parses but can never be delivered.
    """
    try:
        data = json.loads(payload.strip())
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    to = data.get("to")
    text = data.get("text")
    if not isinstance(to, str) or not isinstance(text, str):
        return None
    to, text = to.strip(), text.strip()
    if not to or not text:
        return None
    # `to` must already look like an address (that is all the router accepts, and it
    # is what ends up in log lines). Interior control characters in `text` are cut out,
    # not merely stripped at the ends: a line feed typed into a pane is Enter.
    if not ADDR_RE.match(to):
        return None
    text = CONTROL_RE.sub(" ", text).strip()
    if not text:
        return None
    key = data.get("key")
    nonce = data.get("n")
    # Shape only. Whether that tab exists is re-counted right before delivery
    # (numbers shift when panes close).
    return {
        "to": to,
        "text": text,
        "key": key if isinstance(key, str) else None,
        # 같은 것을 두 통로로 받을 수 있어(표식 + 우편함) 라우터가 이걸로 접는다.
        "n": nonce if isinstance(nonce, str) else None,
    }
