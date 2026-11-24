"""Exercise the accepted WebSocket boundary, including final-output ordering."""
from __future__ import annotations

import json

import anyio
import pytest
from fastapi import WebSocket, WebSocketDisconnect
from starlette.types import Message

from output_batching import BATCH_BYTES, batch_terminal_output


class SocketHarness:
    def __init__(self) -> None:
        self.incoming, self.receiver = anyio.create_memory_object_stream[Message](10)
        self.messages: list[Message] = []
        self.bytes_sent = anyio.Event()
        self.closed = anyio.Event()
        self.fail_bytes = False
        self.attempts = 0
        self.socket = WebSocket({'type': 'websocket'}, self.receive, self.send)

    async def receive(self) -> Message:
        return await self.receiver.receive()

    async def send(self, message: Message) -> None:
        if message.get('bytes') is not None:
            self.attempts += 1
            if self.fail_bytes:
                raise WebSocketDisconnect(code=1006)
            self.bytes_sent.set()
        if message['type'] == 'websocket.close':
            self.closed.set()
        self.messages.append(message)

    async def accept(self) -> None:
        await self.incoming.send({'type': 'websocket.connect'})
        await self.socket.accept()

    async def hint(self, socket: WebSocket, paused: bool) -> None:
        text = json.dumps({'type': 'ping', 'render_paused': paused})
        await self.incoming.send({'type': 'websocket.receive', 'text': text})
        assert await socket.receive_text() == text

    def output(self) -> bytes:
        return b''.join(m['bytes'] for m in self.messages if m.get('bytes') is not None)


@pytest.mark.asyncio
async def test_foreground_output_is_immediate_without_a_hint():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await socket.send_bytes(b'echo')
        assert harness.output() == b'echo'


@pytest.mark.asyncio
async def test_paused_output_batches_until_the_size_limit_without_reordering():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'first')
        await socket.send_bytes(b'second')
        assert harness.output() == b''
        await socket.send_bytes(b'x' * BATCH_BYTES)
        assert harness.output() == b'firstsecond' + b'x' * BATCH_BYTES
        assert harness.attempts == 1


@pytest.mark.asyncio
async def test_resume_wakes_pending_output_without_waiting_for_more_data():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'latest')
        await harness.hint(socket, False)
        with anyio.fail_after(1):
            await harness.bytes_sent.wait()
        assert harness.output() == b'latest'


@pytest.mark.asyncio
async def test_control_frames_and_keyboard_input_are_not_batched():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'buffered')
        await socket.send_text('{"type":"pong"}')
        assert harness.messages[-1]['text'] == '{"type":"pong"}'
        assert harness.output() == b''
        await harness.incoming.send({'type': 'websocket.receive', 'text': 'z'})
        assert await socket.receive_text() == 'z'


@pytest.mark.asyncio
async def test_normal_ping_does_not_reset_the_pause_hint():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await harness.incoming.send({'type': 'websocket.receive', 'text': '{"type":"ping"}'})
        await socket.receive_text()
        await socket.send_bytes(b'still buffered')
        assert harness.output() == b''


@pytest.mark.asyncio
async def test_context_exit_drains_the_final_output():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'final output')
    assert harness.output() == b'final output'
    assert harness.attempts == 1


@pytest.mark.asyncio
async def test_cancellation_does_not_flush_buffered_data_after_access_expires():
    harness = SocketHarness()
    await harness.accept()
    with anyio.CancelScope() as scope:
        async with batch_terminal_output(harness.socket) as socket:
            await harness.hint(socket, True)
            await socket.send_bytes(b'not after cancellation')
            scope.cancel()
            await anyio.sleep_forever()
    assert harness.output() == b''


@pytest.mark.asyncio
async def test_close_drains_before_the_close_frame_and_never_sends_after_it():
    harness = SocketHarness()
    await harness.accept()
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'last')
        await socket.close()
    assert harness.output() == b'last'
    assert harness.messages[-1]['type'] == 'websocket.close'
    assert harness.attempts == 1


@pytest.mark.asyncio
async def test_failed_background_send_closes_the_transport_without_retrying_bytes():
    harness = SocketHarness()
    await harness.accept()
    harness.fail_bytes = True
    async with batch_terminal_output(harness.socket) as socket:
        await harness.hint(socket, True)
        await socket.send_bytes(b'fails')
        with anyio.fail_after(1):
            await harness.closed.wait()
        with pytest.raises(WebSocketDisconnect):
            await socket.send_bytes(b'never retry')
    assert harness.attempts == 1
