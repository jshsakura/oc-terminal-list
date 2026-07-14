import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', async () => ({ Terminal: (await import('../test/xtermHarness')).FakeTerminal }));
vi.mock('@xterm/addon-fit', async () => ({ FitAddon: (await import('../test/xtermHarness')).FakeFitAddon }));
vi.mock('@xterm/addon-search', async () => ({ SearchAddon: (await import('../test/xtermHarness')).FakeSearchAddon }));
vi.mock('@xterm/addon-webgl', async () => ({ WebglAddon: (await import('../test/xtermHarness')).FakeWebglAddon }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { activate() {} dispose() {} } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { activate() {} dispose() {} } }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class { activate() {} dispose() {} } }));
vi.mock('../utils/terminalFit', () => ({ measureTerminalFit: vi.fn(() => null) }));
vi.mock('../utils/predictiveEcho', () => ({
  PredictiveEcho: class {
    setGhostColor() {} setEnabled() {} refreshMetrics() {} onInput() {} onServerOutput() {} dispose() {}
  },
}));
vi.mock('./terminal/terminalHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  issueWsTicket: vi.fn(async () => ({ ticket: 'tkt', authExpired: false })),
}));

import TerminalComponent from './Terminal';
import { harness, FakeWebSocket, testSettings } from '../test/xtermHarness';

/**
 * 평범한 네트워크 블립 — 끊겼다가 곧바로 다시 붙는 흔한 경우.
 *
 * 이때 병행 빠른 재연결(150~300ms)이 복구를 책임진다. onclose 진단(preflight)은 같이
 * 돌지만 *판정용* 이다 — 복구가 이미 됐는데 진단이 뒤늦게 "재연결 중" 배너를 켜면,
 * 멀쩡한 연결 위에 배너가 떠서 한참 도는 것처럼 보인다.
 *
 * 실제 preflight 는 터널을 왕복해 수백 ms 가 걸린다. 그 동안 병행 재연결이 먼저 붙는다 —
 * 이 순서를 그대로 재현해야 버그가 드러난다(즉시 응답하는 목으로는 안 드러났다).
 */

const settings = testSettings();
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

// 병행 재연결이 만든 새 소켓을 열어준다(실제 서버처럼).
const openNewSockets = async (seen) => {
  for (const ws of harness.sockets) {
    if (seen.has(ws) || ws.readyState !== FakeWebSocket.CONNECTING) continue;
    seen.add(ws);
    await act(async () => { ws.serverOpen(); });
  }
};

describe('평범한 블립 — 멀쩡한 연결 위에 배너를 띄우지 않는다', () => {
  let realWebSocket;
  let realFetch;

  beforeEach(() => {
    harness.reset();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    realWebSocket = global.WebSocket;
    realFetch = global.fetch;
    global.WebSocket = FakeWebSocket;

    /* preflight 는 터널을 왕복한다 — 즉시 응답이 아니라 300ms 쯤 걸린다.
       그 사이 병행 재연결이 먼저 붙는다. 응답은 "우리가 붙어 있다"(same_client_active). */
    global.fetch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          attached: true,
          same_client_active: true,
          other_client_active: false,
          exists: true,
          count: 1,
        }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.WebSocket = realWebSocket;
    global.fetch = realFetch;
    delete window.terminalSessions;
  });

  it('끊겼다가 곧바로 다시 붙으면 "재연결 중" 배너가 뜨지 않는다', async () => {
    const seen = new Set();
    render(<TerminalComponent sessionId="s1" settings={settings} isActive isFocused />);

    await tick(20);
    await openNewSockets(seen);
    const first = harness.socket;

    // 블립: 서버가 소켓을 끊는다.
    await act(async () => { first.serverClose(); });

    // 병행 재연결(150~300ms)이 새 소켓을 열고 곧바로 붙는다.
    await tick(400);
    await openNewSockets(seen);
    expect(harness.socket.readyState).toBe(FakeWebSocket.OPEN);

    // 그 뒤 preflight 응답이 도착한다(300ms). 이미 복구됐으므로 아무 일도 없어야 한다.
    await tick(6000);

    // 연결은 멀쩡한데 배너가 떠 있으면 안 된다.
    expect(harness.socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(screen.queryByText(/Reconnecting…/i)).toBeNull();
  }, 20000);

  it('복구된 뒤에 진단이 재연결을 또 예약하지 않는다', async () => {
    const seen = new Set();
    render(<TerminalComponent sessionId="s1" settings={settings} isActive isFocused />);

    await tick(20);
    await openNewSockets(seen);
    await act(async () => { harness.socket.serverClose(); });

    await tick(400);
    await openNewSockets(seen);
    const afterRecovery = harness.sockets.length; // 첫 소켓 + 재연결 소켓 = 2

    // 진단이 끝나도 멀쩡한 연결 위에 새 소켓을 또 만들면 안 된다(핸드셰이크 폭주 방지).
    await tick(10000);

    expect(harness.sockets.length).toBe(afterRecovery);
  }, 20000);
});
