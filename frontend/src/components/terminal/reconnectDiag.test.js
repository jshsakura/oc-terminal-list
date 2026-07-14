import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordDisconnect, recordReconnect } from './reconnectDiag';

/* 진단의 목적은 단 하나 — "정상 절전(grace-close)" 과 "진짜 장애" 를 구분하는 것.
   백엔드 로그만으론 둘이 똑같이 보여서 원인 추적이 막혔다. */

describe('reconnectDiag', () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const base = { sessionId: 's1', code: 1006, wasClean: false, silentMs: 500, attempts: 0 };

  it('비활성 절전(grace-close)은 정상이므로 경고하지 않는다', () => {
    recordDisconnect({ ...base, graceClosed: true, intentional: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('네트워크가 끊은 것(1006)은 경고한다', () => {
    recordDisconnect({ ...base, code: 1006, intentional: false, graceClosed: false });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('네트워크/터널이 끊음');
  });

  // 하트비트 오탐 = 멀쩡한 소켓을 12s 무응답으로 오인해 끊는 것. 구분이 되어야 잡을 수 있다.
  it('하트비트가 죽인 소켓은 오탐 의심으로 표시한다', () => {
    recordDisconnect({ ...base, heartbeatKilled: true, silentMs: 12500, intentional: false, graceClosed: false });
    expect(warn.mock.calls[0][0]).toContain('heartbeat-timeout');
    expect(warn.mock.calls[0][0]).toContain('오탐 의심');
  });

  it('계획된 절전에서 돌아온 것은 "복구" 로 시끄럽게 알리지 않는다', () => {
    recordReconnect({ sessionId: 's1', outageMs: 60000, attempts: 0, planned: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('진짜 장애에서 오래 걸려 복구되면 걸린 시간을 알린다', () => {
    recordReconnect({ sessionId: 's1', outageMs: 47000, attempts: 5, planned: false });
    expect(warn.mock.calls[0][0]).toContain('47.0s');
  });

  it('1초 안에 붙은 건 사용자가 못 느끼므로 조용히 넘어간다', () => {
    recordReconnect({ sessionId: 's1', outageMs: 300, attempts: 1, planned: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('window.__terminalDiag() 로 최근 기록을 꺼낼 수 있다', () => {
    vi.spyOn(console, 'table').mockImplementation(() => {});
    recordDisconnect({ ...base, intentional: false, graceClosed: false });
    const events = window.__terminalDiag();
    expect(events.at(-1)).toMatchObject({ type: 'down', sessionId: 's1', code: 1006 });
  });
});
