import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWsConnectGate } from './wsConnectGate';

describe('wsConnectGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('상한까지는 즉시 통과시키고 그 뒤는 줄을 세운다', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 2, maxWaitMs: 10000 });
    const granted = [];
    [0, 1, 2, 3].forEach((i) => { gate.acquire().then((rel) => granted.push([i, rel])); });
    await vi.advanceTimersByTimeAsync(0);

    expect(granted.map(([i]) => i)).toEqual([0, 1]);
    expect(gate.stats()).toEqual({ active: 2, waiting: 2 });
  });

  it('슬롯을 반납하면 다음 대기자가 들어온다', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 1, maxWaitMs: 10000 });
    const granted = [];
    const rel0 = await gate.acquire();
    gate.acquire().then(() => granted.push(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual([]);

    rel0();
    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual([1]);
  });

  it('보이는 pane(priority) 이 대기열을 앞지른다', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 1, maxWaitMs: 10000 });
    const rel0 = await gate.acquire();
    const order = [];
    gate.acquire().then(() => order.push('background'));
    gate.acquire({ priority: true }).then(() => order.push('visible'));
    await vi.advanceTimersByTimeAsync(0);

    rel0();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['visible']);
  });

  it('아무도 슬롯을 안 놓아도 상한 시간 뒤에는 그냥 진행한다 (교착 금지)', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 1, maxWaitMs: 2500 });
    await gate.acquire(); // 영영 반납 안 함
    let got = false;
    gate.acquire().then(() => { got = true; });

    await vi.advanceTimersByTimeAsync(2499);
    expect(got).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(got).toBe(true);
  });

  it('release 는 멱등이다 — 두 번 불러도 슬롯이 늘어나지 않는다', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 2, maxWaitMs: 10000 });
    const rel = await gate.acquire();
    await gate.acquire();
    rel(); rel(); rel();
    expect(gate.stats().active).toBe(1);
  });

  it('호출부가 release 를 잊어도 백스톱이 슬롯을 되돌린다', async () => {
    const gate = createWsConnectGate({ maxConcurrent: 1, maxWaitMs: 100000, autoReleaseMs: 12000 });
    await gate.acquire();
    let got = false;
    gate.acquire().then(() => { got = true; });

    await vi.advanceTimersByTimeAsync(12000);
    expect(got).toBe(true);
  });
});
