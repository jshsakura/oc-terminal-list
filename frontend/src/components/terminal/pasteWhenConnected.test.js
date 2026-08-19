import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pasteWhenConnected, PASTE_CONNECT_WAIT_MS } from './terminalHelpers';

/**
 * 업로드는 200 인데 경로가 안 들어가던 버그의 자리. 서버 로그로는 절대 안 보인다 —
 * 업로드가 정말로 성공했기 때문이다. 그래서 여기가 유일한 그물이다.
 */
describe('pasteWhenConnected', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const term = () => ({ paste: vi.fn() });

  it('소켓이 열려 있으면 곧바로 넣는다', async () => {
    const t = term();
    const ok = await pasteWhenConnected(t, '/tmp/a.png ', () => ({ readyState: 1 }));
    expect(ok).toBe(true);
    expect(t.paste).toHaveBeenCalledWith('/tmp/a.png ');
  });

  it('재연결 중이면 기다렸다가 넣는다 — 큐에 넣어두면 4초 뒤 버려진다', async () => {
    const t = term();
    let ws = { readyState: 3 };
    const promise = pasteWhenConnected(t, '/tmp/a.png ', () => ws);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.paste).not.toHaveBeenCalled();
    ws = { readyState: 1 };
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe(true);
    expect(t.paste).toHaveBeenCalledTimes(1);
  });

  it('끝내 안 열리면 넣지 않고 false 를 준다 — 성공한 척하지 않는다', async () => {
    const t = term();
    const promise = pasteWhenConnected(t, '/tmp/a.png ', () => ({ readyState: 3 }));
    await vi.advanceTimersByTimeAsync(PASTE_CONNECT_WAIT_MS + 200);
    await expect(promise).resolves.toBe(false);
    expect(t.paste).not.toHaveBeenCalled();
  });

  it('소켓을 모르는 호출부는 예전처럼 넣는다 — 판정할 근거가 없다', async () => {
    const t = term();
    await expect(pasteWhenConnected(t, 'x', null)).resolves.toBe(true);
    expect(t.paste).toHaveBeenCalledWith('x');
  });

  it('빈 텍스트는 아무 일도 하지 않는다', async () => {
    const t = term();
    await expect(pasteWhenConnected(t, '', () => ({ readyState: 1 }))).resolves.toBe(false);
    expect(t.paste).not.toHaveBeenCalled();
  });
});
