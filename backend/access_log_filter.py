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
    "/api/itl/targets",
)
# `/api/hosts/<id>/cwd|clients|tmux-clients` 처럼 id 가 낀 폴링.
_QUIET_RE = re.compile(r"^/api/hosts/[^/]+/(cwd/batch|tmux-clients|files\?|git/status)")

# uvicorn access 포맷: '%s - "%s %s HTTP/%s" %d %s' → args = (addr, method, path, ver, code, phrase)
_STATUS_IDX, _PATH_IDX = 4, 2


class QuietPollingAccessFilter(logging.Filter):
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
            return False
        return True


def install() -> None:
    """`main.py` 의 로깅 설정 직후에 부른다."""
    if os.getenv("ACCESS_LOG_QUIET", "1").strip() in ("0", "false", "no"):
        return
    logging.getLogger("uvicorn.access").addFilter(QuietPollingAccessFilter())
