"""배달되는 메시지 앞에 붙는 출처 꼬리표 — "이건 어디서 온 말인가".

보내는 쪽은 **보낼 말에만** 집중하게 하고, 받는 쪽이 알아야 할 것은 백엔드가 붙인다.
손으로 쓰게 두면 매번 빠지고, 빠진 걸 받은 에이전트는 헤맨다 — 실제로 그랬다:
넘겨받은 에이전트가 자기 체크아웃에서 시작했다가 그 작업이 없어서 멈춰 물었다.
보낸 pane 의 **기계와 경로**가 곧 그 답이다.

한 줄로 붙이는 이유: `send-keys -l` 은 리터럴이라 개행이 그대로 **Enter** 가 된다.
꼬리표를 윗줄에 두면 그 줄만 먼저 실행되고 본문은 따로 떨어진다.
"""
from __future__ import annotations

# 꼬리표가 본문보다 길면 그건 잡음이다. 경로는 뒤쪽이 정체를 말하므로 꼬리를 남긴다.
MAX_CWD = 44


def _shorten_path(path: str) -> str:
    text = (path or "").strip()
    if len(text) <= MAX_CWD:
        return text
    return "…" + text[-(MAX_CWD - 1):]


def build_reply_cmd(itl_cmd: str, sender: dict | None) -> str:
    """받은 쪽이 **그대로 실행할 수 있는** 답장 명령.

    이게 없으면 받은 에이전트는 일만 하고 조용해진다 — 보낸 쪽은 아직 작업 중인 줄 알고
    기다리다 그대로 멈춘다. 실제로 그렇게 뻗었다. 주소는 보낸 pane 의 **세션 ID** 다:
    번호는 pane 이 닫히면 밀리고, 답장은 항상 원래 그 터미널로 가야 한다.
    """
    prog = (itl_cmd or "").strip()
    key = (sender or {}).get("sessionId") or (sender or {}).get("tmuxSession") or ""
    if not prog or not key:
        return ""
    return f"{prog} send {key} '<답장>' --submit"


def format_origin(sender: dict | None, machine: str = "", reply_cmd: str = "") -> str:
    """`[from 1.2 · a1-ubuntu · …/retro-go · 답장: itl send <id> '<답장>' --submit] `

    아는 것만 넣고 끝에 공백 하나. 보낸 pane 을 모르면(익명 호출) 빈 문자열이다 —
    모르는 걸 지어내느니 안 붙인다.
    """
    if not sender:
        return ""
    parts = [str(sender.get("addr") or "").strip()]
    name = str(sender.get("tabName") or "").strip()
    if name:
        parts.append(name)
    if machine:
        parts.append(machine)
    cwd = _shorten_path(sender.get("cwd") or "")
    if cwd:
        parts.append(cwd)
    if reply_cmd:
        parts.append(f"답장: {reply_cmd}")
    parts = [p for p in parts if p]
    return f"[from {' · '.join(parts)}] " if parts else ""


def find_sender(targets: list[dict], from_session: str | None) -> dict | None:
    """보낸 세션을 목록에서 찾는다 — 로컬은 sessionId, 원격은 tmux 세션 이름."""
    if not from_session:
        return None
    for target in targets:
        if from_session in (target.get("sessionId"), target.get("tmuxSession")):
            return target
    return None
