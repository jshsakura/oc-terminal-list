import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, timeoutSignal, DEFAULT_API_TIMEOUT_MS } from './apiFetch';

describe('apiFetch', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
    global.fetch = vi.fn(async () => ({ ok: true }));
  });
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  it('기본으로 마감시한을 붙인다', async () => {
    await apiFetch('/api/x');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeDefined();
  });

  it('timeoutMs: 0 이면 안 붙인다 — 업로드·git push 처럼 길이가 정해지지 않은 것들', async () => {
    await apiFetch('/api/upload', { timeoutMs: 0, method: 'POST' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeUndefined();
    expect(opts.method).toBe('POST');
    expect(opts.timeoutMs).toBeUndefined(); // fetch 로 새어나가지 않는다
  });

  it('호출부가 준 signal 을 덮어쓰지 않는다', async () => {
    const controller = new AbortController();
    await apiFetch('/api/x', { signal: controller.signal });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBe(controller.signal);
  });

  it('나머지 옵션은 그대로 넘긴다', async () => {
    await apiFetch('/api/x', { method: 'PUT', headers: { a: '1' }, body: 'b' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(opts.method).toBe('PUT');
    expect(opts.headers).toEqual({ a: '1' });
    expect(opts.body).toBe('b');
  });

  it('실제 abort 가능한 signal 을 돌려준다', () => {
    /* 네이티브 AbortSignal.timeout 은 **플랫폼 타이머**를 쓴다 — 가짜 타이머로 못 밀고,
       실시간으로 재우면 러너가 붐빌 때 흔들린다(실제로 그렇게 깜빡였다). 여기서는 계약만
       확인하고, 시한이 진짜 걸리는지는 아래 폴백 테스트가 가짜 타이머로 결정적으로 잰다. */
    const signal = timeoutSignal(50);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('AbortSignal.timeout 이 없는 브라우저(구형 iOS)에서도 시한이 걸린다', async () => {
    vi.useFakeTimers();
    const original = AbortSignal.timeout;
    // eslint-disable-next-line no-undef
    AbortSignal.timeout = undefined;
    try {
      const signal = timeoutSignal(50);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      expect(signal.aborted).toBe(true);
    } finally {
      AbortSignal.timeout = original;
      vi.useRealTimers();
    }
  });

  it('기본 시한은 유한하다', () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_API_TIMEOUT_MS)).toBe(true);
  });
});
