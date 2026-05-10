"""
tmux 매니저: 전용 tmux 서버 소켓을 통한 영속 세션 관리

설계 요점
- 전용 소켓 (`-L iterminallist-app`) 으로 시스템의 다른 tmux와 격리
- 세션명 = UUID (불변), 사용자 표시명은 SQLite 별도 관리
- 세션은 detached 상태로 생성되어 tmux 서버에 살아있음
- 백엔드 재시작과 무관하게 tmux 서버가 살아있는 한 세션 보존
- 클라이언트 attach는 ws_bridge.py에서 PTY로 spawn
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


TMUX_SOCKET_NAME = os.getenv("TMUX_SOCKET_NAME", "iterminallist-app")
TMUX_BIN = shutil.which("tmux") or "tmux"
DEFAULT_HISTORY_LIMIT = int(os.getenv("TMUX_HISTORY_LIMIT", "100000"))


@dataclass(frozen=True)
class TmuxSessionInfo:
    """tmux 세션 메타 (read-only 스냅샷)"""
    name: str
    windows: int
    attached: bool
    created: int


class TmuxError(RuntimeError):
    """tmux 명령 실패"""


class TmuxManager:
    """
    tmux 서버 wrapper. 세션의 생사만 책임진다.
    PTY/WebSocket 브리지는 ws_bridge.py 담당.
    """

    def __init__(self, socket_name: str = TMUX_SOCKET_NAME, history_limit: int = DEFAULT_HISTORY_LIMIT):
        self.socket_name = socket_name
        self.history_limit = history_limit
        # 세션별 cwd 변화 타임라인 (ts, cwd) — 같은 cwd 가 연속으로 들어오면 갱신만
        self._cwd_history: Dict[str, Deque[Tuple[float, str]]] = {}

    def _base_args(self) -> List[str]:
        return [TMUX_BIN, "-L", self.socket_name]

    def _tmux_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.pop("TMUX", None)
        env.pop("TMUX_PANE", None)
        return env

    async def _run(self, *args: str, check: bool = True, capture: bool = True) -> tuple[int, str, str]:
        """tmux 명령 실행 → (rc, stdout, stderr).

        ⚠️  tmux 서버가 daemonize 될 때 stdout/stderr 파이프를 상속받아 닫지 않으면
        `communicate()` 가 영원히 블로킹된다. 따라서 출력이 필요 없는 호출은
        `capture=False` 로 호출해 DEVNULL 로 리다이렉트한다.
        """
        cmd = [*self._base_args(), *args]
        if capture:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._tmux_env(),
            )
            stdout, stderr = await proc.communicate()
            out = stdout.decode("utf-8", errors="replace").strip()
            err = stderr.decode("utf-8", errors="replace").strip()
        else:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=self._tmux_env(),
            )
            await proc.wait()
            out = ""
            err = ""

        rc = proc.returncode if proc.returncode is not None else -1
        if check and rc != 0:
            raise TmuxError(f"tmux {' '.join(args)} failed (rc={rc}): {err or out}")
        return rc, out, err

    async def server_alive(self) -> bool:
        """tmux 서버 응답 여부"""
        rc, _, _ = await self._run("list-sessions", check=False)
        # rc=0 (세션 존재) 또는 rc!=0 with "no server"/"no sessions" 모두 정상 분기
        return rc == 0 or rc == 1  # 1 = no sessions, 서버는 살아있을 수 있음

    async def session_exists(self, session_id: str) -> bool:
        rc, _, _ = await self._run("has-session", "-t", f"={session_id}", check=False)
        return rc == 0

    async def create_session(
        self,
        session_id: str,
        cols: int = 80,
        rows: int = 24,
        cwd: Optional[str] = None,
        shell: Optional[str] = None,
    ) -> None:
        """새 detached 세션 생성. 이미 존재하면 no-op."""
        if await self.session_exists(session_id):
            logger.debug("tmux session already exists: %s", session_id)
            return

        args = [
            "new-session", "-d",
            "-s", session_id,
            "-x", str(max(cols, 1)),
            "-y", str(max(rows, 1)),
        ]
        if cwd:
            args += ["-c", cwd]

        # 셸을 명시하면 첫 윈도우의 명령으로 사용. 미지정 시 사용자 기본 셸.
        if shell:
            args.append(shell)

        # ⚠️  new-session은 tmux 서버를 daemonize 하므로 stdout/stderr를 잡으면 hang.
        # capture=False 로 DEVNULL 리다이렉트하고, has-session으로 사후 확인.
        await self._run(*args, capture=False)
        if not await self.session_exists(session_id):
            raise TmuxError(
                f"new-session 직후 세션이 보이지 않음: {session_id} "
                f"(shell={shell}, cwd={cwd}). 셸/디렉토리 권한을 확인하세요."
            )
        # 세션 옵션: 웹 임베드 환경에 적합한 기본값
        opts = [
            ("history-limit", str(self.history_limit)),
            # mouse 는 일부러 off — 웹 터미널에서 우클릭/스크롤은 xterm.js 가
            # 처리해야 자연스럽다. tmux 가 가로채면 우클릭 붙여넣기 등이 깨짐.
            ("mouse", "off"),
            ("window-size", "latest"),         # 다중 클라이언트시 최근 활성 사이즈
            ("default-terminal", "tmux-256color"),
            ("aggressive-resize", "on"),       # 클라이언트 PTY 차원으로 즉시 리사이즈
            ("status", "off"),                 # 하단 상태바 숨김 (xterm.js 임베드 친화)
            ("renumber-windows", "on"),
            ("focus-events", "on"),
        ]
        for key, val in opts:
            await self._run("set-option", "-t", session_id, key, val, check=False)
        # truecolor override
        await self._run(
            "set-option", "-ag", "-t", session_id, "terminal-overrides", ",*256col*:Tc",
            check=False,
        )
        # PgUp/PgDn 자동 분기 — pane 이 alt-buffer (vim/less 등) 면 그대로 통과,
        # normal buffer (일반 셸) 면 copy-mode 진입해 페이지 단위 이동.
        # `-eu` = 페이지 위로 + 마지막 도달 시 자동 종료. 모바일 우측 사이드바의
        # PgUp/PgDn 버튼이 PTY 로 키 시퀀스를 보내면 여기서 처리됨.
        await self._run(
            "bind-key", "-T", "root", "PageUp",
            "if-shell", "-F", "#{alternate_on}",
            "send-keys PageUp", "copy-mode -eu",
            check=False,
        )
        await self._run(
            "bind-key", "-T", "root", "PageDown",
            "if-shell", "-F", "#{alternate_on}",
            "send-keys PageDown", "",
            check=False,
        )

        logger.info("tmux session created: %s (%dx%d, cwd=%s, shell=%s)", session_id, cols, rows, cwd, shell)

    async def kill_session(self, session_id: str) -> None:
        if not await self.session_exists(session_id):
            return
        await self._run("kill-session", "-t", f"={session_id}", check=False)
        logger.info("tmux session killed: %s", session_id)

    async def resize_window(self, session_id: str, cols: int, rows: int) -> None:
        """세션의 모든 윈도우 크기 조정 (어태치된 클라이언트가 없을 때 유용)."""
        if not await self.session_exists(session_id):
            return
        await self._run(
            "resize-window", "-t", session_id,
            "-x", str(max(cols, 1)),
            "-y", str(max(rows, 1)),
            check=False,
        )

    async def list_sessions(self) -> List[TmuxSessionInfo]:
        rc, out, _ = await self._run(
            "list-sessions",
            "-F", "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}",
            check=False,
        )
        if rc != 0 or not out:
            return []
        result: List[TmuxSessionInfo] = []
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) != 4:
                continue
            name, windows, attached, created = parts
            try:
                result.append(TmuxSessionInfo(
                    name=name,
                    windows=int(windows or 0),
                    attached=int(attached or 0) > 0,
                    created=int(created or 0),
                ))
            except ValueError:
                continue
        return result

    async def clients_count(self, session_id: str) -> int:
        """해당 세션에 현재 attach 된 tmux 클라이언트 수.
        멀티 디바이스 takeover 모델에서, 마운트 전 "이미 누가 보고 있나?" 프리플라이트용."""
        rc, out, _ = await self._run(
            "list-clients", "-t", f"={session_id}",
            check=False,
        )
        if rc != 0:
            return 0
        if not out:
            return 0
        # 각 줄 = 클라이언트 1개. 빈 줄은 0 으로.
        return sum(1 for ln in out.splitlines() if ln.strip())

    def attach_argv(self, session_id: str) -> List[str]:
        """ws_bridge에서 PTY로 spawn할 때 쓰는 argv. 분리해서 권한·테스트 용이성 확보."""
        return [*self._base_args(), "attach-session", "-t", session_id]

    async def get_pane_cwd(self, session_id: str) -> Optional[str]:
        """활성 pane 의 현재 작업 디렉토리. 세션이 없거나 실패하면 None.
        호출 시점에 cwd 가 직전 기록과 다르면 활동 타임라인에 push.
        """
        if not await self.session_exists(session_id):
            return None
        rc, out, _ = await self._run(
            "display-message", "-t", session_id, "-p", "#{pane_current_path}",
            check=False,
        )
        if rc != 0:
            return None
        cwd = out.strip() or None
        if cwd:
            self._record_cwd(session_id, cwd)
        return cwd

    def _record_cwd(self, session_id: str, cwd: str) -> None:
        history = self._cwd_history.setdefault(session_id, deque(maxlen=50))
        if history and history[-1][1] == cwd:
            # 같은 cwd 가 연속이면 마지막 ts 만 갱신 (= "여기 있는 시간" 표현)
            history[-1] = (time.time(), cwd)
        else:
            history.append((time.time(), cwd))

    def get_cwd_history(self, session_id: str) -> List[Dict]:
        history = self._cwd_history.get(session_id, deque())
        return [{"ts": ts, "cwd": cwd} for ts, cwd in history]


# 전역 인스턴스 (main.py에서 import)
tmux_manager = TmuxManager()
