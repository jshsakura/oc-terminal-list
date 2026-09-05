"""세션을 무엇이 붙잡아 두는가 — **tmux 가 기본이고, 안 붙잡는 것도 선택이다.**

이 앱은 tmux 위에 지어졌다. 로컬 pane 도 원격 pane 도 tmux 세션에 attach 하므로 연결이
끊겨도, 백엔드가 재시작돼도 셸은 살아 있다. 그 위에 한 가지 선택만 더 있다:

- `TMUX`: 세션을 tmux 가 붙잡는다. 이 저장소의 기본이자 사실상의 전부다.
- `NONE`: 붙잡지 않는다. 셸 하나가 뜨고 탭을 닫으면 끝난다. tmux 가 없는 호스트나
  일회성 셸에 쓴다. 고장이 아니라 유효한 선택이다.

한때 세 번째 값(herdr)이 있었다. 이 앱의 컨셉을 "tmux 기반 터미널" 로 다시 잡으면서
통째로 걷어냈다 — 두 멀티플렉서를 나란히 두면 "살아있는 세션 목록" 을 두 곳에 묻고
설정과 현실이 어긋나는 자리가 두 배가 된다.

**대신 반드시 말한다.** 세션이 안 남는다는 것은 사용자가 **닫기 전에** 알아야 하는
사실이다. `persists()` 가 그 판정 하나이고, 화면은 그것만 본다.

⚠️ **`use_remote_tmux` 는 아직 살아 있다.** 예전 호스트 행과 예전 클라이언트가 보내는
값이라, 새 `multiplexer` 칸이 비어 있으면 그것으로 되짚는다(`from_host_row`). 두 값이
따로 놀지 않게 **읽는 곳은 여기 하나**로 모은다.
"""
from __future__ import annotations

TMUX = "tmux"
NONE = "none"

#: 화면의 선택지 순서이기도 하다.
CHOICES: tuple[str, ...] = (TMUX, NONE)

#: 아무 것도 안 고른 호스트의 기본. 이 저장소가 tmux 위에 지어졌으므로 tmux 다.
DEFAULT = TMUX


def normalize(value: object, *, fallback: str = DEFAULT) -> str:
    """모르는 값은 조용히 fallback. 경계에서 한 번만 거른다.

    걷어낸 값(herdr)을 저장해 둔 옛 설정·호스트 행도 여기서 기본값으로 접힌다 —
    그 사용자의 세션이 죽은 것으로 읽히는 것보다 tmux 로 여는 쪽이 안전하다.
    """
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

    되짚기는 **끄기만** 할 수 있다: `use_remote_tmux=1` 은 "tmux" 라기보다
    "기본값 그대로" 라는 뜻이다.
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
