import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHostCwdBatcher } from './hostCwdBatch';

describe('hostCwdBatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('한 호스트의 pane 들이 요청 하나를 나눠 쓴다', async () => {
    const fetchHostCwds = vi.fn(async () => ({ s1: '/a', s2: '/b', s3: '/c' }));
    const { request } = createHostCwdBatcher({ fetchHostCwds, windowMs: 60 });

    const all = Promise.all([request('h1', 's1'), request('h1', 's2'), request('h1', 's3')]);
    await vi.advanceTimersByTimeAsync(60);

    expect(await all).toEqual(['/a', '/b', '/c']);
    expect(fetchHostCwds).toHaveBeenCalledTimes(1);
  });

  it('호스트가 다르면 각자 요청한다', async () => {
    const fetchHostCwds = vi.fn(async (id) => ({ s1: `/${id}` }));
    const { request } = createHostCwdBatcher({ fetchHostCwds, windowMs: 60 });

    const all = Promise.all([request('h1', 's1'), request('h2', 's1')]);
    await vi.advanceTimersByTimeAsync(60);

    expect(await all).toEqual(['/h1', '/h2']);
    expect(fetchHostCwds).toHaveBeenCalledTimes(2);
  });

  it('맵에 없는 세션은 null — 호출부의 재시도가 이어받는다', async () => {
    const fetchHostCwds = vi.fn(async () => ({ s1: '/a' }));
    const { request } = createHostCwdBatcher({ fetchHostCwds, windowMs: 60 });

    const p = request('h1', 'missing');
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toBeNull();
  });

  it('요청이 실패해도 대기자가 매달리지 않는다', async () => {
    const fetchHostCwds = vi.fn(async () => { throw new Error('502'); });
    const { request } = createHostCwdBatcher({ fetchHostCwds, windowMs: 60 });

    const all = Promise.all([request('h1', 's1'), request('h1', 's2')]);
    await vi.advanceTimersByTimeAsync(60);
    expect(await all).toEqual([null, null]);
  });

  it('창이 닫힌 뒤의 요청은 새 배치가 된다 — 옛 결과를 캐시하지 않는다', async () => {
    const fetchHostCwds = vi.fn(async () => ({ s1: '/a' }));
    const { request } = createHostCwdBatcher({ fetchHostCwds, windowMs: 60 });

    const first = request('h1', 's1');
    await vi.advanceTimersByTimeAsync(60);
    await first;
    const second = request('h1', 's1');
    await vi.advanceTimersByTimeAsync(60);
    await second;

    expect(fetchHostCwds).toHaveBeenCalledTimes(2);
  });
});
