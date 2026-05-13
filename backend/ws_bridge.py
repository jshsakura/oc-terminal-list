"""
WebSocket ↔ tmux client PTY 양방향 브리지

각 WebSocket 연결마다 별도의 `tmux attach` PTY를 spawn한다.
- WS 연결 종료 → PTY terminate → tmux 클라이언트만 detach (세션은 유지)
- 같은 session_id에 여러 WS가 동시 attach 가능 (웹/PC 동시 접속)
- 사용자 입력은 그대로 PTY에 write (tmux escape 가공 금지)
- 출력은 chunk 단위로 WS에 send_bytes
"""
from __future__ import annotations

import asyncio
import codecs
import logging
import os
from collections import deque

import ptyprocess
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


READ_CHUNK_FLUSH_BYTES = 65536
MAX_BACKPRESSURE_BYTES = 4 * 1024 * 1024


class TmuxClientBridge:
    """단일 WebSocket과 tmux attach PTY 한 쌍의 라이프사이클."""

    def __init__(self, websocket: WebSocket, session_id: str, attach_argv: list[str], cols: int, rows: int):
        self.websocket = websocket
        self.session_id = session_id
        self.attach_argv = attach_argv
        self.cols = max(int(cols or 80), 1)
        self.rows = max(int(rows or 24), 1)
        self.process: ptyprocess.PtyProcess | None = None
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._closed = asyncio.Event()

    def _spawn(self) -> None:
        env = os.environ.copy()
        env.pop("TMUX", None)
        env.pop("TMUX_PANE", None)
        env.update({
            "TERM": "tmux-256color",
            "COLORTERM": "truecolor",
            "LANG": env.get("LANG") or "ko_KR.UTF-8",
            "LC_ALL": env.get("LC_ALL") or "ko_KR.UTF-8",
        })
        # 클라이언트 PTY를 attach 모드로 spawn — 세션은 이미 존재한다고 가정
        self.process = ptyprocess.PtyProcess.spawn(
            self.attach_argv,
            dimensions=(self.rows, self.cols),
            env=env,
            cwd=os.path.expanduser("~"),
        )
        logger.info(
            "tmux attach client spawned: session=%s pid=%s size=%dx%d",
            self.session_id, self.process.pid, self.cols, self.rows,
        )

    def resize(self, cols: int, rows: int) -> None:
        if not self.process:
            return
        new_cols = max(int(cols or self.cols), 1)
        new_rows = max(int(rows or self.rows), 1)
        if new_cols == self.cols and new_rows == self.rows:
            return
        try:
            self.process.setwinsize(new_rows, new_cols)
            self.cols = new_cols
            self.rows = new_rows
        except Exception as e:
            logger.warning("resize failed (%s): %s", self.session_id, e)

    def write_input(self, data: str) -> None:
        if not self.process:
            return
        try:
            raw = data.encode("utf-8") if isinstance(data, str) else data
            CHUNK = 8192
            off = 0
            while off < len(raw):
                self.process.write(raw[off:off + CHUNK])
                off += CHUNK
        except Exception as e:
            logger.warning("pty write failed (%s): %s", self.session_id, e)

    async def _reader_loop(self) -> None:
        """PTY → WebSocket 출력 펌프. 이벤트 루프 add_reader로 즉시 반응."""
        assert self.process is not None
        process = self.process
        loop = asyncio.get_event_loop()
        pending: deque[bytes] = deque()
        pending_bytes = 0
        flush_task: asyncio.Task | None = None

        def on_readable() -> None:
            nonlocal pending_bytes
            try:
                data = process.read()
            except Exception:
                # PTY 닫힘 또는 EOF
                self._closed.set()
                return
            if not data:
                return
            pending.append(data)
            pending_bytes += len(data)
            # 백프레셔: 너무 쌓이면 가장 오래된 청크 폐기
            while pending_bytes > MAX_BACKPRESSURE_BYTES and len(pending) > 1:
                pending_bytes -= len(pending.popleft())
            nonlocal flush_task
            if flush_task is None or flush_task.done():
                flush_task = asyncio.create_task(_flush())

        async def _flush() -> None:
            nonlocal pending_bytes
            while pending:
                buf: list[bytes] = []
                size = 0
                while pending and size < READ_CHUNK_FLUSH_BYTES:
                    chunk = pending.popleft()
                    buf.append(chunk)
                    size += len(chunk)
                    pending_bytes = max(0, pending_bytes - len(chunk))
                
                try:
                    await self.websocket.send_bytes(b"".join(buf))
                except Exception as e:
                    logger.info("ws send failed, closing bridge (%s): %s", self.session_id, e)
                    self._closed.set()
                    return
                await asyncio.sleep(0)

        try:
            loop.add_reader(process.fd, on_readable)
        except Exception as e:
            logger.error("add_reader failed (%s): %s", self.session_id, e)
            self._closed.set()
            return

        try:
            while not self._closed.is_set():
                if not process.isalive():
                    self._closed.set()
                    break
                await asyncio.sleep(0.5)
        finally:
            try:
                loop.remove_reader(process.fd)
            except Exception:
                pass
            if flush_task:
                try:
                    await flush_task
                except Exception:
                    pass

    async def _writer_loop(self) -> None:
        """WebSocket → PTY 입력 펌프. 제어 메시지는 JSON으로 인식."""
        import json
        try:
            while not self._closed.is_set():
                data = await self.websocket.receive_text()
                # 제어 메시지: {"type":"resize","cols":..,"rows":..}
                stripped = data.strip()
                if stripped.startswith("{") and stripped.endswith("}"):
                    try:
                        msg = json.loads(stripped)
                        if isinstance(msg, dict) and msg.get("type") == "resize":
                            self.resize(int(msg.get("cols", self.cols)), int(msg.get("rows", self.rows)))
                            continue
                    except Exception:
                        pass
                self.write_input(data)
        except WebSocketDisconnect:
            logger.info("ws disconnected: %s", self.session_id)
        except Exception as e:
            logger.warning("ws receive error (%s): %s", self.session_id, e)
        finally:
            self._closed.set()

    async def run(self) -> None:
        """양방향 펌프 동시 실행. 한쪽이 끝나면 다른 쪽도 정리."""
        try:
            self._spawn()
        except Exception as e:
            logger.error("tmux attach spawn failed (%s): %s", self.session_id, e)
            try:
                await self.websocket.close(code=1011, reason=f"tmux attach failed: {e}")
            except Exception:
                pass
            return

        reader = asyncio.create_task(self._reader_loop())
        writer = asyncio.create_task(self._writer_loop())
        try:
            await self._closed.wait()
        finally:
            for t in (reader, writer):
                if not t.done():
                    t.cancel()
            for t in (reader, writer):
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
            self._terminate_pty()

    def _terminate_pty(self) -> None:
        """tmux client만 종료 — 세션은 보존됨."""
        if not self.process:
            return
        try:
            if self.process.isalive():
                self.process.terminate(force=True)
                logger.info("tmux client detached: %s (pid=%s)", self.session_id, self.process.pid)
        except Exception as e:
            logger.warning("pty terminate failed (%s): %s", self.session_id, e)
