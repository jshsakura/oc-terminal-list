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
# 청크 개수 하드 캡 — PTY가 잘게 (1~수십 byte) 자주 emit 하는 비정상 케이스에서
# bytes 기준 cap 도달 전에 deque 자체가 수만 entry 로 부풀어오르는 걸 막는 방어선.
MAX_PENDING_ITEMS = 8192


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
        # "이 소켓에는 더 이상 쓸 수 없다" — `_closed` 와 **일부러 구분한다**.
        # `_closed` 는 PTY EOF(셸이 exit)로도 서는데, 그때는 소켓이 멀쩡하므로
        # 마지막 출력을 끝까지 흘려보내야 한다. 반대로 소켓이 죽은 뒤의 send 는
        # 무조건 막아야 한다. 하나로 합치면 둘 중 하나가 반드시 깨진다.
        self._ws_gone = asyncio.Event()
        # 출력 펌프(send_bytes)와 pong 응답(send_text)이 서로 다른 task 에서
        # 동시에 send 하지 않도록 직렬화.
        self._send_lock = asyncio.Lock()

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
        try:
            os.set_blocking(self.process.fd, False)
        except Exception as e:
            logger.warning("failed to set pty nonblocking (%s): %s", self.session_id, e)
        logger.info(
            "tmux attach client spawned: session=%s pid=%s size=%dx%d",
            self.session_id, self.process.pid, self.cols, self.rows,
        )

    async def send_control(self, text: str) -> None:
        """제어용 JSON 텍스트를 출력 펌프와 직렬화해 보낸다(ws_ticket 푸시 등)."""
        if self._ws_gone.is_set():
            return
        try:
            async with self._send_lock:
                await self.websocket.send_text(text)
        except Exception as e:
            logger.debug("control send failed (%s): %s", self.session_id, e)
            self._ws_gone.set()

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

    async def write_input(self, data: str) -> None:
        """WS → PTY 입력. ptyprocess.write 는 부분 write 가능(PTY buffer full / EAGAIN)
        → 반환 바이트 수만큼만 진행하고 이벤트 루프에 양보 후 retry 해 손실 방지.

        대용량 paste 에서 여기서 동기 sleep/while 로 오래 붙잡으면 PTY 출력 펌프가
        drain 을 못 해 양방향 버퍼가 서로 막힌다. 특히 bracketed paste 끝 marker 가
        잘리면 tmux 세션이 paste 상태로 남아 재접속 후 입력까지 먹힐 수 있다.
        """
        if not self.process:
            return
        try:
            raw = data.encode("utf-8") if isinstance(data, str) else data
            CHUNK = 8192
            off = 0
            while off < len(raw):
                piece = raw[off:off + CHUNK]
                attempt = 0
                while piece:
                    try:
                        n = os.write(self.process.fd, piece)
                    except OSError as e:
                        # EAGAIN (BlockingIOError) — 이벤트 루프에 양보하고 같은 piece 재시도.
                        if getattr(e, "errno", None) in (11, 35):
                            attempt += 1
                            if attempt % 500 == 0:
                                logger.warning("pty write backpressure persists (%s)", self.session_id)
                            await asyncio.sleep(0.002)
                            continue
                        raise
                    if not isinstance(n, int) or n <= 0:
                        # 일부 ptyprocess 빌드는 None / 0 반환 — 모두 보낸 것으로 간주.
                        break
                    if n >= len(piece):
                        break
                    piece = piece[n:]
                    attempt = 0
                off += CHUNK
                await asyncio.sleep(0)
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
            # 소켓이 죽은 뒤에는 읽지도, flush task 를 만들지도 않는다.
            #
            # 이게 없으면 이렇게 된다(실측 로그 그대로): send 하나가 실패해
            # `_closed` 가 서지만, 이 루프는 `_closed` 를 0.5초 주기로만 보므로
            # remove_reader 까지 최대 500ms 가 남는다. 그 사이 tmux attach 는 계속
            # 출력을 뱉고, 실패한 flush task 는 이미 done() 이라 청크마다 **새 task**
            # 가 생겨 죽은 소켓에 계속 send 한다 →
            # "Unexpected ASGI message 'websocket.send', after sending
            # 'websocket.close'." 가 100ms 간격으로 쌓인다.
            if self._ws_gone.is_set():
                self._closed.set()
                return
            try:
                data = process.read()
            except OSError as e:
                if getattr(e, "errno", None) in (11, 35):
                    return
                self._closed.set()
                return
            except Exception:
                # PTY 닫힘 또는 EOF
                self._closed.set()
                return
            if not data:
                return
            pending.append(data)
            pending_bytes += len(data)
            # 백프레셔: 너무 쌓이면 가장 오래된 청크 폐기 (byte 또는 item 기준)
            while (pending_bytes > MAX_BACKPRESSURE_BYTES or len(pending) > MAX_PENDING_ITEMS) and len(pending) > 1:
                pending_bytes -= len(pending.popleft())
            nonlocal flush_task
            if flush_task is None or flush_task.done():
                flush_task = asyncio.create_task(_flush())

        async def _flush() -> None:
            nonlocal pending_bytes
            while pending:
                # 배치 사이마다 다시 본다 — 이 루프는 send 마다 await 로 양보하므로
                # 그 틈에 소켓이 죽을 수 있다.
                if self._ws_gone.is_set():
                    pending.clear()
                    pending_bytes = 0
                    return
                buf: list[bytes] = []
                size = 0
                while pending and size < READ_CHUNK_FLUSH_BYTES:
                    chunk = pending.popleft()
                    buf.append(chunk)
                    size += len(chunk)
                    pending_bytes = max(0, pending_bytes - len(chunk))

                try:
                    async with self._send_lock:
                        await self.websocket.send_bytes(b"".join(buf))
                except Exception as e:
                    logger.info("ws send failed, closing bridge (%s): %s", self.session_id, e)
                    self._ws_gone.set()
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
                # sleep(0.5) 가 아니라 이벤트를 기다린다 — 0.5s 는 PTY liveness 를
                # 확인하는 주기일 뿐이고, `_closed` 가 서면 즉시 빠져나와야 죽은
                # 소켓에 쓰는 창이 좁아진다.
                try:
                    await asyncio.wait_for(self._closed.wait(), timeout=0.5)
                except TimeoutError:
                    pass
        finally:
            try:
                loop.remove_reader(process.fd)
            except Exception:
                pass
            # 남은 출력을 흘려보낸다(셸이 exit 하며 마지막으로 찍은 것). 소켓이 이미
            # 죽었으면 `_flush` 가 스스로 버리고 즉시 돌아온다.
            #
            # ⚠️ `except Exception` 으로는 부족하다. CancelledError 는 BaseException
            # 이라 안 잡히는데, 이 finally 는 run() 이 이 task 를 cancel 해서 도는
            # 자리다 — 여기서 CancelledError 가 새면 **flush task 가 고아로 남아**
            # 소켓이 닫힌 뒤에 send 한다. 그래서 무슨 일이 있어도 회수한다.
            if flush_task:
                try:
                    await flush_task
                except BaseException:
                    pass
                finally:
                    if not flush_task.done():
                        flush_task.cancel()

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
                    except Exception:
                        msg = None
                    if isinstance(msg, dict):
                        mtype = msg.get("type")
                        if mtype == "resize":
                            try:
                                self.resize(int(msg.get("cols", self.cols)), int(msg.get("rows", self.rows)))
                            except Exception as e:
                                logger.debug("resize control ignored (%s): %s", self.session_id, e)
                            continue
                        # 클라이언트 하트비트 — half-open 소켓 감지용. PTY 로 흘리지 않고 pong 응답.
                        if mtype == "ping":
                            try:
                                async with self._send_lock:
                                    await self.websocket.send_text('{"type":"pong"}')
                            except Exception as e:
                                logger.debug("pong send failed (%s): %s", self.session_id, e)
                                self._ws_gone.set()
                            continue
                await self.write_input(data)
        except WebSocketDisconnect:
            logger.info("ws disconnected: %s", self.session_id)
            self._ws_gone.set()
        except Exception as e:
            logger.warning("ws receive error (%s): %s", self.session_id, e)
            self._ws_gone.set()
        finally:
            self._closed.set()

    async def run(self) -> None:
        """양방향 펌프 동시 실행. 한쪽이 끝나면 다른 쪽도 정리."""
        try:
            self._spawn()
        except Exception as e:
            logger.error("tmux attach spawn failed (%s): %s", self.session_id, e)
            self._ws_gone.set()
            try:
                await self.websocket.close(code=1011, reason="세션 연결에 실패했습니다.")
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
            # 펌프를 다 거둔 뒤에야 세운다 — 그 전에 세우면 reader 의 마지막 drain
            # (셸이 exit 하며 찍은 출력)이 통째로 버려진다. 여기서부터는 라우트가
            # 곧 반환하고 starlette 이 close 를 보내므로, 뒤늦게 살아있는 어떤
            # task 도(예: 티켓 푸셔) 이 소켓에 쓰면 안 된다.
            self._ws_gone.set()
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
