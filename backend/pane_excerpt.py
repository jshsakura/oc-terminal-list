"""터미널 화면에서 "무슨 일이 있었는지" 보여줄 몇 줄을 골라낸다.

**LLM 을 쓰지 않는다.** 순수하게 구조만 본다.

왜 필요한가: "작업 완료" 라는 알림만으로는 확인할지 말지 판단할 수가 없다.
그렇다고 화면 마지막 줄을 그대로 쓰면 대개 UI 장식이 나온다 — 에이전트 CLI 는
화면 하단에 입력 상자와 상태바를 그려두기 때문이다:

    ...작업을 마쳤고 라이브에 반영까지 끝냈습니다.        ← 이게 내용
    ─ Worked for 8m 33s ──────────────────────────      ← 구분선(글자가 섞이기도 한다)
    › Explain this codebase                             ← 입력 placeholder
    gpt-5.6-sol · game-and-watch · perf/32x-histogram…  ← 상태바

문구를 하나씩 나열해 거르는 방식은 CLI 마다, 사용자 커스텀 statusline 마다 새로
뚫린다. 그래서 **모양**으로 판단한다 — 선 문자 비율, 프롬프트 기호로 시작하는 줄,
그리고 "구분선 아래가 전부 장식이면 그 아래는 통째로 UI" 라는 구조 규칙.
"""
from __future__ import annotations

import re

# 상자/구분선에 쓰이는 문자들.
_BOX_CHARS = set("─━│┃┌┐└┘├┤┬┴┼╭╮╰╯═║╔╗╚╝▔▁·—-_= ")
# 구분선으로 볼 최소 선문자 비율. `─ Worked for 8m 33s ─────` 처럼 글자가 섞여도 잡는다.
_DIVIDER_RATIO = 0.6
_DIVIDER_MIN_LEN = 8

# 프롬프트/입력 placeholder — 뒤쪽 UI 영역에서 이걸로 시작하는 줄은 내용이 아니다.
_PROMPT_PREFIX = re.compile(r"^\s*[❯›>$#%➜⏵]")

# 상태바 — 모양만으로는 안 잡히는 것들에 대한 보조 그물.
_STATUSLINE = re.compile(
    r"[█▓▒░]{2,}"                     # 진행 막대
    r"|bypass permissions"
    r"|shift\+tab to cycle"
    r"|\b\d+%\s*\(\d",                 # "4% (22:30)" 형태
    re.IGNORECASE,
)

# 화면 하단 UI 블록으로 볼 최대 높이(입력 상자 + 상태바). 이보다 위의 구분선은
# 본문 속 구분선으로 본다 — 전부 잘라내면 정작 내용이 사라진다.
MAX_TRAILING_UI_LINES = 8
# 폭에 맞춰 잘린 흔적. 상태바는 터미널 폭에 맞춰 끝을 자르므로 이 꼬리가 남는다 —
# 사용자 커스텀 statusline 은 문구가 제각각이라, 문구 대신 이 **모양**을 본다.
_TRUNCATED_SUFFIXES = ("…", "...", "…\u200b")

# 알림에 실을 줄 수와 길이 상한. 알림은 훑어보는 것이지 읽는 게 아니다.
MAX_LINES = 4
MAX_LINE_CHARS = 90
MAX_TOTAL_CHARS = 320


def _is_divider(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) < _DIVIDER_MIN_LEN:
        return False
    box = sum(1 for ch in stripped if ch in _BOX_CHARS)
    return box / len(stripped) >= _DIVIDER_RATIO


def _is_chrome(line: str) -> bool:
    """내용이 아니라 UI 장식인가."""
    stripped = line.strip()
    if not stripped:
        return True
    # 전부 선문자면 길이와 무관하게 장식이다(짧은 구분선도 있다).
    if all(ch in _BOX_CHARS for ch in stripped):
        return True
    return bool(_is_divider(line) or _PROMPT_PREFIX.match(line) or _STATUSLINE.search(line))


def _is_tail_chrome(line: str) -> bool:
    """화면 하단 영역에서만 적용하는 넓은 판정.

    본문 한가운데의 "…" 로 끝나는 줄은 내용일 수 있지만, 입력 상자 **아래**에서
    폭에 맞춰 잘린 줄은 사실상 상태바다.
    """
    return _is_chrome(line) or line.strip().endswith(_TRUNCATED_SUFFIXES)


def extract_excerpt(pane_text: str) -> str:
    """`capture-pane -p` 출력 → 알림에 넣을 발췌. 건질 게 없으면 빈 문자열."""
    lines = [ln.rstrip() for ln in (pane_text or "").splitlines()]
    if not lines:
        return ""

    # 하단 UI 블록 잘라내기 — 마지막 구분선을 찾되, **그 아래가 전부 장식일 때만**
    # 자른다. 일반 출력에서도 구분선을 쓰므로, 아래에 진짜 내용이 있으면 건드리지 않는다.
    tail_start = max(0, len(lines) - MAX_TRAILING_UI_LINES)
    for i in range(len(lines) - 1, tail_start - 1, -1):
        if not _is_divider(lines[i]):
            continue
        below = lines[i + 1:]
        # 아래가 전부 장식이면 그 구분선부터가 UI 블록이다.
        # (줄 수만 보고 자르면 `────` 다음의 "Build succeeded" 같은 진짜 출력을 날린다.)
        if all(_is_tail_chrome(ln) for ln in below):
            lines = lines[:i]
            break

    while lines and _is_tail_chrome(lines[-1]):
        lines.pop()
    content = [ln for ln in lines if not _is_chrome(ln)]
    if not content:
        return ""

    picked = [ln.strip()[:MAX_LINE_CHARS] for ln in content[-MAX_LINES:]]
    excerpt = "\n".join(picked)
    if len(excerpt) > MAX_TOTAL_CHARS:
        # 앞을 자른다 — 마지막 줄이 가장 최근이라 더 중요하다.
        excerpt = "…" + excerpt[-MAX_TOTAL_CHARS:]
    return excerpt
