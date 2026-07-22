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
DEFAULT_HISTORY_LIMIT = int(os.getenv("TMUX_HISTORY_LIMIT", "10000"))


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
        env: dict[str, str] | None = None,
    ) -> None:
        """새 detached 세션 생성. 이미 존재하면 no-op.

        `env` 는 `new-session -e` 로 세션 환경에 주입된다(tmux 3.2+). itl CLI 가
        "나는 어느 터미널인가"를 아는 통로다. ⚠️ 여기 넣은 값은 같은 tmux 소켓에
        접근할 수 있으면 `show-environment` 로 읽힌다 — 그래서 ITL_TOKEN 은 용도가
        제한된 scoped 토큰이어야 한다(auth_manager.create_scoped_token).
        """
        if await self.session_exists(session_id):
            logger.debug("tmux session already exists: %s", session_id)
            return

        # history-limit 은 pane 생성(new-session) 시점에 버퍼 크기가 고정된다 — 나중에
        # set-option 으로 키워도 이미 만들어진 '첫 pane' 엔 소급 적용 안 돼 스크롤백이
        # 전역 기본값(2000)에 묶인다. 그래서 new-session 보다 먼저 전역(-g)으로 걸어야 한다.
        #
        # ⚠️  단, tmux 3.4 에서 `set-option -g` 는 서버가 없으면 '띄우지 않고' 에러로 끝난다
        # (start-server 만으로도 세션이 없으면 서버가 즉시 종료됨). 따라서 set-option 과
        # new-session 을 '같은 한 번의 tmux 호출'로 묶어야 콜드 스타트 첫 세션도 큰 한도를
        # 물려받는다. 별도 호출 2번으로 나누면 첫 set-option 이 no-op 되고, new-session 이
        # 기본값(2000)으로 서버를 띄워 첫 pane 이 2000 에 묶이는 버그가 재발한다.
        # (argv 안의 ";" 는 tmux 명령 구분자 — 셸이 아니라 tmux 가 해석한다.)
        args = [
            "set-option", "-g", "history-limit", str(self.history_limit), ";",
            "new-session", "-d",
            "-s", session_id,
            "-x", str(max(cols, 1)),
            "-y", str(max(rows, 1)),
        ]
        if cwd:
            args += ["-c", cwd]
        for key, value in (env or {}).items():
            args += ["-e", f"{key}={value}"]

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
            # pane 타이틀(OSC 0/2)을 클라이언트로 그대로 흘려보낸다.
            # tmux 기본값은 off 라 xterm.js 가 타이틀 변화를 아예 못 본다. on 으로 두면
            # 에이전트가 찍는 상태 타이틀("⠂ 작업중" / "✳ 대기")이 브라우저까지 도달해
            # 폴링 없이 즉시 상태를 알 수 있다 — 원격 호스트 pane 도 같은 경로로 온다.
            # 우리 xterm 엔 타이틀바가 없으므로 화면에는 아무 영향이 없다.
            ("set-titles", "on"),
            ("set-titles-string", "#{pane_title}"),
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
        # WheelUp/Down: alternate_on 으로 분기해야 한다(PageUp 바인딩과 동일한 원리).
        #   - alt-screen 앱(claude/vim/less/htop …): 휠을 `send-keys -M` 으로 앱에 그대로
        #     전달 → 앱이 자기 스크롤을 처리한다. 여기서 copy-mode 로 들어가면 alt 버퍼엔
        #     스크롤백이 없어 "휠 올려도 아무것도 안 움직이는" 것처럼 보이고 앱에도 전달 안 됨.
        #     (mouse off+PgUp→mouse on+SGR휠 전환 때 이 분기를 빠뜨려 claude 안에서 스크롤이
        #      통째로 죽었던 회귀 버그.)
        #   - 일반 셸(normal buffer): copy-mode 진입 + scroll-up 으로 스크롤백을 올린다.
        await self._run(
            "bind-key", "-T", "root", "WheelUpPane",
            "if-shell", "-F", "#{alternate_on}",
            "send-keys -M", "copy-mode -e; send-keys -X -N 5 scroll-up",
            check=False,
        )
        # copy-mode 밖(normal buffer)에서의 WheelDown: alt-screen 이면 앱에 전달, 아니면 무동작
        # (이미 맨 아래라 내릴 게 없음). copy-mode 안에서의 휠은 아래 copy-mode 테이블이 처리.
        await self._run(
            "bind-key", "-T", "root", "WheelDownPane",
            "if-shell", "-F", "#{alternate_on}",
            "send-keys -M", "",
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

    async def send_keys(self, session_id: str, text: str, *, submit: bool = False) -> None:
        """세션에 문자열을 입력한다. `-l` 은 리터럴 — tmux 키 이름 해석을 막는다.

        `submit=False` 가 기본인 이유: 사람이 확인하고 엔터를 치는 편이 안전하다.
        vim/claude 같은 대화형 앱 한가운데에 엔터가 들어가면 의도치 않은 동작이 된다.
        (터미널 파일 드롭이 경로만 넣고 엔터를 안 치는 것과 같은 원칙.)
        """
        if not text:
            return
        # ⚠️ send-keys 의 -t 는 **pane** 타겟이라 `=name` 만으로는 "can't find pane" 이 난다
        # (세션 타겟에서는 되는 문법이라 헷갈린다). `=name:` 로 써야 정확 매칭을 유지하면서
        # "그 세션의 현재 윈도우"로 해소된다.
        target = f"={session_id}:"
        await self._run("send-keys", "-t", target, "-l", text, check=False)
        if submit:
            await self._run("send-keys", "-t", target, "Enter", check=False)

    async def send_key(self, session_id: str, key: str) -> None:
        """tmux 키 이름을 그대로 보낸다 (`C-c`, `Escape`, `Enter` …).

        send_keys 의 `-l`(리터럴)과 반대다 — 리터럴로 보내면 "C-c" 라는 **글자**가
        입력된다. 중단 같은 제어키는 반드시 이 경로여야 한다.
        """
        if not key:
            return
        await self._run("send-keys", "-t", f"={session_id}:", key, check=False)

    async def list_panes_raw(self, pane_format: str) -> str:
        """`list-panes -a -F <format>` 원시 출력.

        tmux 는 OSC 0/2 타이틀을 이미 파싱해 `#{pane_title}` 로 들고 있다 —
        에이전트 상태를 알아내려고 PTY 바이트를 따로 긁을 필요가 없다는 뜻이다.
        서버가 없으면 rc!=0 이고, 그건 정상(세션 0개)이므로 빈 문자열을 준다.
        """
        rc, out, _ = await self._run("list-panes", "-a", "-F", pane_format, check=False)
        return out if rc == 0 else ""

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
