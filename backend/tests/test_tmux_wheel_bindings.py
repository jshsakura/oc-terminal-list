"""휠 바인딩은 **tmux 자신의 기본 분기**를 따른다.

⚠️ 한때 `alternate_on`(alt-screen 인가)으로 갈랐다. 그건 틀린 질문이다 — 물어야 할 것은
"이 앱이 마우스를 원하나"(`mouse_any_flag`)다. alt-screen 이지만 마우스를 안 쓰는 앱
(less·man)에 휠을 던지면 앱이 무시해서 **아무 일도 안 일어난다**.
"""
from __future__ import annotations

import inspect

from tmux_manager import TmuxManager

SRC = inspect.getsource(TmuxManager.create_session)


def _binding(key: str) -> str:
    """그 키의 bind-key 호출 한 덩어리."""
    at = SRC.index(f'"{key}",')
    return SRC[at:SRC.index("check=False", at)]


def test_wheel_uses_the_mouse_flag_not_the_alt_screen():
    for key in ("WheelUpPane", "WheelDownPane"):
        block = _binding(key)
        assert "mouse_app" in block, key
        assert "alternate_on" not in block, key


def test_the_condition_matches_tmux_own_default():
    """tmux 3.4 기본: `#{||:#{pane_in_mode},#{mouse_any_flag}}`.
    `pane_in_mode` 가 빠지면 이미 copy-mode 인데도 이벤트를 앱에 던진다."""
    assert "#{||:#{pane_in_mode},#{mouse_any_flag}}" in SRC


def test_page_keys_still_branch_on_the_alt_screen():
    """⚠️ PageUp/Down 은 **키**다 — 마우스 플래그와 무관하다. 여기까지 바꾸면 alt-screen
    앱에서 PgUp 이 앱으로 안 가고 copy-mode 가 열린다."""
    for key in ("PageUp", "PageDown"):
        block = _binding(key)
        assert "alternate_on" in block, key
        assert "mouse_app" not in block, key


def test_copy_mode_wheel_is_left_to_tmux():
    """copy-mode 안의 휠은 **덮지 않는다.**

    tmux 3.4 기본이 이미 `select-pane ; send -X -N 5 scroll-up/down` 이라 우리가 쓰던
    것과 같다. 같은 것을 다시 적으면 tmux 가 기본을 바꿨을 때 우리만 옛 동작에 묶인다 —
    덮을 이유가 없으면 덮지 않는 것이 "tmux 기준을 따른다" 의 뜻이다.
    """
    assert '"copy-mode", "WheelUpPane"' not in SRC
    assert '"copy-mode", "WheelDownPane"' not in SRC


def test_the_remote_bootstrap_uses_the_same_rule():
    """⚠️ 바인딩은 **두 벌**이다 — 로컬(tmux_manager)과 원격 부트스트랩(host_manager).
    한쪽만 고치면 로컬과 원격 pane 의 휠이 서로 다르게 동작한다."""
    from pathlib import Path
    remote = Path(__file__).resolve().parent.parent / "host_manager.py"
    body = remote.read_text(encoding="utf-8")
    at = body.index("WheelUpPane")
    block = body[at:at + 400]
    assert "mouse_any_flag" in block
    assert "alternate_on" not in block
    # copy-mode 도 로컬과 같이 tmux 기본에 맡긴다.
    assert "copy-mode WheelUpPane" not in body
