"""이 서버의 pane 을 **무엇이** 붙잡는가 — tmux 를 밑에 깔지 않는다.

로컬 pane 은 오래 tmux 고정이었다. 그래서 herdr 를 골라도 실제로는 `tmux attach` 안에서
herdr 가 뜨는, 아무도 원하지 않은 이중 구조가 됐다. **둘 중 하나만 깔고 고른 것을 쓴다**
가 이 모듈의 전부다.

| 고른 것 | pane 이 실행하는 것 | 세션을 붙잡는 것 |
|---|---|---|
| `tmux`  | `tmux -L <sock> attach -t <id>` | 우리 소켓의 tmux 서버 |
| `herdr` | `herdr --session <id>`          | herdr 자신의 서버 |
| `none`  | 로그인 셸                        | 아무도 (닫으면 끝) |

⚠️ **herdr 를 고르면 tmux 에 얹혀 있던 것들이 함께 사라진다.** 그건 빠뜨린 게 아니라
tmux 의 기능이었다 — pane 주소 상태바(`@pane_addr`), 아무도 안 보는 pane 의 에이전트 상태
폴링(`list-panes -a`), pane cwd 추적, tmux 세션 재시작·무덤. herdr 는 자기 UI 안에서
자기 방식으로 한다. **모르는 것을 아는 척 채우지 않는다**(이 저장소의 `installed: null`
규칙과 같다).

⚠️ **가장 위험한 자리는 "살아있는 세션 목록" 이다.** 탭 상태 sanitize 와 세션 행 prune 이
그 목록에 없는 것을 **지운다.** tmux 에게만 물으면 herdr pane 은 전부 "죽은 것" 으로 읽혀
사용자의 탭 레이아웃이 통째로 날아간다. 그래서 목록도 고른 것을 따라 갈라진다
(`live_session_names`).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil

import multiplexer as mux
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

#: herdr 는 대개 `~/.local/bin` 에 앉는데, 이 백엔드의 PATH 에는 없을 수 있다.
HERDR_SEARCH_PATH = (
    os.path.expanduser("~/.local/bin"),
    "/usr/local/bin",
    "/usr/bin",
)

#: 목록 조회에도 상한을 둔다 — 이 저장소의 모든 대기와 같은 이유(끝나지 않는 대기는 버그다).
LIST_TIMEOUT_SEC = 5.0


def herdr_bin() -> str | None:
    """herdr 실행 파일. 없으면 None — 호출부는 그때 셸로 떨어진다."""
    found = shutil.which("herdr")
    if found:
        return found
    for directory in HERDR_SEARCH_PATH:
        candidate = os.path.join(directory, "herdr")
        if os.access(candidate, os.X_OK):
            return candidate
    return None


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


async def _herdr_session_names() -> set[str]:
    """`herdr session list --json` → 이름 집합. 못 물어보면 빈 집합.

    빈 집합의 뜻은 호출부에서 **"판정 불가"** 다 — tmux 쪽과 똑같이, 지우는 코드는
    빈 목록을 보면 아무것도 하지 않는다.
    """
    binary = herdr_bin()
    if not binary:
        return set()
    try:
        proc = await asyncio.create_subprocess_exec(
            binary, "session", "list", "--json",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=LIST_TIMEOUT_SEC)
    except (asyncio.TimeoutError, OSError) as e:
        logger.warning("herdr session list failed: %s", e)
        return set()
    return parse_herdr_sessions(stdout.decode("utf-8", errors="replace"))


def parse_herdr_sessions(text: str) -> set[str]:
    """herdr 의 JSON 에서 세션 이름만. 모양이 바뀌어도 **조용히 빈 집합**이 되게 둔다.

    빈 집합은 "판정 불가" 로 읽히므로 아무것도 안 지운다 — 모양이 바뀌었을 때
    사용자의 탭이 날아가는 것보다 죽은 행이 남는 쪽이 훨씬 낫다.
    """
    try:
        data = json.loads(text or "")
    except Exception:
        return set()
    rows = data.get("sessions") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return set()
    names: set[str] = set()
    for row in rows:
        if isinstance(row, str):
            names.add(row)
        elif isinstance(row, dict):
            name = row.get("name") or row.get("session") or row.get("id")
            if isinstance(name, str):
                names.add(name)
    return names


async def live_session_names(choice: str) -> set[str]:
    """살아있는 로컬 세션 이름. **빈 집합 = 판정 불가**(지우는 코드는 손을 뗀다)."""
    choice = mux.normalize(choice)
    if choice == mux.TMUX:
        return {s.name for s in await tmux_manager.list_sessions()}
    if choice == mux.HERDR:
        return await _herdr_session_names()
    # none — 붙잡아 두는 것이 없으므로 살아있는 세션이라는 개념 자체가 없다.
    return set()


def attach_argv(choice: str, session_id: str, shell: str | None = None) -> list[str]:
    """이 pane 의 PTY 가 실제로 실행할 명령.

    herdr 는 `--session` 하나가 생성과 접속을 겸하므로 tmux 처럼 별도의 생성 단계가 없다.
    herdr 가 없으면 셸로 떨어진다 — 연결이 실패하는 것보다 낫고, 프론트에는 따로 알린다.
    """
    choice = mux.normalize(choice)
    if choice == mux.TMUX:
        return tmux_manager.attach_argv(session_id)
    if choice == mux.HERDR:
        binary = herdr_bin()
        if binary:
            return [binary, "--session", session_id]
    return [shell or os.environ.get("SHELL") or "/bin/bash", "-l"]


def is_missing(choice: str) -> bool:
    """고른 것이 이 기계에 없는가 — 프론트의 "닫으면 사라집니다" 배너 조건."""
    choice = mux.normalize(choice)
    if choice == mux.HERDR:
        return herdr_bin() is None
    if choice == mux.TMUX:
        return shutil.which("tmux") is None
    return False
