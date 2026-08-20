"""WS 연결 관측 — "재접속했다" 가 아니라 "왜 재접속했는지" 를 남긴다.

이 저장소의 버그는 거의 다 재연결에 있는데(memory `project_ws_reconnect_watchdog`,
`project_duplicate_connect_await_window`, `project_ws_ticket_wedge_cookie_fallback`),
정작 로그에는 `WS attach: session=…` 한 줄뿐이었다. 그래서 사후 진단이 늘 추측이었다 —
서버는 소켓이 다시 열린 것만 볼 뿐, **클라이언트가 무엇을 보고 다시 열었는지** 모른다.

그 한 조각을 클라이언트가 핸드셰이크에 실어 보낸다(`reason`, `prev_ms`). 새 엔드포인트도
새 왕복도 없다 — 이미 있는 쿼리스트링에 얹는다.

읽는 법:

| 보이는 것 | 뜻 |
|---|---|
| `reason=heartbeat prev=13s` 가 여러 pane 에 동시에 | 하트비트 오탐 또는 공유 터널 정체 |
| `reason=close-1006 prev=수백초` | 전송단에서 끊겼다(터널 flap 후보) — cloudflared 로그와 시각 대조 |
| `reason=resume` 만 잦다 | 폰이 오갈 때의 정상 복귀 |
| `reason=initial` 이 한꺼번에 | 부팅/복원 버스트지 끊김이 아니다 |
| `lived=` 가 60초 근처 반복 | INACTIVE_PANE_GRACE_MS 로 우리가 닫은 것(정상) |

⚠️ **여기 들어오는 값은 클라이언트가 준 것이다.** 인증·권한에 전혀 쓰지 않고 로그로만
나가지만, 그래도 화이트리스트 + 길이 제한을 건다(로그 injection 방지).
"""
from __future__ import annotations

import logging
import re
import time

logger = logging.getLogger(__name__)

# 클라이언트가 보낼 수 있는 사유. 여기 없는 값은 `other` 로 접는다.
KNOWN_REASONS = frozenset({
    "initial",       # 이 pane 의 첫 연결
    "visible",       # 안 보이던 pane 이 보이게 됨(모바일 skipInitialConnect 해제)
    "heartbeat",     # 하트비트 임계 초과 — 오탐 후보이자 이 로그의 주 관찰 대상
    "watchdog",      # 진행 신호 없음 워치독
    "resume",        # focus/online/pageshow/visibilitychange
    "net-change",    # 네트워크 변경 감지
    "session-gone",  # 원격 세션 소멸 → create=1 전환
    "restart",       # 사용자가 세션 재시작
    "reload",        # 터미널 새로고침(refreshNonce)
})
# `close-1006` 처럼 코드가 붙는 형태만 추가로 허용한다.
_CLOSE_RE = re.compile(r"^close-\d{4}$")
_MAX_REASON_LEN = 24


def sanitize_reason(raw: str | None) -> str:
    """클라이언트가 준 사유를 로그에 안전한 짧은 슬러그로."""
    if not raw:
        return "unset"
    s = raw.strip()[:_MAX_REASON_LEN]
    if s in KNOWN_REASONS or _CLOSE_RE.match(s):
        return s
    return "other"


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_MAX_NAME_LEN = 22


def _short(value: str | None) -> str:
    """로그 폭은 좁아야 여러 줄을 눈으로 대조할 수 있다. 단 **구별은 잃으면 안 된다.**

    UUID 는 앞 8자로 충분하다(랜덤이라 그 안에서 갈린다). tmux 세션명은 다르다 —
    `mobile-2b4a0a2ee6f8` 과 `mobile-239e7229610c` 는 앞 8자가 **둘 다** `mobile-2` 라
    서로 다른 pane 이 로그에서 같은 것으로 보인다. 짧게 만들려다 읽을 수 없게 만드는
    전형적인 실수라, 이름 꼴은 통째로 둔다.
    """
    v = value or "-"
    if _UUID_RE.match(v):
        return v[:8]
    return v[:_MAX_NAME_LEN]


def _secs(ms: float | None) -> str:
    if not ms or ms < 0:
        return "-"
    return f"{ms / 1000:.1f}s"


def log_attach(
    *,
    kind: str,
    session: str,
    user: str,
    client_id: str | None,
    reason: str | None,
    prev_ms: float | None,
    cols: int,
    rows: int,
    created: bool = False,
) -> None:
    """소켓이 붙는 순간 — 왜 붙는지와 직전 소켓이 얼마나 살았는지를 함께 남긴다.

    `prev` 가 짧으면(수 초) 요동이고, 길면 한 번의 끊김이다. 그 둘은 원인이 다르므로
    로그에서 구별되어야 한다.
    """
    logger.info(
        "WS attach %s session=%s user=%s client=%s reason=%s prev=%s size=%dx%d%s",
        kind, _short(session), user, _short(client_id),
        sanitize_reason(reason), _secs(prev_ms), cols, rows,
        " created=1" if created else "",
    )


def log_detach(
    *,
    kind: str,
    session: str,
    client_id: str | None,
    opened_at: float,
    reason: str = "",
) -> None:
    """소켓이 끊긴 순간 — 얼마나 살았는지. attach 의 `prev` 와 짝을 이룬다.

    `opened_at` 은 `time.monotonic()` 값이어야 한다(벽시계는 NTP 보정에 흔들린다).
    """
    lived = max(0.0, time.monotonic() - opened_at)
    logger.info(
        "WS detach %s session=%s client=%s lived=%.1fs%s",
        kind, _short(session), _short(client_id), lived,
        f" {reason}" if reason else "",
    )


# 클라이언트가 보고할 수 있는 실패 범위/종류. 밖의 값은 `other` 로 접는다.
CLIENT_ERROR_SCOPES = frozenset({"paste-image", "paste-file", "file-drop", "attach-image"})
CLIENT_ERROR_KINDS = frozenset({"blocked", "offline", "server", "error"})
_MAX_DETAIL_LEN = 120


def _fold(value: str | None, allowed: frozenset[str]) -> str:
    v = (value or "").strip()
    return v if v in allowed else "other"


def _clean_detail(raw: str | None) -> str:
    """개행·제어문자를 걷어낸다 — 클라이언트 문자열이 가짜 로그 줄을 만들지 못하게."""
    if not raw:
        return ""
    flat = "".join(c if c.isprintable() else " " for c in str(raw))
    return " ".join(flat.split())[:_MAX_DETAIL_LEN]


def log_client_error(*, session: str, client_id: str | None, scope: str | None,
                     kind: str | None, detail: str | None) -> None:
    """브라우저에서만 아는 실패 — **살아있는 WS 로** 올라온다.

    HTTP 로 받으면 안 되는 이유가 이 로그의 존재 이유다: 알려야 할 상황이 바로 그 HTTP 가
    막힌 때다. 실제로 업로드 실패 한 건이 서버·터널 어디에도 흔적이 없어(요청이 나가질
    못했다) 원인을 추정으로만 좁혀야 했다. WS 는 매번 새 TCP 라 그때도 살아 있었다.

    ⚠️ 전부 클라이언트가 준 값이다. 인증·동작에 쓰지 않고 로그로만 나가며,
    화이트리스트 + 제어문자 제거로 로그 injection 을 막는다.
    """
    logger.warning(
        "client error session=%s client=%s scope=%s kind=%s detail=%s",
        _short(session), _short(client_id),
        _fold(scope, CLIENT_ERROR_SCOPES), _fold(kind, CLIENT_ERROR_KINDS),
        _clean_detail(detail) or "-",
    )
