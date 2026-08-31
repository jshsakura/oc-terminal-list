"""폴링의 성공 응답을 access 로그에서 솎는다 — 의미 있는 줄이 보이게.

실측(7일): 앱이 남긴 34,478 줄 중 **17,663 줄이 `200 OK` 한 줄짜리 access 로그**였고,
그중 `GET /api/git/status` 만 4,851 줄이었다. 진짜 봐야 할 것(WS attach/detach 사유,
경고, 4xx/5xx)이 그 사이에 파묻혀서, 이 저장소가 반복해 밟은 재연결 버그들을 로그로
진단할 수가 없었다.

규칙 둘:

1. **성공만 솎는다.** 2xx/3xx 가 아니면 무조건 남긴다 — 폴링 엔드포인트의 404·500 이야말로
   가장 보고 싶은 줄이다.
2. **경로 화이트리스트로만 솎는다.** "빈도가 높으니 지운다" 는 식의 동적 판단은 두지
   않는다. 새 엔드포인트가 조용해지는 건 사고다 — 지울 것은 여기에 손으로 적는다.

⚠️ **WebSocket 핸드셰이크 줄은 절대 솎지 않는다.** `WS attach/detach` 와 짝을 이뤄
재연결을 읽는 근거다.

전부 끄고 싶으면 `ACCESS_LOG_QUIET=0`.
"""
from __future__ import annotations

import logging
import os
import re
import time

# 초당~분당으로 도는 폴링 엔드포인트들. 값을 만들지 않고 상태만 확인하는 것들이다.
_QUIET_PATHS = (
    "/api/git/status",
    "/api/sessions/cwd/batch",
    "/api/sessions/",          # …/clients — preflight
    "/api/hosts/tmux-sessions/batch",
    "/api/tab-state",          # PUT(대부분 unchanged) + GET
    "/api/ws-tickets",
    "/api/ws-ticket",
    "/api/sse-ticket",
    "/api/agent-status",
    "/api/snippets",
    "/api/command-history",
    "/api/health",
)
# `/api/hosts/<id>/cwd|clients|tmux-clients` 처럼 id 가 낀 폴링.
_QUIET_RE = re.compile(r"^/api/hosts/[^/]+/(cwd/batch|tmux-clients|files\?|git/status)")

# uvicorn access 포맷: '%s - "%s %s HTTP/%s" %d %s' → args = (addr, method, path, ver, code, phrase)
_STATUS_IDX, _PATH_IDX = 4, 2

# 솎은 양을 주기적으로 한 줄 남긴다.
SUMMARY_INTERVAL_SEC = 60.0
# 요약은 **다른 로거**로 나간다 — uvicorn.access 로 쓰면 이 필터를 다시 지나 재귀한다.
_summary_logger = logging.getLogger("access_log_filter")


class QuietPollingAccessFilter(logging.Filter):
    """⚠️ **솎되, 침묵하지는 않는다.**

    처음 판에는 요약이 없었다. 그 결과 "이 브라우저의 HTTP 경로가 살아 있었나" 를 나중에
    확인할 방법이 사라졌고, 실제로 업로드 실패를 진단할 때 **필요한 증거가 없어서**
    공유 HTTP/2 풀이 막힌 것인지 단정하지 못했다(그게 이 배포의 단골 고장인데도).

    그래서 주기마다 한 줄을 남긴다. 트래픽이 흐르고 있었다는 사실 자체가 신호다 —
    이 줄이 **끊기는 것**이 곧 "클라이언트의 HTTP 가 멈췄다" 는 증거가 된다.
    """

    def __init__(self) -> None:
        super().__init__()
        self._suppressed = 0
        self._clients: set[str] = set()
        self._window_started = time.monotonic()

    def _note(self, record: logging.LogRecord) -> None:
        self._suppressed += 1
        args = record.args
        if isinstance(args, tuple) and args and isinstance(args[0], str):
            self._clients.add(args[0].rsplit(":", 1)[0])
        now = time.monotonic()
        elapsed = now - self._window_started
        if elapsed < SUMMARY_INTERVAL_SEC:
            return
        _summary_logger.info(
            "access: 폴링 성공 %d건 생략 (%.0fs, 클라이언트 %d)",
            self._suppressed, elapsed, len(self._clients),
        )
        self._suppressed = 0
        self._clients.clear()
        self._window_started = now

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) <= _STATUS_IDX:
            return True
        status = args[_STATUS_IDX]
        if not isinstance(status, int) or status >= 400:
            return True                      # 실패는 언제나 남긴다
        raw_path = args[_PATH_IDX]
        if not isinstance(raw_path, str):
            return True
        path = raw_path.split("?", 1)[0]
        if path.startswith(_QUIET_PATHS) or _QUIET_RE.match(raw_path):
            self._note(record)
            return False
        return True


def install() -> None:
    """`main.py` 의 로깅 설정 직후에 부른다."""
    if os.getenv("ACCESS_LOG_QUIET", "1").strip() in ("0", "false", "no"):
        return
    logging.getLogger("uvicorn.access").addFilter(QuietPollingAccessFilter())
