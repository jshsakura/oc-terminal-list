import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { killRemoteSession } from './killRemoteSession';

/* ⚠️ 실측 사고. 탭 닫기의 kill 이 `.catch(() => {})` 였다 — 백엔드가 재시작 중이거나
   연결이 막혀 있으면 **닫은 탭의 세션이 조용히 살아남았고**, 그건 다음에 홈의 "이어할 수
   있는 세션" 에 나타나 "닫았는데 왜 엉뚱한 게 올라오나" 가 됐다. */
describe('killRemoteSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const run = (promise) => {
    // 재시도 사이의 대기를 흘려보낸다.
    const flush = async () => { for (let i = 0; i < 8; i += 1) { await vi.advanceTimersByTimeAsync(20000); } };
    return Promise.all([promise, flush()]).then(([r]) => r);
  };

  it('한 번에 되면 한 번만 부른다', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await run(killRemoteSession('h1', 's1'))).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('못 닿으면 다시 시도하고, 살아나면 성공으로 끝난다', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      n += 1;
      if (n < 3) return Promise.reject(new Error('network'));
      return Promise.resolve({ ok: true, status: 200 });
    }));
    expect(await run(killRemoteSession('h1', 's1'))).toBe(true);
    expect(n).toBe(3);
  });

  it('끝내 못 닿으면 false — 호출부가 사용자에게 말해야 한다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await run(killRemoteSession('h1', 's1'))).toBe(false);
  });

  it('서버가 답을 한 거절(4xx)은 붙잡지 않는다 — 다시 보내도 같은 답이다', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: false, status: 403 }));
    vi.stubGlobal('fetch', f);
    expect(await run(killRemoteSession('h1', 's1'))).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('404 는 성공이다 — 호스트가 없으면 지울 것도 없다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
    expect(await run(killRemoteSession('h1', 's1'))).toBe(true);
  });

  it('5xx 는 다시 시도한다 — 백엔드가 재시작 중인 창이다', async () => {
    const f = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', f);
    expect(await run(killRemoteSession('h1', 's1'))).toBe(false);
    expect(f.mock.calls.length).toBeGreaterThan(1);
  });
});
