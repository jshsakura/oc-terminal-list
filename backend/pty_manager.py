"""
PTY 세션 매니저: 가상 터미널 프로세스 생성 및 관리
"""
import asyncio
import os
import struct
import fcntl
import termios
import ptyprocess
import codecs
from typing import Dict, Optional
from fastapi import WebSocket
import logging
from dotenv import load_dotenv

# .env 파일 로드 (프로젝트 루트 경로 명시)
_current_file = os.path.abspath(__file__)
_project_root = os.path.dirname(os.path.dirname(_current_file))
_env_path = os.path.join(_project_root, ".env")
load_dotenv(_env_path)

logger = logging.getLogger(__name__)


class SessionInfo:
    """세션 정보 저장 클래스"""

    def __init__(self, process: ptyprocess.PtyProcess, session_id: str, shell: str):
        self.process = process
        self.session_id = session_id
        self.shell = shell
        self.connected_socket: Optional[WebSocket] = None
        self.output_task: Optional[asyncio.Task] = None
        self.cols = 80
        self.rows = 24
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")

    def __repr__(self):
        return f"<Session {self.session_id} pid={self.process.pid} connected={self.connected_socket is not None}>"


class PtyManager:
    """PTY 프로세스 매니저 - 영속적 터미널 세션 관리"""

    def __init__(self, storage=None):
        self.sessions: Dict[str, SessionInfo] = {}
        self.storage = storage
        logger.info("PTY 매니저 초기화됨")

    def session_exists(self, session_id: str) -> bool:
        """세션 존재 여부 확인"""
        return session_id in self.sessions

    def get_session_shell(self, session_id: str) -> Optional[str]:
        """세션에 사용된 shell 경로 반환"""
        session = self.sessions.get(session_id)
        return session.shell if session else None

    def _resolve_shell(self, requested_shell: Optional[str]) -> str:
        shell_candidates = {
            "bash": ["/bin/bash", "/usr/bin/bash"],
            "zsh": ["/bin/zsh", "/usr/bin/zsh"],
            "sh": ["/bin/sh", "/usr/bin/sh"],
        }

        normalized = None
        if isinstance(requested_shell, str):
            raw = requested_shell.strip().lower()
            if raw in shell_candidates:
                normalized = raw
            elif raw in ["auto", ""]:
                normalized = None
            else:
                for shell_name, candidates in shell_candidates.items():
                    if raw in candidates:
                        normalized = shell_name
                        break

        if normalized in shell_candidates:
            for candidate in shell_candidates[normalized]:
                if os.path.exists(candidate) and os.access(candidate, os.X_OK):
                    return candidate

        env_shell = os.getenv("SHELL")
        if env_shell:
            env_shell = env_shell.strip()
            bash_candidates = shell_candidates["bash"]
            if env_shell in bash_candidates and os.path.exists(env_shell) and os.access(env_shell, os.X_OK):
                return env_shell

        for candidate in ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/usr/bin/zsh", "/bin/sh", "/usr/bin/sh"]:
            if os.path.exists(candidate) and os.access(candidate, os.X_OK):
                return candidate

        if env_shell and env_shell in shell_candidates["zsh"] + shell_candidates["sh"]:
            if os.path.exists(env_shell) and os.access(env_shell, os.X_OK):
                return env_shell

        return "/bin/sh"

    async def create_session(self, session_id: str, cols: int = 80, rows: int = 24, cwd: Optional[str] = None, shell: Optional[str] = None) -> bool:
        """새 PTY 세션 생성"""
        if self.session_exists(session_id):
            return True

        # 1. 쉘 결정 (요청값 우선, 이후 환경 변수, 이후 fallback)
        resolved_shell = self._resolve_shell(shell)

        # 2. 시작 디렉토리 확정
        # main.py에서 이미 검증된 절대 경로가 오지만, 다시 한번 확인
        start_dir = cwd if cwd and os.path.exists(cwd) else os.getcwd()

        try:
            # 3. 환경 변수 설정
            env = os.environ.copy()
            env.update({
                "TERM": "xterm-256color",
                "LANG": "ko_KR.UTF-8",
                "LC_ALL": "ko_KR.UTF-8",
                "COLORTERM": "truecolor",
                "SHELL": resolved_shell,
                "HOME": os.path.expanduser("~")
            })

            logger.info(f"Spawning PTY: shell={resolved_shell}, cwd={start_dir}")
            
            # 4. 프로세스 실행 (실패 시 예외가 발생하여 상위로 전달됨)
            process = ptyprocess.PtyProcess.spawn(
                [resolved_shell],
                dimensions=(rows, cols),
                env=env,
                cwd=start_dir
            )

            # 5. 세션 정보 저장
            session_info = SessionInfo(process, session_id, resolved_shell)
            session_info.cols = cols
            session_info.rows = rows
            self.sessions[session_id] = session_info

            # 6. 출력 리더 시작
            session_info.output_task = asyncio.create_task(
                self._output_reader_loop(session_id)
            )

            logger.info(f"PTY Session {session_id} started successfully (PID: {process.pid})")
            return True

        except Exception as e:
            logger.error(f"PTY Spawn Error ({session_id}) at {start_dir}: {str(e)}")
            # 예외를 다시 던져서 main.py에서 상세 사유를 알 수 있게 함
            raise e

    async def attach_session(self, session_id: str, websocket: WebSocket):
        """
        WebSocket을 세션에 연결

        Args:
            session_id: 세션 ID
            websocket: WebSocket 연결
        """
        if not self.session_exists(session_id):
            raise ValueError(f"세션이 존재하지 않음: {session_id}")

        session = self.sessions[session_id]
        session.connected_socket = websocket
        logger.info(f"WebSocket 연결됨: {session_id}")

    async def detach_session(self, session_id: str):
        """
        WebSocket 연결 해제 (프로세스는 유지)

        Args:
            session_id: 세션 ID
        """
        if not self.session_exists(session_id):
            return

        session = self.sessions[session_id]
        session.connected_socket = None
        logger.info(f"WebSocket 연결 해제됨 (프로세스 유지): {session_id}")

    async def write_input(self, session_id: str, data: str):
        """
        사용자 입력을 PTY에 전송

        Args:
            session_id: 세션 ID
            data: 입력 데이터
        """
        if not self.session_exists(session_id):
            logger.warning(f"입력 전송 실패: 세션 없음 ({session_id})")
            return

        session = self.sessions[session_id]
        try:
            # 원본 데이터 그대로 PTY에 전송 (터미널 입력 변조 금지)
            input_bytes = data.encode('utf-8') if isinstance(data, str) else data
            session.process.write(input_bytes)
        except Exception as e:
            logger.error(f"PTY 입력 쓰기 실패 ({session_id}): {e}")

    async def resize(self, session_id: str, cols: int, rows: int):
        """
        터미널 크기 조정

        Args:
            session_id: 세션 ID
            cols: 새 너비
            rows: 새 높이
        """
        if not self.session_exists(session_id):
            return

        session = self.sessions[session_id]
        try:
            # TIOCSWINSZ ioctl로 윈도우 크기 설정
            session.process.setwinsize(rows, cols)
            session.cols = cols
            session.rows = rows
            logger.debug(f"터미널 크기 조정됨: {session_id} ({cols}x{rows})")
        except Exception as e:
            logger.error(f"터미널 크기 조정 실패 ({session_id}): {e}")

    async def kill_session(self, session_id: str):
        """
        세션 강제 종료 및 정리

        Args:
            session_id: 세션 ID
        """
        if not self.session_exists(session_id):
            return

        session = self.sessions[session_id]

        try:
            # 출력 태스크 취소
            if session.output_task:
                session.output_task.cancel()
                try:
                    await session.output_task
                except asyncio.CancelledError:
                    pass

            # 프로세스 종료
            if session.process.isalive():
                session.process.terminate(force=True)
                logger.info(f"프로세스 종료됨: {session_id} (pid={session.process.pid})")

            # SQLite 히스토리 삭제
            if self.storage:
                await self.storage.delete_history(session_id)

            # 세션 제거
            del self.sessions[session_id]
            logger.info(f"세션 삭제됨: {session_id}")

        except Exception as e:
            logger.error(f"세션 종료 실패 ({session_id}): {e}")

    async def _output_reader_loop(self, session_id: str):
        """
        PTY 출력을 지속적으로 읽어서 WebSocket과 SQLite 스토리지로 전송
        [중요] 이 루프는 WebSocket 연결 여부와 무관하게 항상 실행됨
        [최적화] asyncio 이벤트 기반으로 즉시 반응
        """
        session = self.sessions.get(session_id)
        if not session:
            return

        logger.info(f"출력 리더 루프 시작: {session_id}")

        import select
        loop = asyncio.get_event_loop()

        # 데이터를 읽고 전송하는 콜백
        def read_and_send():
            try:
                # select로 데이터 확인 (타임아웃 0 = 즉시)
                r, _, _ = select.select([session.process.fd], [], [], 0)
                if r:
                    data = session.process.read()
                    if data:
                        # 비동기 처리를 위해 태스크 생성
                        asyncio.create_task(process_output(data))
            except:
                pass

        # 출력 데이터 처리 (비동기)
        async def process_output(data):
            try:
                # 점진적 디코더를 사용하여 UTF-8 경계 잘림 문제 해결
                output = session.decoder.decode(data)
                if not output:
                    return

                # SQLite에 저장
                if self.storage:
                    await self.storage.append_history(session_id, output)

                # 연결된 WebSocket이 있으면 전송
                if session.connected_socket:
                    try:
                        await session.connected_socket.send_text(output)
                    except Exception as e:
                        logger.warning(f"WebSocket 전송 실패 ({session_id}): {e}")
                        session.connected_socket = None
            except Exception as e:
                logger.error(f"출력 처리 에러 ({session_id}): {e}")

        # 이벤트 루프에 파일 디스크립터 리더 등록 (데이터 도착 즉시 콜백)
        loop.add_reader(session.process.fd, read_and_send)

        try:
            # 프로세스 상태만 주기적으로 확인 (1초마다)
            while True:
                await asyncio.sleep(1)

                if not session.process.isalive():
                    logger.info(f"프로세스 종료됨: {session_id}")
                    break

        except asyncio.CancelledError:
            logger.info(f"출력 리더 루프 취소됨: {session_id}")
        except Exception as e:
            logger.error(f"출력 리더 루프 예외 ({session_id}): {e}")
        finally:
            # 리더 제거
            try:
                loop.remove_reader(session.process.fd)
            except:
                pass
            logger.info(f"출력 리더 루프 종료: {session_id}")

    def list_sessions(self) -> list:
        """
        활성 세션 목록 반환

        Returns:
            세션 정보 리스트
        """
        return [
            {
                "session_id": sid,
                "pid": session.process.pid if session.process.isalive() else None,
                "alive": session.process.isalive(),
                "connected": session.connected_socket is not None,
                "size": f"{session.cols}x{session.rows}"
            }
            for sid, session in self.sessions.items()
        ]


# 전역 PTY 매니저 인스턴스 (storage는 main.py에서 주입)
pty_manager = PtyManager()
