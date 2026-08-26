"""probe.py 를 원격으로 보낼 수 있는 형태로 만든다.

`llm_usage.runner.script_source()` 와 같은 자리다 — 스크립트는 **항상 이 백엔드에서**
나가므로 원격이 낡을 수 없다. 다른 점은 하나: 글리프 집합을 여기서 찍어 넣는다.

⚠️ **글리프를 probe.py 에 적어 두면 판정 규칙이 두 벌이 된다.** 이 저장소는 그 사고를
이미 두 번 겪었다(agent_status.py ↔ agentTitle.js, Toggle 두 벌). 치환이 실패하면
probe 는 시작하자마자 죽는다 — 조용히 다른 규칙으로 도는 것보다 낫다.
"""
from __future__ import annotations

import re
from pathlib import Path

import agent_status

_PROBE = Path(__file__).with_name("probe.py")
_PLACEHOLDER = "__STATUS_GLYPHS__"


def glyph_class() -> str:
    """`agent_status` 가 쓰는 문자 클래스 **본문**(대괄호 안쪽)."""
    pattern = agent_status._STATUS_GLYPHS_RE.pattern
    m = re.fullmatch(r"\[(.*)\]", pattern, re.S)
    if not m:                       # 상대가 모양을 바꿨다 — 짐작하지 않는다
        raise RuntimeError(f"unexpected glyph pattern: {pattern!r}")
    return m.group(1)


def script_source() -> str:
    src = _PROBE.read_text(encoding="utf-8")
    if _PLACEHOLDER not in src:
        raise RuntimeError("probe.py lost its STATUS_GLYPHS placeholder")
    return src.replace(_PLACEHOLDER, glyph_class())
