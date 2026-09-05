"""이 서버의 팬을 **무엇이** 붙잡고 있는가 — 묻지 말고 찾는다.

설정이 정하는 것은 **새 세션을 무엇으로 열까** 뿐이다. 이미 있는 세션에는 그것을
붙잡고 있는 쪽으로 붙는다(`holder_of`). 지금 붙잡을 수 있는 것은 tmux 하나이므로
답은 "tmux 가 잡고 있다" 아니면 "아무도 없다" 둘뿐이다.

| 붙잡은 것 | 팬이 실행하는 것 |
|---|---|
| `tmux`  | `tmux -L <sock> attach -t <id>` |
| 없음(`none`) | 로그인 셸 — 닫으면 끝 |

⚠️ **빈 집합은 "전부 죽었다" 가 아니라 "판정 불가" 다.** tmux 서버가 멈춘 모습과 진짜로
아무것도 없는 모습이 구별되지 않으므로, 지우는 코드(탭 sanitize·세션 prune)는 빈
집합을 보면 손을 뗀다.
"""
from __future__ import annotations

import logging
import os
import shutil

import multiplexer as mux
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)


async def choice_for(username: str) -> str:
    """이 사용자가 고른 값. 설정에 없으면 tmux(이 저장소의 기본).

    ⚠️ 설정을 못 읽었을 때 `none` 으로 떨어지면 **멀쩡한 tmux 세션들이 죽은 것으로**
    읽힌다(위의 sanitize/prune). 모를 때는 가장 보수적인 쪽, 즉 기본값이다.
    """
    try:
        settings = await storage.get_user_settings(username) or {}
    except Exception as e:
        logger.warning("multiplexer setting read failed for %s: %s", username, e)
        return mux.DEFAULT
    return mux.normalize(settings.get("defaultMultiplexer"))


async def kill_session(session_id: str) -> None:
    """이 세션을 없앤다 — **붙잡고 있는 쪽에게** 보낸다.

    아무도 안 붙잡고 있으면 할 일이 없다(셸은 소켓과 함께 끝난다).
    """
    if await holder_of(session_id) == mux.TMUX:
        await tmux_manager.kill_session(session_id)


async def session_holders() -> dict[str, str]:
    """`{세션이름: 붙잡은 것}`. 호출부(생사 판정·attach·kill)가 전부 같은 답을 본다."""
    holders: dict[str, str] = {}
    if shutil.which("tmux"):
        try:
            for session in await tmux_manager.list_sessions():
                holders[session.name] = mux.TMUX
        except Exception as e:
            logger.warning("tmux list-sessions failed: %s", e)
    return holders


async def live_session_names() -> set[str]:
    """살아있는 로컬 세션 이름.

    ⚠️ 이 값으로 탭 상태 sanitize 와 세션 행 prune 이 **지운다.**
    **빈 집합 = 판정 불가**(지우는 코드는 손을 뗀다).
    """
    return set(await session_holders())


async def holder_of(session_id: str) -> str | None:
    """이 세션을 지금 붙잡고 있는 것. 아무도 안 붙잡고 있으면 None(= 새로 만들어야 한다)."""
    return (await session_holders()).get(session_id)


def attach_argv(choice: str, session_id: str, shell: str | None = None) -> list[str]:
    """이 팬의 PTY 가 실제로 실행할 명령.

    `choice` 는 **이미 정해진 답**이다 — 호출부가 `holder_of()` 로 붙잡은 쪽을 찾았으면
    그것이고, 아무도 안 붙잡고 있을 때만 설정의 기본값이다. 여기서 다시 설정을 읽지
    않는다(같은 결정을 두 곳에서 하면 반드시 어긋난다).
    """
    if mux.normalize(choice) == mux.TMUX:
        return tmux_manager.attach_argv(session_id)
    return [shell or os.environ.get("SHELL") or "/bin/bash", "-l"]


def is_missing(choice: str) -> bool:
    """고른 것이 이 기계에 없는가 — 프론트의 "닫으면 사라집니다" 배너 조건."""
    return mux.normalize(choice) == mux.TMUX and shutil.which("tmux") is None
