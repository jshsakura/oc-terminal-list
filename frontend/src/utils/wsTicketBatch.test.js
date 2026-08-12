import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWsTicketBatcher } from './wsTicketBatch';

describe('wsTicketBatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const okBatch = (paths) => ({
    ok: true,
    status: 200,
    tickets: paths.map((p, i) => ({ ticket: `t${i}:${p}`, expires_at: 0 })),
  });

  it('창 안에 몰린 요청을 POST 한 번으로 묶는다', async () => {
    const postBatch = vi.fn(async (paths) => okBatch(paths));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 30 });

    const results = Promise.all([request('/ws/a'), request('/ws/b'), request('/ws/c')]);
    await vi.advanceTimersByTimeAsync(30);
    const [a, b, c] = await results;

    expect(postBatch).toHaveBeenCalledTimes(1);
    expect(postBatch).toHaveBeenCalledWith(['/ws/a', '/ws/b', '/ws/c']);
    expect(a.ticket).toBe('t0:/ws/a');
    expect(b.ticket).toBe('t1:/ws/b');
    expect(c.ticket).toBe('t2:/ws/c');
  });

  it('같은 경로가 여러 번 와도 각자 다른 티켓을 받는다 (단일 사용이라 공유 금지)', async () => {
    const postBatch = vi.fn(async (paths) => okBatch(paths));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 30 });

    const results = Promise.all([request('/ws/host/h1'), request('/ws/host/h1')]);
    await vi.advanceTimersByTimeAsync(30);
    const [a, b] = await results;

    expect(postBatch).toHaveBeenCalledWith(['/ws/host/h1', '/ws/host/h1']);
    expect(a.ticket).not.toBe(b.ticket);
  });

  it('창 밖의 요청은 다음 배치로 간다', async () => {
    const postBatch = vi.fn(async (paths) => okBatch(paths));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 30 });

    const first = request('/ws/a');
    await vi.advanceTimersByTimeAsync(30);
    await first;
    const second = request('/ws/b');
    await vi.advanceTimersByTimeAsync(30);
    await second;

    expect(postBatch).toHaveBeenCalledTimes(2);
  });

  it('maxBatch 를 넘으면 기다리지 않고 바로 보낸다', async () => {
    const postBatch = vi.fn(async (paths) => okBatch(paths));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 1000, maxBatch: 2 });

    const results = Promise.all([request('/ws/a'), request('/ws/b')]);
    await vi.advanceTimersByTimeAsync(0);
    await results;
    expect(postBatch).toHaveBeenCalledTimes(1);
  });

  it('401 이면 모든 대기자가 authExpired 를 받는다', async () => {
    const postBatch = vi.fn(async () => ({ ok: false, status: 401, tickets: null }));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 10 });

    const results = Promise.all([request('/ws/a'), request('/ws/b')]);
    await vi.advanceTimersByTimeAsync(10);
    const [a, b] = await results;
    expect(a).toEqual({ ticket: null, authExpired: true });
    expect(b).toEqual({ ticket: null, authExpired: true });
  });

  it('네트워크 실패(=wedge)면 authExpired 없이 티켓만 없다 — 쿠키 폴백이 이어받는다', async () => {
    const postBatch = vi.fn(async () => { throw new Error('timeout'); });
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 10 });

    const p = request('/ws/a');
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ ticket: null, authExpired: false });
  });

  it('응답 배열이 요청보다 짧아도 그 자리만 null 이 된다', async () => {
    const postBatch = vi.fn(async () => ({ ok: true, status: 200, tickets: [{ ticket: 'only' }] }));
    const { request } = createWsTicketBatcher({ postBatch, windowMs: 10 });

    const results = Promise.all([request('/ws/a'), request('/ws/b')]);
    await vi.advanceTimersByTimeAsync(10);
    const [a, b] = await results;
    expect(a.ticket).toBe('only');
    expect(b).toEqual({ ticket: null, authExpired: false });
  });
});
