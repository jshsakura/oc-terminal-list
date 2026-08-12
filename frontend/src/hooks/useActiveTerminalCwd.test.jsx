import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useActiveTerminalCwd from './useActiveTerminalCwd';

/* Local cwd goes through the shared batcher (utils/hostCwdBatch), so the mocked
   response is the batch shape and every assertion has to advance past the batch
   window — a lookup is never synchronous any more. */
const BATCH_WINDOW_MS = 60;

const batchOf = (map) => ({ ok: true, json: async () => ({ cwds: map }) });

describe('useActiveTerminalCwd', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('cwd 를 끝내 못 받아도 재시도 사다리는 끝이 있다', async () => {
    // 예전엔 30s 캡에서 영원히 돌았다 — pane 하나가 분당 2회(원격이면 SSH 왕복)를 영구히 태웠다.
    global.fetch = vi.fn(async () => batchOf({}));
    renderHook(() => useActiveTerminalCwd({ sessionId: 's1', isLocal: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });

    // 최초 1회 + MAX_CWD_RETRIES(5)
    expect(global.fetch).toHaveBeenCalledTimes(6);
  });

  it('cwd 를 받으면 그 자리에서 멈춘다', async () => {
    global.fetch = vi.fn(async () => batchOf({ s1: { cwd: '/home/me', in_workspace: false } }));
    const { result } = renderHook(() => useActiveTerminalCwd({ sessionId: 's1', isLocal: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.absolutePath).toBe('/home/me');
  });

  it('같은 순간에 뜬 pane 들은 요청 하나를 나눠 쓴다', async () => {
    global.fetch = vi.fn(async () => batchOf({
      s1: { cwd: '/a', in_workspace: false },
      s2: { cwd: '/b', in_workspace: false },
    }));
    const a = renderHook(() => useActiveTerminalCwd({ sessionId: 's1', isLocal: true }));
    const b = renderHook(() => useActiveTerminalCwd({ sessionId: 's2', isLocal: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS); });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a.result.current.absolutePath).toBe('/a');
    expect(b.result.current.absolutePath).toBe('/b');
  });

  it('refreshSignal 이 바뀌면(=세션이 붙으면) 사다리를 새로 시작한다', async () => {
    global.fetch = vi.fn(async () => batchOf({}));
    const { rerender } = renderHook(
      ({ sig }) => useActiveTerminalCwd({ sessionId: 's1', isLocal: true, refreshSignal: sig }),
      { initialProps: { sig: '0:0' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(global.fetch).toHaveBeenCalledTimes(6);

    global.fetch.mockClear();
    rerender({ sig: '0:1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deferMs 가 있으면 첫 조회를 미루고, 0 이 되면 즉시 조회한다', async () => {
    global.fetch = vi.fn(async () => batchOf({ s1: { cwd: '/x', in_workspace: false } }));
    const { rerender } = renderHook(
      ({ d }) => useActiveTerminalCwd({ sessionId: 's1', isLocal: true, deferMs: d }),
      { initialProps: { d: 2000 } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(global.fetch).not.toHaveBeenCalled();

    rerender({ d: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
