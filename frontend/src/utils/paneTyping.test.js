import { describe, it, expect, vi } from 'vitest';
import {
  findTerminalSession, isPaneReady, didLandOnInputLine, typeIntoPane,
} from './paneTyping';

const handle = (tabId, state, sendData = vi.fn(() => true), inputLine = null) => ({
  getSessionStatus: () => ({ tabId, paneId: `pane-of-${tabId}` }),
  getConnectionState: () => state,
  sendData,
  ...(inputLine === null ? {} : { getInputLine: inputLine }),
});

/** 대기는 즉시 통과시키되 몇 번 불렸는지는 센다 — 테스트가 실시간을 기다리지 않도록. */
const fastWait = () => {
  const calls = { n: 0 };
  return [async () => { calls.n += 1; }, calls];
};

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

describe('didLandOnInputLine', () => {
  const CMD = 'curl -fsSL https://example.dev/install.sh | sh';

  it('프롬프트 뒤에 그대로 들어갔으면 통과', () => {
    expect(didLandOnInputLine(`ubuntu@0 ~ ${CMD}`, CMD)).toBe(true);
  });

  it('접힌 줄을 이어 붙인 공백 차이는 무시한다', () => {
    expect(didLandOnInputLine(`~ curl  -fsSL\thttps://example.dev/install.sh | sh`, CMD)).toBe(true);
  });

  /* 이 테스트가 이 파일의 존재 이유다 — oh-my-zsh 의 `[Y/n]` 이 첫 글자를 먹은 그 줄.
     명령 전체가 화면에는 에코돼 있으므로 `includes` 로 재면 통과해 버린다. */
  it('첫 글자가 프롬프트에 먹힌 줄은 통과시키지 않는다', () => {
    const eaten = `[oh-my-zsh] Would you like to update? [Y/n] ${CMD} ubuntu@0 ~ url -fsSL https://example.dev/install.sh | sh`;
    expect(eaten.includes(CMD)).toBe(true); // 화면 검색으로는 못 가린다
    expect(didLandOnInputLine(eaten, CMD)).toBe(false);
  });

  it('빈 명령은 언제나 false', () => {
    expect(didLandOnInputLine('anything', '')).toBe(false);
  });
});

describe('typeIntoPane', () => {
  const CMD = 'curl x | sh';

  it('붙은 뒤에 보낸다 — 그 전에는 보내지 않는다', async () => {
    const send = vi.fn(() => true);
    const registry = {};
    let ticks = 0;
    const wait = async () => {
      ticks += 1;
      if (ticks === 3) registry.a = handle('t1', 'open', send, () => `~ ${CMD}`);
    };
    const res = await typeIntoPane({ tabId: 't1' }, CMD, { getRegistry: () => registry, wait });
    expect(res).toEqual({ ok: true, verified: true });
    expect(send).toHaveBeenCalledWith(CMD);
  });

  it('엔터를 붙이지 않는다 — 실행은 사용자가 확인한다', async () => {
    const send = vi.fn(() => true);
    const registry = { a: handle('t1', 'open', send, () => `~ rm -rf /tmp/x`) };
    const [wait] = fastWait();
    await typeIntoPane({ tabId: 't1' }, 'rm -rf /tmp/x', { getRegistry: () => registry, wait });
    expect(send).toHaveBeenCalledWith('rm -rf /tmp/x');
    expect(send.mock.calls[0][0]).not.toMatch(/[\r\n]/);
  });

  it('시간 안에 안 붙으면 no-pane — 조용히 성공한 척하지 않는다', async () => {
    const [wait] = fastWait();
    const res = await typeIntoPane({ tabId: 't1' }, 'x', {
      getRegistry: () => ({}), wait, timeoutMs: 360, pollMs: 120,
    });
    expect(res).toEqual({ ok: false, reason: 'no-pane' });
  });

  /* 회귀: 셸 rc 프롬프트가 첫 글자를 먹었다. 보낸 것으로 성공을 선언하면
     사용자는 `url: command not found` 를 보고 설치 스크립트를 의심하게 된다. */
  it('입력 줄에 안 들어갔으면 not-typed 로 실패한다', async () => {
    const send = vi.fn(() => true);
    // 커서가 앉은 줄은 프롬프트 줄이고, 거기에는 첫 글자가 먹힌 `url x | sh` 만 있다.
    const eaten = () => `[oh-my-zsh] Would you like to update? [Y/n] ${CMD}\n~ url x | sh`;
    const registry = { a: handle('t1', 'open', send, eaten) };
    const [wait] = fastWait();
    const res = await typeIntoPane({ tabId: 't1' }, CMD, {
      getRegistry: () => registry, wait, verifyMs: 240, pollMs: 120,
    });
    expect(send).toHaveBeenCalled();
    expect(res).toEqual({ ok: false, reason: 'not-typed' });
  });

  it('셸이 조용해질 때까지 기다렸다 보낸다', async () => {
    const send = vi.fn(() => true);
    let line = 'rc still running…';
    let ticks = 0;
    const registry = { a: handle('t1', 'open', send, () => line) };
    const wait = async () => {
      ticks += 1;
      if (ticks < 4) line = `busy ${ticks}`;      // 계속 변한다 = 아직 우리 차례 아님
      else if (send.mock.calls.length === 0) line = '~ ';   // 조용해짐
      else line = `~ ${CMD}`;                      // 보낸 뒤 에코
    };
    const res = await typeIntoPane({ tabId: 't1' }, CMD, {
      getRegistry: () => registry, wait, settleQuietMs: 240, pollMs: 120,
    });
    expect(res.ok).toBe(true);
    expect(ticks).toBeGreaterThanOrEqual(4);
  });

  it('확인할 수단이 없는 낡은 핸들이면 verified:false 로 통과시킨다', async () => {
    const send = vi.fn(() => true);
    const registry = { a: handle('t1', 'open', send) }; // getInputLine 없음
    const [wait] = fastWait();
    const res = await typeIntoPane({ tabId: 't1' }, CMD, { getRegistry: () => registry, wait });
    expect(res).toEqual({ ok: true, verified: false });
  });

  it('소켓이 이미 닫혔으면 send-failed', async () => {
    const registry = { a: handle('t1', 'open', vi.fn(() => false), () => '~ ') };
    const [wait] = fastWait();
    const res = await typeIntoPane({ tabId: 't1' }, CMD, { getRegistry: () => registry, wait });
    expect(res).toEqual({ ok: false, reason: 'send-failed' });
  });
});
