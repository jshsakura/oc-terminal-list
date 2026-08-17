"""tmux pane_title 에서 에이전트 상태를 읽는다.

왜 tmux 인가: tmux 는 이미 OSC 0/2 타이틀을 파싱해 `#{pane_title}` 로 들고 있다.
`list-panes -a -F` 한 번이면 전 세션 상태가 나온다 — **브라우저가 하나도 안 붙어
있어도.** 그래서 PTY 바이트를 따로 긁을 필요가 없다 (청크 경계 캐리·백프레셔·
스캐너 억제가 전부 불필요해진다).

판정 규칙은 stablyai/orca (MIT) 의 `src/shared/agent-title-status.ts` 에서 가져와
파이썬으로 옮겼다. 그쪽이 여러 에이전트를 상대로 이미 밟아둔 오탐 지뢰가 값어치다.

LLM 은 호출하지 않는다 — 순수 문자열 판정이다.
"""
from __future__ import annotations

import re

# ---------------------- 글리프 ----------------------

CLAUDE_IDLE = "✳"          # ✳
GEMINI_WORKING = "✦"       # ✦
GEMINI_SILENT_WORKING = "⏲"  # ⏲
GEMINI_IDLE = "◇"          # ◇
GEMINI_PERMISSION = "✋"    # ✋

# 브라유 점자 블록 — 거의 모든 CLI 스피너가 이 범위를 쓴다.
BRAILLE_RE = re.compile(r"[⠀-⣿]")

# 상태 글리프 전체 — 표시용 타이틀에서 떼어낸다.
_STATUS_GLYPHS_RE = re.compile(
    f"[{CLAUDE_IDLE}{GEMINI_WORKING}{GEMINI_SILENT_WORKING}{GEMINI_IDLE}{GEMINI_PERMISSION}⠀-⣿]"
)

# ---------------------- 에이전트 이름 ----------------------

# OSC 타이틀 판정 전용 목록. 의도적으로 좁다 — `amp` 같은 짧은 이름을 넣으면
# "timestamp ready" 같은 평범한 셸 타이틀이 에이전트 활동으로 둔갑한다.
AGENT_NAMES = (
    "claude", "openclaude", "codex", "copilot", "cursor", "gemini",
    "antigravity", "opencode", "aider", "grok", "devin", "droid", "hermes", "agy",
)

# 이름은 **반드시 토큰 단위로** 매치해야 한다. substring 으로 잡으면
#   "opencode-blinker" ⊃ "opencode",  "android" ⊃ "droid",  "~/codex/ready" ⊃ "codex"
# 가 전부 오탐이 된다. 경계 가드가 경로 구분자(/ \)와 하이픈 합성어를 양쪽에서 막는다.
_BOUNDARY = r"(?<![\w./\\-])"
_BOUNDARY_END = r"(?![\w./\\-])"
_AGENT_NAME_RE = re.compile(
    _BOUNDARY + "(?:" + "|".join(AGENT_NAMES) + r")(?:\.(?:exe|cmd|bat|ps1))?" + _BOUNDARY_END,
    re.IGNORECASE,
)

# ---------------------- 키워드 ----------------------

# 같은 이유로 키워드도 경계를 본다 — "reworking" 이 working 이 되면 안 된다.
_IDLE_KEYWORDS_RE = re.compile(r"(?<![\w./\\-])(ready|idle|done)(?![\w-])", re.IGNORECASE)
_WORKING_KEYWORDS_RE = re.compile(r"(?<![\w./\\-])(working|thinking|running)(?![\w-])", re.IGNORECASE)
_PERMISSION_KEYWORDS = ("action required", "permission", "waiting")


def detect_status(title: str | None) -> str | None:
    """'working' | 'permission' | 'idle' | None.

    None 은 "에이전트가 아니다" 이지 "모르겠다" 가 아니다 — 평범한 셸 타이틀은
    상태를 갖지 않는다.
    """
    if not title:
        return None

    # 1) 글리프가 가장 강한 증거다. cwd/세션 텍스트보다 우선한다.
    if GEMINI_PERMISSION in title:
        return "permission"
    if GEMINI_WORKING in title or GEMINI_SILENT_WORKING in title:
        return "working"
    if GEMINI_IDLE in title:
        return "idle"
    if title.startswith(CLAUDE_IDLE):
        return "idle"
    if BRAILLE_RE.search(title):
        return "working"

    # 2) 글리프가 없으면 에이전트 이름이 있어야만 상태를 논한다.
    if not _AGENT_NAME_RE.search(title):
        return None

    lowered = title.lower()
    if any(word in lowered for word in _PERMISSION_KEYWORDS):
        return "permission"
    if _IDLE_KEYWORDS_RE.search(title):
        return "idle"
    if _WORKING_KEYWORDS_RE.search(title):
        return "working"

    # 이름만 있고 상태어가 없다 — 떠 있지만 놀고 있는 것으로 본다.
    return "idle"


def display_title(title: str | None) -> str:
    """탭/pane 이름으로 쓸 표시용 타이틀. 상태 글리프를 뗀다.

    글리프를 남기면 스피너 프레임마다 탭 이름이 덜덜 떨린다.
    전부 떼서 빈 문자열이 되면 원본을 돌려준다.
    """
    if not title:
        return ""
    cleaned = _STATUS_GLYPHS_RE.sub("", title)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned or title


def is_spinner_only_change(before: str | None, after: str | None) -> bool:
    """두 타이틀이 스피너 프레임만 다른가.

    브라유 스피너는 초당 10~12회 프레임이 바뀐다. 이걸 '변경' 으로 치면
    SSE 브로드캐스트가 그 자체로 폭주한다 (project_sse_reconnect_storm 재발).
    """
    if before == after:
        return True
    return display_title(before) == display_title(after)


# ---------------------- 프롬프트 상자냐, 셸이냐 ----------------------

def is_agent_pane(command: str | None = None, title: str | None = None) -> bool:
    """이 pane 이 **에이전트 입력창**인가 (아니면 그냥 셸인가).

    출처 꼬리표(`[from …]`)를 붙여도 되는지가 여기 달려 있다. 에이전트 프롬프트에서는
    그냥 문장의 일부지만, **셸에서는 그 줄이 통째로 깨진 명령어**가 된다
    (`[from: command not found`). 그래서 확신이 없으면 붙이지 않는다.

    두 증거를 본다:
      - 돌고 있는 명령 이름 (`#{pane_current_command}`) 이 아는 에이전트인가.
      - pane 타이틀이 에이전트 상태로 읽히는가 (`detect_status` 는 평범한 셸 타이틀에
        대해 None 을 준다 — "모르겠다" 가 아니라 "에이전트가 아니다").
    """
    name = (command or "").strip()
    if name and _AGENT_NAME_RE.search(name):
        return True
    return detect_status(title) is not None
