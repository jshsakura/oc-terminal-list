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
        self._cwd_history: dict[str, deque[tuple[float, str]]] = {}

    def _base_args(self) -> list[str]:
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
        cwd: str | None = None,
        shell: str | None = None,
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

        # history-limit 은 pane 생성(new-session) 시점에 버퍼 크기가 고정된다 — 아래 opts 처럼
        # set-option 으로 나중에 키워도 이미 만들어진 '첫 pane' 엔 소급 적용 안 돼 스크롤백이
        # 전역 기본값(2000)에 묶인다. 그래서 new-session 보다 먼저 전역(-g)으로 걸어 첫 pane 이
        # 큰 한도를 물려받게 한다. (set-option -g 는 서버가 없으면 띄우며 옵션을 심는다.)
        await self._run("set-option", "-g", "history-limit", str(self.history_limit), check=False)

        # ⚠️  new-session은 tmux 서버를 daemonize 하므로 stdout/stderr를 잡으면 hang.
        # capture=False 로 DEVNULL 리다이렉트하고, has-session으로 사후 확인.
        await self._run(*args, capture=False)
        if not await self.session_exists(session_id):
            raise TmuxError(
                f"new-session 직후 세션이 보이지 않음: {session_id} "
                f"(shell={shell}, cwd={cwd}). 셸/디렉토리 권한을 확인하세요."
            )
        # 세션 옵션: 웹 임베드 환경에 적합한 기본값
        # escape-time 0: ESC 키를 즉시 전달 (기본값 500ms 대기로 인한 ESC 지연 제거)
        # 서버 전역 옵션이므로 -s 플래그 사용. 여러 세션 생성 시 중복 설정되지만 무해함.
        await self._run("set-option", "-s", "escape-time", "0", check=False)

        opts = [
            ("history-limit", str(self.history_limit)),
            # mouse on — 스크롤을 우선한다. tmux attach 는 xterm 입장에서 alternate buffer라
            # 로컬 xterm scrollback 만으로는 실제 히스토리를 움직일 수 없다. 휠/터치는
            # frontend 가 tmux mouse wheel 이벤트로 보내고, tmux 가 copy-mode scroll 을 담당한다.
            ("mouse", "on"),
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
        # tmux 기본 WheelUpPane 은 root table 에서 copy-mode 진입만 하고 실제 scroll-up 을
        # 하지 않아 웹에서는 "히스토리가 없는 것처럼" 미세하게만 움직인다. 첫 wheel 부터
        # copy-mode 진입과 스크롤을 같이 수행하도록 명시한다.
        await self._run(
            "bind-key", "-T", "root", "WheelUpPane",
            "copy-mode -e; send-keys -X -N 5 scroll-up",
            check=False,
        )
        await self._run(
            "bind-key", "-T", "copy-mode", "WheelUpPane",
            "send-keys -X -N 5 scroll-up",
            check=False,
        )
        await self._run(
            "bind-key", "-T", "copy-mode", "WheelDownPane",
            "send-keys -X -N 5 scroll-down",
            check=False,
        )
        # mouse on 이므로 wheel 은 위 바인딩으로 살리고, 드래그/우클릭/더블클릭만
        # tmux copy-mode 자동 진입이나 팝업으로 번지지 않게 차단한다.
        for _ev in (
            "MouseDown1Pane", "MouseDown1Status", "MouseDown1StatusLeft", "MouseDown1StatusRight", "MouseDown1Border",
            "MouseDrag1Pane", "MouseDrag1Border", "MouseDragEnd1Pane",
            "MouseUp1Pane", "MouseUp1Status", "MouseUp1StatusLeft", "MouseUp1StatusRight", "MouseUp1Border",
            "MouseDown2Pane", "MouseUp2Pane",
            "MouseDown3Pane", "MouseDown3Status", "MouseDown3StatusLeft", "MouseDown3StatusRight",
            "DoubleClick1Pane", "TripleClick1Pane",
        ):
            await self._run("unbind-key", "-T", "root", _ev, check=False)

        logger.info("tmux session created: %s (%dx%d, cwd=%s, shell=%s)", session_id, cols, rows, cwd, shell)

    async def kill_session(self, session_id: str) -> None:
        if not await self.session_exists(session_id):
            self._cwd_history.pop(session_id, None)
            return
        await self._run("kill-session", "-t", f"={session_id}", check=False)
        # 메타데이터 누수 방지 — 세션 생사와 함께 cwd 타임라인도 폐기.
        self._cwd_history.pop(session_id, None)
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

    async def list_sessions(self) -> list[TmuxSessionInfo]:
        rc, out, _ = await self._run(
            "list-sessions",
            "-F", "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}",
            check=False,
        )
        if rc != 0 or not out:
            return []
        result: list[TmuxSessionInfo] = []
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

    def attach_argv(self, session_id: str) -> list[str]:
        """ws_bridge에서 PTY로 spawn할 때 쓰는 argv. 분리해서 권한·테스트 용이성 확보."""
        return [*self._base_args(), "attach-session", "-t", session_id]

    async def get_pane_cwd(self, session_id: str) -> str | None:
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

    def get_cwd_history(self, session_id: str) -> list[dict]:
        history = self._cwd_history.get(session_id, deque())
        return [{"ts": ts, "cwd": cwd} for ts, cwd in history]


# 전역 인스턴스 (main.py에서 import)
tmux_manager = TmuxManager()
