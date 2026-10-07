import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createInputQueue from './createInputQueue';

describe('createInputQueue command submission boundary', () => {
  let socket;
  let input;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    socket = { readyState: WebSocket.OPEN, bufferedAmount: 0, send: vi.fn() };
    input = createInputQueue({
      getSocket: () => socket,
      getLastRecvAt: () => Date.now(),
    });
  });

  afterEach(() => {
    input.dispose();
    vi.useRealTimers();
  });

  it('sends command text first and Enter in a later PTY write', () => {
    input.enqueue('ask codex\r', { separateTrailingEnterMs: 40 });

    vi.advanceTimersByTime(0);
    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(['ask codex']);

    vi.advanceTimersByTime(39);
    expect(socket.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(['ask codex', '\r']);
  });

  it('clearing for view mode cancels queued input and delayed Enter without disabling later input', () => {
    input.enqueue('pending\r', { separateTrailingEnterMs: 40 });
    vi.advanceTimersByTime(0);
    expect(socket.send).toHaveBeenCalledWith('pending');
    input.clear();
    vi.advanceTimersByTime(100);
    expect(socket.send).not.toHaveBeenCalledWith('\r');
    socket.readyState = WebSocket.CLOSED;
    input.enqueue('offline input');
    input.clear();
    socket.readyState = WebSocket.OPEN;
    input.enqueue('new input');
    vi.advanceTimersByTime(100);
    expect(socket.send).not.toHaveBeenCalledWith('offline input');
    expect(socket.send).toHaveBeenCalledWith('new input');
  });

  it('keeps the delayed Enter next to a priority command', () => {
    input.enqueue('old input');
    input.enqueue('ask codex\r', { priority: true, separateTrailingEnterMs: 40 });

    vi.advanceTimersByTime(0);
    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(['ask codex']);

    vi.advanceTimersByTime(40);
    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(['ask codex', '\r', 'old input']);
  });

  it('keeps rapid priority commands as atomic FIFO groups', () => {
    input.enqueue('first\r', { priority: true, separateTrailingEnterMs: 40 });
    vi.advanceTimersByTime(0);

    input.enqueue('second\r', { priority: true, separateTrailingEnterMs: 40 });
    vi.advanceTimersByTime(40);

    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(['first', '\r', 'second', '\r']);
  });
});
