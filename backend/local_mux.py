"""이 서버의 팬을 **무엇이** 붙잡고 있는가 — 묻지 말고 찾는다.

처음 판은 설정 하나로 tmux 냐 herdr 냐를 갈랐다. 그건 **양자택일**이었고, 그래서
herdr 로 바꾸는 순간 멀쩡히 살아 있는 tmux 세션들이 "이어할 수 있는 세션" 목록에서
통째로 사라졌다(반대도 같다). 섞어 쓸 수가 없었다.

`backend/cli/itl` 이 이미 옳은 규칙을 쓰고 있었다 — **설정이 아니라 탐색이다.** 소켓에
직접 물어 지금 실제로 있는 것만 답하므로 "설정과 현실이 어긋난다" 에 걸리지 않는다.
이 모듈이 그 규칙을 앱 쪽에 맞춘 것이다:

- **살아있는 세션은 언제나 둘의 합집합이다**(`live_session_names`). 지우는 코드가 읽는
  값이라, 한쪽만 물으면 다른 쪽 탭이 전부 "죽었다" 로 읽혀 레이아웃이 날아간다.
- **이미 있는 세션에는 그것을 붙잡고 있는 쪽으로 붙는다**(`holder_of`). 설정은 여기에
  관여하지 않는다 — 설정이 정하는 것은 **새 세션을 무엇으로 열까** 뿐이다.
- **죽이는 것도 붙잡은 쪽에게 보낸다**(`kill_session`). tmux 로만 보내면 herdr 세션의
  "세션 재시작" 이 조용한 무동작이 된다.

| 붙잡은 것 | 팬이 실행하는 것 |
|---|---|
| `tmux`  | `tmux -L <sock> attach -t <id>` |
| `herdr` | `herdr --session <id>` |
| 없음(`none`) | 로그인 셸 — 닫으면 끝 |

⚠️ **없는 도구는 아예 묻지 않는다.** herdr 가 안 깔린 기계에서 `herdr session list` 를
부르면 그건 매 탭 상태 저장마다 헛도는 프로세스 하나다. `which` 결과를 먼저 본다.

⚠️ **빈 집합은 "전부 죽었다" 가 아니라 "판정 불가" 다.** 둘 다 못 물어봤을 때와 진짜로
아무것도 없을 때가 구별되지 않으므로, 지우는 코드는 빈 집합을 보면 손을 뗀다.
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


async def _herdr_stop_and_delete(session_id: str) -> None:
    """herdr 세션을 멈추고 지운다. `stop` 만으로는 이름이 남아 새로 안 뜬다.

    두 단계 다 실패해도 던지지 않는다 — 호출부(세션 삭제)는 "없어졌다" 를 최선으로 하고,
    남았을 때의 증상은 재시작이 조용히 무의미해지는 것이라 **로그로 남는 것이 중요하다.**
    """
    binary = herdr_bin()
    if not binary:
        logger.warning("herdr kill skipped — binary not found (%s)", session_id)
        return
    for args in (("session", "stop", session_id), ("session", "delete", session_id)):
        try:
            proc = await asyncio.create_subprocess_exec(
                binary, *args,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _out, err = await asyncio.wait_for(proc.communicate(), timeout=LIST_TIMEOUT_SEC)
        except (asyncio.TimeoutError, OSError) as e:
            logger.warning("herdr %s failed (%s): %s", " ".join(args), session_id, e)
            return
        if proc.returncode != 0:
            # `stop` 이 "이미 멈춰 있다" 로 실패해도 `delete` 는 해야 하므로 계속 간다.
            logger.info(
                "herdr %s returned %s (%s): %s",
                " ".join(args), proc.returncode, session_id,
                (err or b"").decode("utf-8", errors="replace").strip()[:200],
            )


async def kill_session(session_id: str) -> None:
    """이 세션을 없앤다 — **붙잡고 있는 쪽에게** 보낸다.

    tmux 에게만 보내면 herdr 세션의 "세션 재시작" 이 조용한 무동작이 된다: 죽일 tmux
    세션이 애초에 없으므로 kill 이 성공한 것처럼 끝나고, 재접속은 멀쩡히 살아 있는 herdr
    세션에 그대로 다시 붙는다. 아무도 안 붙잡고 있으면 할 일이 없다(셸은 소켓과 함께 끝난다).
    """
    holder = await holder_of(session_id)
    if holder == mux.TMUX:
        await tmux_manager.kill_session(session_id)
    elif holder == mux.HERDR:
        await _herdr_stop_and_delete(session_id)


async def session_holders() -> dict[str, str]:
    """`{세션이름: 붙잡은 것}` — tmux 와 herdr 를 **둘 다** 묻는다.

    한 번에 모아 두는 이유는 호출부(생사 판정·attach·kill)가 전부 같은 답을 필요로 하기
    때문이다. 두 곳에서 따로 세면 반드시 어긋난다.

    같은 이름이 양쪽에 있으면 **tmux 가 이긴다** — 전환기에 두 번 만들어진 이름이 그런
    모양이고, 그때 실제로 사람이 쓰던 쪽이 tmux 였다(herdr 쪽은 앱이 만들어만 두고
    아무도 안 붙은 껍데기였다).
    """
    holders: dict[str, str] = {}
    for name in await _herdr_session_names():
        holders[name] = mux.HERDR
    if shutil.which("tmux"):
        try:
            for session in await tmux_manager.list_sessions():
                holders[session.name] = mux.TMUX
        except Exception as e:
            logger.warning("tmux list-sessions failed: %s", e)
    return holders


async def live_session_names() -> set[str]:
    """살아있는 로컬 세션 이름 — **둘의 합집합.**

    ⚠️ 이 값으로 탭 상태 sanitize 와 세션 행 prune 이 **지운다.** 한쪽만 물으면 다른 쪽
    세션이 전부 죽은 것으로 읽혀 사용자의 레이아웃이 통째로 날아간다.
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

    herdr 는 `--session` 하나가 생성과 접속을 겸하므로 tmux 처럼 별도의 생성 단계가 없다.
    고른 것이 이 기계에 없으면 셸로 떨어진다 — 연결이 실패하는 것보다 낫고, 없다는
    사실은 `is_missing` 이 따로 알린다.
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
