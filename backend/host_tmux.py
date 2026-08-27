"""원격 tmux 세션 종료 — **붙어 있는 것은 기본적으로 죽이지 않는다.**

이 파일이 생긴 이유는 실제 사고다: 홈의 "이어할 수 있는 세션" 에 **지금 쓰고 있는**
세션이 떠 있었고, 사용자가 그걸 종료하자 **쓰던 세션이 같이 죽었다.**

목록 쪽에는 규칙이 이미 있었다 — 붙어 있는 세션은 "이어할 수 있는" 것이 아니므로
내밀지 않는다(`HomeSessions` 의 `!s.attached`). 그런데 그 판정이 **60초 캐시된
스냅샷**(`HOST_TMUX_CACHE_TTL_SEC`) 위에서, 그것도 브라우저가 다시 받아오기 전까지는
얼마든지 낡은 채로 돌았다. 그 사이에 사용자가 그 세션을 열면 카드는 남아 있고,
누르면 서버는 **아무것도 다시 확인하지 않고** 죽였다.

⚠️ **일반화: 파괴적 동작의 안전 판정을 호출자의 스냅샷에 맡기지 마라.** 화면은 언제나
과거를 그린다. 판정은 죽이기 **직전에**, 죽이는 쪽에서 한 번 더 해야 한다.

그래서 기본값이 거절이다. 붙어 있는 것을 **일부러** 죽이는 곳은 두 군데뿐이고
(세션 재시작 · 탭 닫기 = 이 앱의 종료 모델), 그 둘만 `allow_attached` 를 든다.
새 호출부는 아무것도 안 하면 안전한 쪽으로 떨어진다.
"""
from __future__ import annotations

import logging
import shlex

logger = logging.getLogger(__name__)

# tmux 부분은 **한 번만** 적는다. 리모트 통로는 argv 만 받으므로(셸이 없다) 리다이렉션도
# `||` 도 실을 수 없고, SSH 는 셸이라 실을 수 있다 — 두 벌로 적으면 포맷이 갈라진다.
LIST_TMUX_CMD = "tmux list-sessions -F '#{session_name}|#{session_attached}'"
LIST_SSH_CMD = f"{LIST_TMUX_CMD} 2>/dev/null || true"


class SessionInUseError(RuntimeError):
    """붙어 있는 세션이다 — 쓰는 중이라는 뜻이므로 지우지 않는다."""

    def __init__(self, session: str):
        super().__init__(session)
        self.session = session


def parse_sessions(output: str) -> dict[str, bool]:
    """`name|attached` 줄들 → {이름: 붙어있나}.

    ⚠️ 못 읽은 줄은 **버린다**(빈 dict 로 접지 않는다). 여기서 "모른다" 를 "안 붙었다"
    로 접으면 이 파일이 막으려는 바로 그 사고가 난다 — 호출부가 `.get(name)` 으로
    묻고, 없으면 "그런 세션이 없다"(= 죽여도 잃을 것이 없다)로 읽는다.
    """
    sessions: dict[str, bool] = {}
    for line in (output or "").strip().splitlines():
        name, sep, attached = line.strip().rpartition("|")
        if sep and name:
            sessions[name] = attached.strip() != "0"
    return sessions


def kill_tmux_cmd(session: str, *, shell: bool) -> str:
    """세션 하나를 죽이는 명령.

    SSH(셸) 쪽은 `has-session &&` 를 앞세운다 — 없는 세션에 `kill-session` 을 하면
    stderr 가 나고 exit 이 0 이 아니라, 호출부가 "실패" 로 읽는다. 리모트 통로는
    셸이 없으므로 그 판정을 호출부(`already_gone`)가 대신 한다.
    """
    safe = shlex.quote(session)
    if shell:
        return f"tmux has-session -t {safe} 2>/dev/null && tmux kill-session -t {safe}"
    return f"tmux kill-session -t {safe}"


async def assert_not_attached(run, session: str) -> None:
    """죽이기 **직전에** 다시 묻는다. 붙어 있으면 `SessionInUseError`.

    ⚠️ 목록 조회가 실패하면 **막지 않고 통과시킨다.** tmux 서버가 없어서 못 읽는 것이
    가장 흔한 경우인데(= 죽일 것도 없다), 그때 거절하면 "지워지지 않는 유령 카드" 가
    된다 — 이 저장소가 이미 겪은 실패 모드다. 막는 것은 **붙어 있다고 확인된 것**뿐이다.
    """
    try:
        output = await run()
    except Exception as e:                       # noqa: BLE001 — 사유는 로그로 충분하다
        logger.warning("attached 확인 실패, 종료는 진행: session=%s: %s", session, e)
        return
    if parse_sessions(output).get(session) is True:
        raise SessionInUseError(session)
