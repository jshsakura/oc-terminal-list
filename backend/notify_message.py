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

    **첫 줄(헤더)에 작업 제목을 앞세운다.** 텔레그램 푸시 미리보기는 메시지 첫 줄을
    쓰므로, 주소만 있으면(예: "1.1 · web") 알림만 봐선 무슨 일이 끝났는지 알 수 없다.
    제목을 맨 앞에 두고 주소를 뒤에 붙여 "메모리 분석 — 1.1 · web" 처럼 만든다.
    제목이 헤더로 올라갔으니 아래에 따로 💬 줄을 두지 않는다.

    ※ "열기" 딥링크는 본문에 넣지 않는다 — 첫 줄에 URL 이 끼면 미리보기가 링크로
    뭉개진다. 링크는 인라인 **버튼**으로 나간다.
    """
    title_text = (title or "").strip()
    label_text = (label or "").strip()
    if title_text and label_text:
        head = f"{title_text} — {label_text}"
    else:
        head = title_text or label_text or "작업 완료"
    lines = [f"✅ {head}"]

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
    if excerpt:
        lines.append("")
        lines.append(excerpt)
    if others:
        lines.append("")
        lines.append(f"그 외 {others}")

    return "\n".join(lines)
