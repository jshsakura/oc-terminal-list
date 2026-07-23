"""텔레그램 메시지 → (주소, 보낼 텍스트) 파싱.

폰에서 자유롭게 타이핑해 pane 에 바로 보낸다. 주소 문법은 `itl` 과 같다:

    1.1 테스트 다시 돌려봐      → 1번 탭 1번 pane 으로 "테스트 다시 돌려봐"
    @claude 오늘 작업 커밋해    → claude 돌고 있는 pane 전부로
    @backend npm run build     → backend 탭으로
    /r 3.2 재시작              → 3.2 로 (슬래시 명령형도 허용)

⚠️ 이건 **임의 문자열을 터미널에 넣는** 기능이다. 인증은 chat_id 가드 하나뿐이므로
(telegram_service 에서 검사) 그 방에 들어올 수 있는 사람 = 터미널에 입력할 수 있는
사람이다. 파싱은 그 사실을 바꾸지 않는다 — 여기서는 주소와 본문을 가르기만 한다.

버튼 콜백(계속/중단)과 달리 여기서는 **사용자가 친 그대로** 보낸다. 화이트리스트가
없는 이유: 자유 입력이 이 기능의 목적이다. 대신 엔터는 기본으로 친다 — 폰에서
한 줄 보내는 건 "이걸 실행해" 라는 뜻이지 "입력만 해두고 놔둬" 가 아니다.
"""
from __future__ import annotations

import re

# 주소가 될 수 있는 첫 토큰: 숫자.숫자 / 숫자 / @이름[.숫자]
_ADDRESS = re.compile(r"^(?:\d+(?:[.:]\d+)?|@[^\s]+)$")
# 봇 명령 접두사(선택). 텔레그램이 /명령 을 특별 취급하므로 흔한 것만 벗겨준다.
_SLASH_PREFIX = re.compile(r"^/(?:r|run|send|s)\b\s*", re.IGNORECASE)


def parse_command(text: str) -> tuple[str, str] | None:
    """`(주소, 본문)` 또는 파싱 불가 시 None.

    첫 단어가 주소처럼 보이면 그걸 주소로, 나머지를 본문으로 가른다.
    주소가 없으면 None — "어디로 보낼지" 없는 메시지는 조용히 무시한다(봇에게 그냥
    말을 거는 경우가 있으므로, 아무 pane 에나 흘려보내면 안 된다).
    """
    if not text:
        return None
    raw = _SLASH_PREFIX.sub("", text.strip(), count=1).strip()
    if not raw:
        return None

    first, _, rest = raw.partition(" ")
    if not _ADDRESS.match(first):
        return None
    body = rest.strip()
    if not body:
        # 주소만 있고 본문이 없다 — 보낼 게 없다.
        return None
    return first, body
