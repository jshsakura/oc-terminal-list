"""무엇으로 세션을 잡아 둘 것인가 — **선택이고, 안 골라도 된다.**

이 앱은 오래 "tmux 가 있다" 를 전제로 삼았다. 원격 호스트에 tmux 가 없으면 경고 한 줄을
띄우고 평범한 셸로 떨어뜨렸는데, 그 경고는 연결 순간에 한 번 지나갈 뿐이라 **닫으면
작업이 날아간다는 사실을 아무 데서도 말해 주지 않았다.**

지금의 규칙은 셋이다:

1. **멀티플렉서는 데이터다.** tmux 도 herdr 도 서드파티이고, 우리 것(itl)은 이미 걷어냈다.
   둘 중 하나를 특별 취급할 근거가 없다 — `CHOICES` 에 나란히 있을 뿐이다.
2. **없어도 터미널은 그냥 된다.** `NONE` 은 고장이 아니라 유효한 선택이다. 셸이 하나
   뜨고, 탭을 닫으면 끝난다. 많은 쓰임에 그게 맞다.
3. **대신 반드시 말한다.** 세션이 안 남는다는 것은 사용자가 **닫기 전에** 알아야 하는
   사실이다. `persists()` 가 그 판정 하나이고, 화면은 그것만 본다.

⚠️ **`use_remote_tmux` 는 아직 살아 있다.** 예전 호스트 행과 예전 클라이언트가 보내는
값이라, 새 `multiplexer` 칸이 비어 있으면 그것으로 되짚는다(`from_host_row`). 두 값이
따로 놀지 않게 **읽는 곳은 여기 하나**로 모은다.
"""
from __future__ import annotations

TMUX = "tmux"
HERDR = "herdr"
NONE = "none"

#: 화면의 선택지 순서이기도 하다.
CHOICES: tuple[str, ...] = (TMUX, HERDR, NONE)

#: 아무 것도 안 고른 호스트의 기본. 이 저장소가 tmux 위에 지어졌으므로 tmux 다.
DEFAULT = TMUX


def normalize(value: object, *, fallback: str = DEFAULT) -> str:
    """모르는 값은 조용히 fallback. 경계에서 한 번만 거른다."""
    if isinstance(value, str):
        choice = value.strip().lower()
        if choice in CHOICES:
            return choice
    return fallback


def persists(choice: str) -> bool:
    """이 선택에서 세션이 접속을 넘어 살아남는가.

    화면의 "닫으면 끊어집니다" 안내는 이 한 줄만 본다 — 판정을 두 군데서 하면
    반드시 어긋난다(이 저장소가 탭 색·sanitize 에서 이미 두 번 밟았다).
    """
    return normalize(choice) != NONE


def from_host_row(row: dict | None, *, fallback: str = DEFAULT) -> str:
    """호스트 행 → 선택. 새 칸이 없으면 옛 `use_remote_tmux` 로 되짚는다.

    되짚기는 **끄기만** 할 수 있다: 옛 스키마에는 herdr 라는 값이 아예 없었으므로
    `use_remote_tmux=1` 은 "tmux" 가 아니라 "기본값 그대로" 라는 뜻이다.
    """
    if not row:
        return normalize(None, fallback=fallback)
    explicit = row.get("multiplexer")
    if explicit:
        return normalize(explicit, fallback=fallback)
    legacy = row.get("use_remote_tmux", 1)
    if legacy in (0, "0", False):
        return NONE
    return normalize(None, fallback=fallback)
