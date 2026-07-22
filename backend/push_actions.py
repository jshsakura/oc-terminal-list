"""알림 버튼 — 잠금화면에서 누르면 그 pane 으로 입력이 들어간다.

**보낼 문구는 서버가 정한다.** 알림은 서비스워커에게 action id 만 넘기고, 그 id 를
실제 텍스트로 바꾸는 건 여기다. 페이로드에 텍스트를 실어 보내면 알림을 통해 임의
문자열이 터미널로 들어가는 통로가 되므로, 화이트리스트 밖은 아예 거절한다.

`submit=True` 인 이유: 파일 드롭·itl send 는 사람이 엔터를 치는 게 기본이지만,
여기서는 **버튼을 누른 것 자체가 그 의사표시**다. 누르고 나서 앱을 열어 엔터를 또
쳐야 한다면 이 기능의 의미가 없다.
"""
from __future__ import annotations

# action id → (버튼 라벨, 보낼 텍스트, 엔터까지 칠지)
PUSH_ACTIONS: dict[str, tuple[str, str, bool]] = {
    "continue": ("계속", "계속", True),
}

# 알림 하나에 붙일 버튼 수 상한 — 플랫폼이 대개 2개까지만 보여준다.
MAX_ACTION_BUTTONS = 2


def action_buttons() -> list[dict]:
    """푸시 페이로드에 실을 버튼 정의. 서비스워커가 그대로 그린다."""
    return [
        {"action": key, "title": label}
        for key, (label, _text, _submit) in list(PUSH_ACTIONS.items())[:MAX_ACTION_BUTTONS]
    ]


def resolve_action(action: str) -> tuple[str, bool] | None:
    """action id → (텍스트, submit). 모르는 id 는 None — 조용히 무시하지 말고 거절한다."""
    entry = PUSH_ACTIONS.get(action)
    if not entry:
        return None
    _label, text, submit = entry
    return text, submit
