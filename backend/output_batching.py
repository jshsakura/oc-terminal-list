"""Coalesce unseen terminal output without delaying input or control frames."""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

import anyio
from fastapi import WebSocket, WebSocketDisconnect
from starlette.types import Message
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)
BATCH_SECONDS: Final = 0.2
BATCH_BYTES: Final = 64 * 1024


class _OutputBatch:
    """Own one bounded byte accumulator and its single flush worker."""

    def __init__(self, socket: WebSocket) -> None:
        self.socket = socket
        self.paused = False
        self.pending = bytearray()
        self.ready = anyio.Event()
        self.wake = anyio.Event()
        self.lock = anyio.Lock()
        self.closed = False
        self.failed = False

    async def receive(self) -> Message:
        message = await self.socket.receive()
        text = message.get("text")
        if (isinstance(text, str) and len(text) <= 256
                and text.startswith("{") and '"render_paused"' in text):
            try:
                control = json.loads(text)
            except json.JSONDecodeError:
                return message
            if isinstance(control, dict) and control.get("type") == "ping":
                paused = control.get("render_paused")
                if isinstance(paused, bool) and paused != self.paused:
                    self.paused = paused
                    if not paused:
                        self.wake.set()
        return message

    async def direct(self, message: Message) -> None:
        async with self.lock:
            with anyio.fail_after(5):
                await self.socket.send(message)

    async def flush(self) -> None:
        async with self.lock:
            if not self.pending or self.closed or self.failed:
                return
            data = bytes(self.pending)
            self.pending.clear()
            with anyio.fail_after(5):
                await self.socket.send({"type": "websocket.send", "bytes": data})

    async def send(self, message: Message) -> None:
        if self.closed or self.failed:
            raise WebSocketDisconnect(code=1001)
        if message["type"] == "websocket.close":
            await self.flush()
            self.closed = True
            await self.direct(message)
            return
        data = message.get("bytes")
        if data is not None and (self.paused or self.pending):
            self.pending.extend(data)
            self.ready.set()
            if not self.paused or len(self.pending) >= BATCH_BYTES:
                self.wake.set()
                await self.flush()
            return
        # The foreground path forwards the original message without copying its bytes.
        await self.direct(message)

    async def run(self) -> None:
        while not self.closed:
            await self.ready.wait()
            if not self.pending:
                self.ready = anyio.Event()
                self.wake = anyio.Event()
                continue
            if self.paused and len(self.pending) < BATCH_BYTES:
                with anyio.move_on_after(BATCH_SECONDS):
                    await self.wake.wait()
            self.ready = anyio.Event()
            self.wake = anyio.Event()
            try:
                await self.flush()
            except (WebSocketDisconnect, RuntimeError, OSError, TimeoutError) as error:
                self.failed = True
                logger.debug("terminal output flush failed: %s", type(error).__name__)
                # Closing the transport also releases a bridge waiting on receive_text.
                with anyio.move_on_after(1):
                    try:
                        await self.socket.close(code=1011)
                    except (WebSocketDisconnect, RuntimeError, OSError):
                        logger.debug("terminal output transport already closed")
                return


@asynccontextmanager
async def batch_terminal_output(socket: WebSocket) -> AsyncIterator[WebSocket]:
    """Wrap an accepted socket; old clients retain the immediate foreground path."""
    batch = _OutputBatch(socket)
    wrapped = WebSocket(socket.scope, batch.receive, batch.send)
    wrapped.client_state = socket.client_state
    wrapped.application_state = socket.application_state
    async with anyio.create_task_group() as tasks:
        tasks.start_soon(batch.run)
        completed = False
        try:
            yield wrapped
            completed = True
        finally:
            # A shell exit must flush its final bytes before the route returns/closes.
            with anyio.move_on_after(5, shield=True):
                if (completed and not batch.failed and socket.client_state == WebSocketState.CONNECTED
                        and socket.application_state == WebSocketState.CONNECTED):
                    try:
                        await batch.flush()
                    except (WebSocketDisconnect, RuntimeError, OSError, TimeoutError) as error:
                        logger.debug("terminal final output flush failed: %s", type(error).__name__)
            batch.closed = True
            batch.pending.clear()
            tasks.cancel_scope.cancel()
