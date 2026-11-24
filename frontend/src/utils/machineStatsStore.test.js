import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMachineStatsStore,
  MACHINE_STATS_HISTORY_LIMIT,
  MACHINE_STATS_HISTORY_MS,
} from './machineStatsStore';

describe('machineStatsStore', () => {
  const cleanups = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    document.documentElement.removeAttribute('data-eink');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const make = (options = {}) => {
    const fetcher = options.fetcher || vi.fn().mockResolvedValue({ cpu: 30, ram: 40, disk: 50 });
    const visibilityTarget = new EventTarget();
    let hidden = false;
    const store = createMachineStatsStore({
      fetcher, visibilityTarget, isHidden: () => hidden, pollMs: 2000, ...options,
    });
    return {
      store,
      fetcher,
      subscribe(monitoring = false) {
        const unsubscribe = store.subscribe(vi.fn(), { monitoring });
        cleanups.push(unsubscribe);
        return unsubscribe;
      },
      hide(value) {
        hidden = value;
        visibilityTarget.dispatchEvent(new Event('visibilitychange'));
      },
    };
  };

  it('OFF 첫 진입은 한 번만 조회하고 기록을 만들지 않는다', async () => {
    const subject = make();
    const off = subject.subscribe();
    await vi.advanceTimersByTimeAsync(20000);
    expect(subject.fetcher).toHaveBeenCalledTimes(1);
    expect(subject.store.getState().stats.cpu).toBe(30);
    expect(subject.store.getState().history).toEqual([]);
    off();
    subject.subscribe();
    await vi.advanceTimersByTimeAsync(20000);
    expect(subject.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('여러 ON 구독자와 새로고침은 요청과 폴링을 공유한다', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((done) => { resolve = done; }));
    const subject = make({ fetcher });
    const first = subject.subscribe(true);
    subject.subscribe(true);
    subject.store.refresh();
    subject.store.refresh();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve({ cpu: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    first();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('OFF로 바꾸면 남은 요청을 취소하고 늦게 온 응답을 무시한다', async () => {
    let resolve;
    const fetcher = vi.fn().mockResolvedValueOnce({ cpu: 10 })
      .mockImplementation(() => new Promise((done) => { resolve = done; }));
    const subject = make({ fetcher });
    const stopMonitoring = subject.subscribe(true);
    subject.subscribe(false);
    await vi.advanceTimersByTimeAsync(2000);
    const snapshot = subject.store.getState();
    const signal = fetcher.mock.calls[1][0];
    stopMonitoring();
    expect(signal.aborted).toBe(true);
    resolve({ cpu: 90 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(subject.store.getState().stats).toEqual(snapshot.stats);
    expect(subject.store.getState().history).toEqual(snapshot.history);
    expect(subject.store.getState().refreshing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('숨긴 동안 최초 사양 조회도 멈추며 보이면 다시 조회한다', async () => {
    let resolve;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValue({ hostname: 'machine' });
    const subject = make({ fetcher });
    subject.hide(true);
    subject.subscribe();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).not.toHaveBeenCalled();
    subject.hide(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    subject.hide(true);
    expect(fetcher.mock.calls[0][0].aborted).toBe(true);
    resolve({ hostname: 'stale' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(subject.store.getState().stats).toBeNull();
    subject.hide(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.store.getState().stats.hostname).toBe('machine');
    expect(subject.store.getState().history).toEqual([]);
  });

  it('마지막 구독이 끝나면 요청을 취소하고 상태 갱신을 차단한다', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((done) => { resolve = done; }));
    const subject = make({ fetcher });
    const off = subject.subscribe(true);
    off();
    expect(fetcher.mock.calls[0][0].aborted).toBe(true);
    resolve({ cpu: 90 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(subject.store.getState()).toMatchObject({ stats: null, error: false, refreshing: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ON 조회도 숨기면 중지하고 다시 보일 때 즉시 재개한다', async () => {
    const subject = make();
    subject.subscribe(true);
    await vi.advanceTimersByTimeAsync(0);
    subject.hide(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(subject.fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    subject.hide(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.fetcher).toHaveBeenCalledTimes(2);
    expect(subject.store.getState().history).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(subject.fetcher).toHaveBeenCalledTimes(3);
  });

  it('시간 초과는 이전 값을 유지하고 다음 주기에 재시도한다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ cpu: 15 })
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ cpu: 20 });
    const subject = make({ fetcher, timeoutMs: 3000 });
    subject.subscribe(true);
    await vi.advanceTimersByTimeAsync(0);
    const updatedAt = subject.store.getState().updatedAt;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher.mock.calls[1][0].aborted).toBe(true);
    expect(subject.store.getState()).toMatchObject({ stats: { cpu: 15 }, error: true, updatedAt, refreshing: false });
    expect(subject.store.getState().history).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(subject.store.getState()).toMatchObject({ stats: { cpu: 20 }, error: false });
  });

  it('실패 상세를 저장하지 않고 OFF 수동 재조회에 기록을 추가하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ cpu: 10 })
      .mockRejectedValueOnce(new Error('private command content'))
      .mockResolvedValue({ cpu: 20 });
    const subject = make({ fetcher });
    subject.subscribe();
    await vi.advanceTimersByTimeAsync(0);
    await subject.store.refresh();
    expect(subject.store.getState()).toMatchObject({ stats: { cpu: 10 }, error: true });
    expect(JSON.stringify(subject.store.getState())).not.toContain('private');
    await subject.store.refresh();
    expect(subject.store.getState()).toMatchObject({ stats: { cpu: 20 }, history: [], error: false });
  });

  it('기록은 150개와 5분으로 제한하며 누락 값을 0으로 채우지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ cpu: NaN, ram: Infinity, disk: 0, net_tx_rate: '1', cmdline: 'private' });
    const subject = make({ fetcher, pollMs: 1000 });
    const off = subject.subscribe(true);
    await vi.advanceTimersByTimeAsync(200000);
    const history = subject.store.getState().history;
    expect(history).toHaveLength(MACHINE_STATS_HISTORY_LIMIT);
    expect(history[0]).toEqual({ at: expect.any(Number), cpu: null, ram: null, disk: 0, net_rx_rate: null, net_tx_rate: null });
    expect(JSON.stringify(history)).not.toContain('private');
    off();
    await vi.advanceTimersByTimeAsync(MACHINE_STATS_HISTORY_MS + 1);
    subject.subscribe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.store.getState().history).toHaveLength(1);
  });

  it('이북 모드는 폴링 간격을 늘린다', async () => {
    document.documentElement.setAttribute('data-eink', '1');
    const subject = make();
    subject.subscribe(true);
    await vi.advanceTimersByTimeAsync(7999);
    expect(subject.fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subject.fetcher).toHaveBeenCalledTimes(2);
  });

  it('기본 fetcher는 기존 인증 헤더와 취소 신호를 전달한다', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hostname: 'local' }) });
    vi.stubGlobal('fetch', fetch);
    const store = createMachineStatsStore({ isHidden: () => false });
    cleanups.push(store.subscribe(vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith('/api/system/stats', { headers: {}, signal: expect.any(AbortSignal) });
    expect(store.getState().stats).toEqual({ hostname: 'local' });
  });
});
