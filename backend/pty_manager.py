"""
PTY 세션 매니저: 가상 터미널 프로세스 생성 및 관리
"""
import asyncio
import os
import struct
import fcntl
import termios
import ptyprocess
from typing import Dict, Optional
from fastapi import WebSocket
import logging

logger = logging.getLogger(__name__)


class SessionInfo:
    """세션 정보 저장 클래스"""

    def __init__(self, process: ptyprocess.PtyProcess, session_id: str):
        self.process = process
        self.session_id = session_id
        self.connected_socket: Optional[WebSocket] = None
        self.output_task: Optional[asyncio.Task] = None
        self.cols = 80
        self.rows = 24

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

    async def create_session(self, session_id: str, cols: int = 80, rows: int = 24) -> SessionInfo:
        """
        새 PTY 세션 생성

        Args:
            session_id: 세션 ID
            cols: 터미널 너비 (컬럼)
            rows: 터미널 높이 (행)

        Returns:
            SessionInfo 객체
        """
        if self.session_exists(session_id):
            logger.warning(f"세션이 이미 존재함: {session_id}")
            return self.sessions[session_id]

        try:
            # 환경 변수 설정 (한글 지원)
            env = os.environ.copy()
            env.update({
                "TERM": "xterm-256color",
                "LANG": "ko_KR.UTF-8",
                "LC_ALL": "ko_KR.UTF-8",
                "COLORTERM": "truecolor"
            })

            # 워크스페이스 디렉토리 설정
            workspace_dir = "/workspace"
            if not os.path.exists(workspace_dir):
                workspace_dir = "/app"  # fallback

            # PTY 프로세스 생성 - bash 실행
            # 사용자의 기본 셸을 사용하거나 bash를 fallback으로
            shell = os.environ.get("SHELL", "/bin/bash")

            process = ptyprocess.PtyProcess.spawn(
                [shell],
                dimensions=(rows, cols),
                env=env,
                cwd=workspace_dir  # 워크스페이스에서 시작
            )

            logger.info(f"PTY 프로세스 생성됨: {session_id} (pid={process.pid}, shell={shell})")

            # 세션 정보 저장
            session_info = SessionInfo(process, session_id)
            session_info.cols = cols
            session_info.rows = rows
            self.sessions[session_id] = session_info

            # 비동기 출력 리더 태스크 시작
            session_info.output_task = asyncio.create_task(
                self._output_reader_loop(session_id)
            )

            return session_info

        except Exception as e:
            logger.error(f"PTY 세션 생성 실패 ({session_id}): {e}")
            raise

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
            # PTY에 데이터 쓰기 (bytes로 변환)
            if isinstance(data, str):
                data = data.encode('utf-8')
            session.process.write(data)
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
        PTY 출력을 지속적으로 읽어서 WebSocket과 Redis로 전송
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
                # 문자열로 디코딩
                try:
                    output = data.decode("utf-8", errors="replace")
                except Exception:
                    output = data.decode("latin-1", errors="replace")

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
