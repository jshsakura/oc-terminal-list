import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFleetStore, FLEET_POLL_MS } from './fleetStore';

/**
 * 이 요청은 백엔드에서 **호스트당 SSH 한 번**이다. 그래서 잠글 것은 화면 내용이 아니라
 * "몇 번 나가는가" 다 — 마운트 수만큼 곱해지면 호스트가 그만큼 두들겨 맞는다.
 */
describe('fleetStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (targets = [{ address: '1.1' }]) => {
    const fetcher = vi.fn().mockResolvedValue(targets);
    return { fetcher, store: createFleetStore({ fetcher, isHidden: () => false, pollMs: 1000 }) };
  };

  it('구독자가 여럿이어도 타이머는 하나다', async () => {
    const { fetcher, store } = make();
    const a = store.subscribe(() => {});
    const b = store.subscribe(() => {});
    const c = store.subscribe(() => {});
    expect(store._timerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    // 첫 구독의 즉시 조회 1회 + 틱 3회. 구독자 수와 무관하다.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
    a(); b(); c();
    expect(store._timerCount()).toBe(0);
  });

  it('아무도 안 보면 아예 나가지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const store = createFleetStore({ fetcher, isHidden: () => true, pollMs: 1000 });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    // 구독 순간의 1회를 빼면 숨은 동안의 틱은 전부 건너뛴다.
    expect(fetcher).toHaveBeenCalledTimes(1);
    off();
  });

  it('두 번째 구독은 신선하면 재조회하지 않는다', async () => {
    const { fetcher, store } = make();
    const off1 = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const off2 = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    off1(); off2();
  });

  it('실패해도 직전 그림을 지우지 않는다 — 빈 판은 "전부 멈췄다" 로 읽힌다', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce([{ address: '1.1' }])
      .mockRejectedValueOnce(new Error('boom'));
    const store = createFleetStore({ fetcher, isHidden: () => false, pollMs: 1000 });
    const seen = [];
    const off = store.subscribe((s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(1500);
    const last = seen[seen.length - 1];
    expect(last.targets).toEqual([{ address: '1.1' }]);
    expect(last.error).toBe('boom');
    off();
  });

  it('동시에 여러 번 불러도 한 번만 나간다', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((r) => { resolve = () => r([]); }));
    const store = createFleetStore({ fetcher, isHidden: () => false, pollMs: 1000 });
    store.refresh(); store.refresh(); store.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve();
  });

  it('기본 주기는 SSH 비용에 맞춰 느리다', () => {
    expect(FLEET_POLL_MS).toBeGreaterThanOrEqual(30000);
  });
});
