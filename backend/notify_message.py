"""알림 본문 조립 — 있는 정보를 최대한 담되, 훑어볼 수 있게.

알림은 읽는 게 아니라 **훑는 것**이다. 그래서 한 줄에 하나씩 이모지로 표를 세워
눈이 필요한 줄로 바로 가게 한다. (마크다운은 쓰지 않는다 — 발췌에 `*` `_` 백틱이
섞여 있어 파싱시키면 전송이 통째로 실패한다. 이모지는 평문이라 안전하다.)

LLM 은 쓰지 않는다. 전부 이미 들고 있는 값이다.
"""
from __future__ import annotations


def format_duration(seconds: float | None) -> str:
    """사람이 읽는 소요 시간. 모르면 빈 문자열."""
    if not seconds or seconds < 0:
        return ""
    total = int(seconds)
    if total < 60:
        return f"{total}초"
    minutes, sec = divmod(total, 60)
    if minutes < 60:
        return f"{minutes}분 {sec}초" if sec else f"{minutes}분"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}시간 {minutes}분" if minutes else f"{hours}시간"


def summarize_others(snapshot: dict, exclude_session: str) -> str:
    """다른 터미널들이 지금 어떤지 — 지금 봐야 할지 판단하는 데 쓴다."""
    working = permission = idle = 0
    for session_id, state in (snapshot or {}).items():
        if session_id == exclude_session:
            continue
        status = (state or {}).get("status")
        if status == "working":
            working += 1
        elif status == "permission":
            permission += 1
        elif status == "idle":
            idle += 1
    parts = []
    if permission:
        parts.append(f"✋ 대기 {permission}")
    if working:
        parts.append(f"⚙️ 작업중 {working}")
    if idle:
        parts.append(f"💤 유휴 {idle}")
    return " · ".join(parts)


def _is_redundant(value: str, *already_shown: str) -> bool:
    """이미 보여준 것과 사실상 같은 값인가.

    탭 이름은 대개 폴더명에서 나온다 — 그대로 두면 같은 문자열이 라벨과 경로에
    두 번 찍힌다. 경로의 마지막 조각까지 비교해서 걸러낸다.
    """
    candidate = (value or "").strip().rstrip("/")
    if not candidate:
        return True
    tail = candidate.rsplit("/", 1)[-1]
    for shown in already_shown:
        text = (shown or "").strip()
        if not text:
            continue
        if candidate == text or tail == text or tail and tail in text.split(" · "):
            return True
    return False


def build_done_message(*, label: str = "", command: str = "", title: str = "",
                       cwd: str = "", host: str = "", duration_seconds: float | None = None,
                       excerpt: str = "", others: str = "") -> str:
    """완료 알림 본문.

    값이 없는 줄은 넣지 않고, **이미 보여준 값도 다시 넣지 않는다** — 같은 문자열이
    두 번 찍히면 정보량은 그대로인데 훑을 줄만 늘어난다.
    """
    lines = [f"✅ {label}" if label else "✅ 작업 완료"]

    meta = []
    if command:
        meta.append(f"🤖 {command}")
    took = format_duration(duration_seconds)
    if took:
        meta.append(f"⏱ {took}")
    if host:
        meta.append(f"🖥 {host}")
    if meta:
        lines.append(" · ".join(meta))

    if cwd and not _is_redundant(cwd, label):
        lines.append(f"📁 {cwd}")
    # 작업 내용이 발췌 안에 이미 보이면 굳이 한 번 더 쓰지 않는다.
    if title and title.strip() not in (excerpt or ""):
        lines.append(f"💬 {title}")
    if excerpt:
        lines.append("")
        lines.append(excerpt)
    if others:
        lines.append("")
        lines.append(f"그 외 {others}")

    return "\n".join(lines)
