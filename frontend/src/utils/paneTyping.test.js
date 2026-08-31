import { describe, it, expect, vi } from 'vitest';
import { findTerminalSession, isPaneReady, typeIntoPane } from './paneTyping';

const handle = (tabId, state, sendData = vi.fn(() => true)) => ({
  getSessionStatus: () => ({ tabId, paneId: `pane-of-${tabId}` }),
  getConnectionState: () => state,
  sendData,
});

describe('findTerminalSession', () => {
  it('키 형식과 무관하게 탭 id 로 찾는다', () => {
    const registry = { 'whatever-key': handle('t2', 'open') };
    expect(findTerminalSession(registry, { tabId: 't2' })).toBe(registry['whatever-key']);
  });

  it('pane id 로도 찾을 수 있다', () => {
    const registry = { a: handle('t1', 'open') };
    expect(findTerminalSession(registry, { paneId: 'pane-of-t1' })).toBe(registry.a);
  });

  it('정리 중이라 던지는 항목이 있어도 나머지를 찾는다', () => {
    const broken = { getSessionStatus: () => { throw new Error('gone'); } };
    const registry = { a: broken, b: handle('t1', 'open') };
    expect(findTerminalSession(registry, { tabId: 't1' })).toBe(registry.b);
  });

  it('없으면 null', () => {
    expect(findTerminalSession({}, { tabId: 't1' })).toBeNull();
    expect(findTerminalSession(null, { tabId: 't1' })).toBeNull();
  });
});

describe('isPaneReady', () => {
  it('등록만 됐고 아직 연결 중이면 준비된 게 아니다', () => {
    expect(isPaneReady(handle('t1', 'connecting'))).toBe(false);
    expect(isPaneReady(handle('t1', 'open'))).toBe(true);
  });
});

describe('typeIntoPane', () => {
  const immediate = (fn) => { fn(); return 0; };

  it('붙은 뒤에 보낸다 — 그 전에는 보내지 않는다', async () => {
    const send = vi.fn(() => true);
    const registry = {};
    let ticks = 0;
    const setTimeoutFn = (fn) => {
      ticks += 1;
      if (ticks === 3) registry.a = handle('t1', 'open', send);
      fn();
      return 0;
    };
    const ok = await typeIntoPane({ tabId: 't1' }, 'curl x | sh', {
      getRegistry: () => registry, setTimeoutFn,
    });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith('curl x | sh');
    expect(ticks).toBe(3);
  });

  it('엔터를 붙이지 않는다 — 실행은 사용자가 확인한다', async () => {
    const send = vi.fn(() => true);
    const registry = { a: handle('t1', 'open', send) };
    await typeIntoPane({ tabId: 't1' }, 'rm -rf /tmp/x', {
      getRegistry: () => registry, setTimeoutFn: immediate,
    });
    expect(send).toHaveBeenCalledWith('rm -rf /tmp/x');
    expect(send.mock.calls[0][0]).not.toMatch(/[\r\n]/);
  });

  it('시간 안에 안 붙으면 false — 조용히 성공한 척하지 않는다', async () => {
    const ok = await typeIntoPane({ tabId: 't1' }, 'x', {
      getRegistry: () => ({}), setTimeoutFn: immediate, timeoutMs: 360, pollMs: 120,
    });
    expect(ok).toBe(false);
  });
});
