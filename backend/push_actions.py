"""알림 버튼 — 잠금화면에서 누르면 그 pane 으로 입력이 들어간다.

**보낼 문구는 서버가 정한다.** 알림은 서비스워커에게 action id 만 넘기고, 그 id 를
실제 텍스트로 바꾸는 건 여기다. 페이로드에 텍스트를 실어 보내면 알림을 통해 임의
문자열이 터미널로 들어가는 통로가 되므로, 화이트리스트 밖은 아예 거절한다.

`submit=True` 인 이유: 파일 드롭·itl send 는 사람이 엔터를 치는 게 기본이지만,
여기서는 **버튼을 누른 것 자체가 그 의사표시**다. 누르고 나서 앱을 열어 엔터를 또
쳐야 한다면 이 기능의 의미가 없다.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# 기본 액션 — 에이전트가 한 턴을 마쳤을 때 가장 자주 하는 지시.
# `TELEGRAM_ACTIONS` 로 바꿀 수 있다: "계속,테스트 돌려,커밋해" 처럼 쉼표로 나열.
DEFAULT_ACTION_TEXTS = ["계속"]


def _load_action_texts() -> list[str]:
    raw = (os.getenv("TELEGRAM_ACTIONS") or "").strip()
    if not raw:
        return DEFAULT_ACTION_TEXTS
    texts = [t.strip() for t in raw.split(",") if t.strip()]
    return texts or DEFAULT_ACTION_TEXTS


# 제어키 액션 — 텍스트가 아니라 키를 보낸다.
# "계속" 만 있고 중단이 없으면 반쪽이다. 폭주하는 에이전트를 폰에서 멈출 수 있어야
# 알림이 감시 도구가 된다.
KEY_ACTIONS: dict[str, tuple[str, str]] = {
    "stop": ("중단", "C-c"),
}


def _build_actions() -> dict[str, tuple[str, str, bool]]:
    """action id → (버튼 라벨, 보낼 텍스트, 엔터까지 칠지).

    id 는 `a0`, `a1` … 로 짧게 둔다 — 텔레그램 callback_data 가 64바이트 제한이라
    사용자가 긴 문구를 넣어도 세션 ID 를 밀어내지 않아야 한다.
    """
    return {f"a{i}": (text, text, True) for i, text in enumerate(_load_action_texts())}


PUSH_ACTIONS: dict[str, tuple[str, str, bool]] = _build_actions()

# 알림 하나에 붙일 버튼 수 상한. 웹푸시가 대개 2개까지만 그리므로 3 이상은
# 텔레그램에서만 의미가 있다. 넘치면 **조용히 자르지 않고 로그로 알린다** —
# 설정한 버튼이 말없이 사라지면 원인을 찾을 수 없다.
MAX_ACTION_BUTTONS = 3


def action_buttons() -> list[dict]:
    """알림에 붙일 버튼 정의. 텔레그램과 서비스워커가 그대로 그린다.

    중단은 항상 마지막에 붙는다 — 어떤 상황에서도 멈출 수 있어야 한다.
    """
    items = list(PUSH_ACTIONS.items()) + [(k, (label, key, False)) for k, (label, key) in KEY_ACTIONS.items()]
    if len(items) > MAX_ACTION_BUTTONS:
        dropped = [label for _k, (label, _t, _s) in items[MAX_ACTION_BUTTONS:]]
        logger.warning("알림 버튼이 %d개 상한을 넘어 제외됨: %s", MAX_ACTION_BUTTONS, dropped)
    return [
        {"action": key, "title": label}
        for key, (label, _text, _submit) in items[:MAX_ACTION_BUTTONS]
    ]


def resolve_action(action: str) -> tuple[str, bool] | None:
    """텍스트 액션 → (텍스트, submit). 키 액션이거나 모르는 id 면 None."""
    entry = PUSH_ACTIONS.get(action)
    if not entry:
        return None
    _label, text, submit = entry
    return text, submit


def resolve_key_action(action: str) -> str | None:
    """키 액션 → tmux 키 이름 (`C-c` 등). 아니면 None."""
    entry = KEY_ACTIONS.get(action)
    return entry[1] if entry else None
