import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

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
 * "재연결 중이 자꾸 뜨고 한참 안 풀린다" 대응.
 *
 * 두 원인을 막는다:
 *  1) 탭·pane 전환마다 재연결 — 비활성 pane 절전(60s)이 PC 에선 이득 없이 비용만 낸다.
 *     (모바일 OS 가 탭을 죽이는 걸 막으려던 장치다 — 데스크탑엔 그 위험이 없다.)
 *  2) 가만히 있는데 갑자기 끊김 — 하트비트가 12s 무응답이면 소켓을 죽인다. 5s ping 이니
 *     pong 두 번만 늦어도 *멀쩡한* 소켓이 죽고, 복구에 수십 초가 걸린다.
 */

const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

const openSocket = async () => {
  await tick(20);
  const ws = harness.socket;
  await act(async () => { ws.serverOpen(); });
  return ws;
};

describe('재연결 회복력', () => {
  let realWebSocket;

  beforeEach(() => {
    harness.reset();
    vi.useFakeTimers();
    realWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = realWebSocket;
    delete window.terminalSessions;
  });

  describe('비활성 pane 절전', () => {
    /* 데스크탑: 탭 하나 갔다 왔다고 소켓을 끊으면, 돌아올 때마다 재연결 + tmux 리플레이가
       돌아 "재연결 중" 이 뜬다. OS 가 탭을 죽일 위험이 없으니 끊을 이유가 없다. */
    it('데스크탑에서는 pane 이 비활성이어도 소켓을 끊지 않는다', async () => {
      const props = { sessionId: 's1', settings: testSettings(), isFocused: true, isMobile: false };
      const { rerender } = render(<TerminalComponent {...props} isActive />);
      const ws = await openSocket();

      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      await tick(120000); // 옛 임계(60s)를 한참 넘겨도

      expect(ws.closed).toBe(false);
    }, 20000);

    /* 모바일은 다르다 — 안 보이는 pane 이 소켓·하트비트를 계속 돌리면 OS 가 탭을 통째로
       죽인다(밤새 켜두면 뻗던 그 문제). 여기서는 절전이 반드시 필요하다. */
    it('모바일에서는 비활성 pane 을 절전으로 끊는다', async () => {
      const props = { sessionId: 's1', settings: testSettings(), isFocused: true, isMobile: true };
      const { rerender } = render(<TerminalComponent {...props} isActive />);
      const ws = await openSocket();

      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      await tick(65000);

      expect(ws.closed).toBe(true);
    }, 20000);

    it('브라우저 탭을 숨기면 데스크탑에서도 결국 끊는다 (밤새 방치 방어)', async () => {
      const props = { sessionId: 's1', settings: testSettings(), isFocused: true, isMobile: false };
      render(<TerminalComponent {...props} isActive />);
      const ws = await openSocket();

      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      await tick(6 * 60_000); // HIDDEN_TAB_GRACE_MS(5분) 초과

      expect(ws.closed).toBe(true);
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    }, 20000);
  });

  describe('탭 복귀 재페인트', () => {
    /* 탭을 갔다 오면 위쪽이 검게 비고 아래 몇 줄만 찍히던 증상. WebGL 을 반납했다가 다시
       붙이면 캔버스가 새로 비는데 xterm 은 바뀐 행만 그린다. 탭 전환은 visibility 토글이라
       ResizeObserver 도 안 짖어서 아무도 전체 재페인트를 시키지 않았다(스크롤하면 풀렸다). */
    it('비활성 → 활성 전환 후 전체 재페인트를 한 번 돌린다', async () => {
      const props = { sessionId: 's1', settings: testSettings(), isFocused: true, isMobile: false };
      const { rerender } = render(<TerminalComponent {...props} isActive />);
      await openSocket();

      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      const term = harness.term;
      term.refresh.mockClear();

      await act(async () => { rerender(<TerminalComponent {...props} isActive />); });
      // 레이아웃 확정 뒤(rAF 2프레임) 그린다.
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });

      expect(term.refresh).toHaveBeenCalledWith(0, term.rows - 1);
    }, 20000);
  });

  describe('하트비트 오탐 방어', () => {
    /* 공유 터널이 잠깐 막혀 pong 이 두 번 늦으면 12s 임계에 걸린다. 그때 소켓을 곧장
       죽이면 멀쩡한 연결이 끊기고 복구에 수십 초가 든다 — 죽이기 전에 한 번 더 물어본다. */
    it('임계를 넘겨도 곧장 죽이지 않고 마지막으로 한 번 더 확인한다', async () => {
      render(<TerminalComponent sessionId="s1" settings={testSettings()} isActive isFocused />);
      const ws = await openSocket();
      ws.silent = true; // 서버가 조용해졌다

      await tick(16000); // 옛 코드였다면 여기서 이미 죽였다

      expect(ws.closed).toBe(false); // 아직 기회를 준다
    }, 20000);

    it('마지막 확인에도 답이 없으면 그때는 끊는다', async () => {
      render(<TerminalComponent sessionId="s1" settings={testSettings()} isActive isFocused />);
      const ws = await openSocket();
      ws.silent = true;

      await tick(25000);

      expect(ws.closed).toBe(true);
    }, 20000);

    /* 핵심 — 잠깐 막혔다가 응답이 돌아오면 소켓을 살려둬야 한다.
       이게 안 되면 "가만히 보고 있는데 갑자기 재연결 중" 이 계속 뜬다. */
    it('마지막 확인에 답이 오면 멀쩡한 소켓을 죽이지 않는다', async () => {
      render(<TerminalComponent sessionId="s1" settings={testSettings()} isActive isFocused />);
      const ws = await openSocket();

      ws.silent = true;
      await tick(16000);  // 임계 초과 — 마지막 확인이 나간다
      ws.silent = false;  // 터널이 풀렸다 — 다시 답한다
      await tick(15000);

      expect(ws.closed).toBe(false);
      expect(harness.sockets.length).toBe(1); // 재연결도 없었다
    }, 20000);
  });
});
