"""팬 → 백엔드 통로. **새 포트도, 새 크리덴셜도 만들지 않는다.**

팬 안의 에이전트가 옆 탭에 말을 걸려면 백엔드에게 말을 걸 수 있어야 한다. 그런데 그
팬은 남의 기계에 있을 수도 있고, 거기에 토큰이나 SSH 키를 두는 순간 그 기계에서 도는
아무 코드나 그것을 읽는다 — 그게 이 설계가 피하려는 단 하나다.

그래서 통로를 새로 뚫지 않고 **이미 있는 것**을 쓴다: 그 팬의 PTY 출력은 이미 인증된
채널을 타고 이 백엔드로 흐른다. 에이전트가 표식 한 줄을 찍으면 브리지가 그것을 줍는다.
보내는 쪽이 가진 것은 자기 주소와 할 말뿐이고, 둘 다 비밀이 아니다.

    __ITL_SEND__ {"to": "1.2", "text": "빌드 끝났다"}

⚠️ **줄을 지우지 않는다.** 스트림 중간에서 바이트를 들어내면 터미널 렌더가 깨진다(그리고
청크 경계에서 반쪽만 지우게 된다). 화면에 보이는 편이 정직하기도 하다 — 무엇이 나갔는지
사용자가 본다.

🔐 **이 줄은 팬이 준 값이다.** 팬에서 도는 코드가 임의로 찍을 수 있으므로:
  - `to` 는 주소 모양(`탭.pane`)으로만 접는다. 보낸 이는 **백엔드가 세션에서 되짚는다**
    — 페이로드의 자칭을 믿으면 사칭이 공짜가 된다.
  - 길이·빈도 상한이 있다. 팬 둘이 서로에게 답하면 무한 고리가 된다.
  - 배달 대상은 **그 사용자의 팬**뿐이다(주소록 자체가 사용자별이다).
"""
from __future__ import annotations

import codecs
import json
import logging
import time

logger = logging.getLogger(__name__)

MARKER = "__ITL_SEND__"

#: 표식 줄 하나의 상한. 이보다 길면 그 줄은 버린다 — 개행 없는 스트림이 버퍼를 무한히
#: 키우는 것을 막는 값이기도 하다.
MAX_LINE_CHARS = 16384

#: 한 팬이 이 창 안에 보낼 수 있는 횟수. 서로 답하는 고리를 여기서 끊는다.
RATE_WINDOW_SEC = 10.0
RATE_MAX_SENDS = 5


class SentinelScanner:
    """PTY 바이트 → 표식 메시지. **청크 경계를 넘어 살아남는다.**

    이 저장소는 상태 감지에서 PTY 스캔을 일부러 피했다(스피너가 초당 10~12회라
    스캔 자체가 부하였다). 여기는 사정이 다르다 — 사람이 부르는 빈도이고, 하는 일은
    개행으로 쪼개 접두사를 보는 것뿐이다.
    """

    def __init__(self) -> None:
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._carry = ""
        self._hits: list[float] = []

    def _rate_ok(self, now: float) -> bool:
        self._hits = [t for t in self._hits if now - t < RATE_WINDOW_SEC]
        if len(self._hits) >= RATE_MAX_SENDS:
            return False
        self._hits.append(now)
        return True

    def feed(self, data: bytes) -> list[dict]:
        """읽은 바이트를 넣고 **완성된** 표식 메시지만 돌려받는다.

        반쪽 줄은 다음 호출까지 들고 있는다 — PTY 읽기는 개행 단위가 아니다.
        """
        try:
            text = self._decoder.decode(data)
        except Exception:
            return []
        if not text:
            return []

        buf = self._carry + text
        lines = buf.split("\n")
        # 마지막 조각은 아직 줄이 아니다. 다만 무한정 들고 있지는 않는다.
        self._carry = lines.pop()
        if len(self._carry) > MAX_LINE_CHARS:
            self._carry = ""

        out: list[dict] = []
        now = time.monotonic()
        for line in lines:
            idx = line.find(MARKER)
            if idx < 0:
                continue
            if len(line) > MAX_LINE_CHARS:
                logger.info("itl sentinel dropped — 줄이 너무 길다")
                continue
            msg = parse_sentinel(line[idx + len(MARKER):])
            if not msg:
                continue
            if not self._rate_ok(now):
                # ⚠️ 조용히 버리지 않는다. 고리에 빠진 팬은 로그로만 드러난다.
                logger.warning("itl sentinel rate-limited (%d/%ss 초과)",
                               RATE_MAX_SENDS, RATE_WINDOW_SEC)
                continue
            out.append(msg)
        return out


def parse_sentinel(payload: str) -> dict | None:
    """표식 뒤의 JSON → `{"to", "text"}`. 모양이 아니면 **조용히 None**.

    표식이 우연히 섞인 평범한 출력(로그·소스코드)에 대고 에러를 쏟으면 그게 소음이다.
    """
    try:
        data = json.loads(payload.strip())
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    to = data.get("to")
    text = data.get("text")
    if not isinstance(to, str) or not isinstance(text, str):
        return None
    to, text = to.strip(), text.strip()
    if not to or not text:
        return None
    # 여기서는 모양만 본다. "그 탭이 실제로 있나" 는 배달 직전에 다시 센다(번호는 밀린다).
    return {"to": to, "text": text}
