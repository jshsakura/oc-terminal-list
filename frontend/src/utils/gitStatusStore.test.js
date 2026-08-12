import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGitStatusStore, gitStatusKey, gitStatusUrl } from './gitStatusStore';

describe('gitStatusStore', () => {
  let hidden;
  let fetcher;
  let store;

  const makeStore = (impl) => {
    fetcher = vi.fn(impl || (async (hostId, path) => ({ items: [], branch: 'main', repo: path })));
    return createGitStatusStore({ fetcher, isHidden: () => hidden });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    store = makeStore();
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  it('키를 host/path 로 만들고 URL 을 그에 맞게 고른다', () => {
    expect(gitStatusKey(null, 'a')).toBe('l:a');
    expect(gitStatusKey('h1', '')).toBe('h:h1:');
    expect(gitStatusUrl(null, 'a b')).toBe('/api/git/status?path=a%20b');
    expect(gitStatusUrl('h1', '')).toBe('/api/hosts/h1/git/status');
  });

  it('같은 키의 구독자 여럿이 요청 하나·타이머 하나를 공유한다', async () => {
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe({ path: 'repo', intervalMs: 1000, onData: a });
    store.subscribe({ path: 'repo', intervalMs: 1000, onData: b });
    await vi.advanceTimersByTimeAsync(0);

    // 두 번째 구독은 신선한 캐시를 받아 자기 요청을 내지 않는다.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2); // 틱 1회 = 요청 1회 (구독자 수와 무관)
  });

  it('키가 다르면 따로 폴링한다', async () => {
    store.subscribe({ path: 'a', intervalMs: 1000, onData: vi.fn() });
    store.subscribe({ path: 'b', intervalMs: 1000, onData: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('가장 짧은 간격을 요구한 구독자가 주기를 정하고, 그가 떠나면 되돌아간다', async () => {
    const un = store.subscribe({ path: 'repo', intervalMs: 500, onData: vi.fn() });
    store.subscribe({ path: 'repo', intervalMs: 5000, onData: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockClear();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(4); // 500ms 주기

    un();
    fetcher.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(0); // 이제 5000ms 주기
  });

  it('마지막 구독자가 떠나면 타이머가 멈춘다', async () => {
    const un = store.subscribe({ path: 'repo', intervalMs: 1000, onData: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    un();
    fetcher.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('페이지가 숨겨져 있으면 틱을 건너뛰고, 돌아오면 즉시 갱신한다', async () => {
    store.subscribe({ path: 'repo', intervalMs: 1000, onData: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockClear();

    hidden = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('실패해도 직전 데이터를 지우지 않고 error 만 채운다', async () => {
    let fail = false;
    store.dispose();
    store = makeStore(async () => {
      if (fail) throw new Error('boom');
      return { items: [{ path: 'x' }] };
    });
    const seen = [];
    store.subscribe({ path: 'repo', intervalMs: 1000, onData: (s) => seen.push(s) });
    await vi.advanceTimersByTimeAsync(0);

    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    const last = seen[seen.length - 1];
    expect(last.error).toBe('boom');
    expect(last.data.items).toEqual([{ path: 'x' }]);
  });

  describe('touch — 출력이 멎으면 갱신', () => {
    it('출력이 이어지는 동안은 안 쏘고, 멎은 뒤에 한 번 쏜다', async () => {
      store.subscribe({ path: 'repo', intervalMs: 100000, onData: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(21000); // 스로틀 창을 넘긴다
      fetcher.mockClear();

      // 2초 간격으로 계속 두드림 = 계속 출력 중
      for (let i = 0; i < 5; i += 1) {
        store.touch({ path: 'repo' });
        await vi.advanceTimersByTimeAsync(2000);
      }
      expect(fetcher).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2500); // 멎었다
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('직전 조회가 최근이면 건너뛴다 (스로틀)', async () => {
      store.subscribe({ path: 'repo', intervalMs: 100000, onData: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
      fetcher.mockClear();

      store.touch({ path: 'repo' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetcher).not.toHaveBeenCalled(); // 방금 받아왔으니 조용

      await vi.advanceTimersByTimeAsync(20000);
      store.touch({ path: 'repo' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('아무도 안 보고 있으면 아무것도 안 한다', async () => {
      const un = store.subscribe({ path: 'repo', intervalMs: 100000, onData: vi.fn() });
      await vi.advanceTimersByTimeAsync(21000);
      un();
      fetcher.mockClear();

      store.touch({ path: 'repo' });
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('숨겨진 페이지에서는 안 쏜다', async () => {
      store.subscribe({ path: 'repo', intervalMs: 100000, onData: vi.fn() });
      await vi.advanceTimersByTimeAsync(21000);
      fetcher.mockClear();

      hidden = true;
      store.touch({ path: 'repo' });
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  it('refresh 는 진행 중인 요청과 합쳐진다', async () => {
    let resolve;
    store.dispose();
    store = makeStore(() => new Promise((r) => { resolve = () => r({ items: [] }); }));
    store.subscribe({ path: 'repo', intervalMs: 100000, onData: vi.fn() });
    store.refresh({ path: 'repo' });
    store.refresh({ path: 'repo' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
});
