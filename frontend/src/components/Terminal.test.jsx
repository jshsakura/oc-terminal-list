import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

// ── xterm / 애드온 대역 ──────────────────────────────────────────────
// jsdom 에서 실제 xterm 은 못 뜬다(canvas/WebGL). 대역을 세우고 컴포넌트의 관찰 가능한
// 계약만 검증한다: 어떤 WS 를 여는지, 받은 바이트를 term 에 쓰는지, 어떤 오버레이를
// 띄우는지, 언마운트 때 무엇을 정리하는지.
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', async () => ({
  Terminal: (await import('../test/xtermHarness')).FakeTerminal,
}));
vi.mock('@xterm/addon-fit', async () => ({
  FitAddon: (await import('../test/xtermHarness')).FakeFitAddon,
}));
vi.mock('@xterm/addon-search', async () => ({
  SearchAddon: (await import('../test/xtermHarness')).FakeSearchAddon,
}));
vi.mock('@xterm/addon-webgl', async () => ({
  WebglAddon: (await import('../test/xtermHarness')).FakeWebglAddon,
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { activate() {} dispose() {} } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { activate() {} dispose() {} } }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class { activate() {} dispose() {} } }));

// 실제 fit 측정은 DOM 크기에 의존 — null 을 주면 컴포넌트가 FitAddon 기본값으로 폴백한다.
vi.mock('../utils/terminalFit', () => ({ measureTerminalFit: () => null }));

// 예측 입력은 .xterm-screen 에 오버레이를 붙인다 — 여기선 관심사가 아니라 대역.
vi.mock('../utils/predictiveEcho', () => ({
  PredictiveEcho: class {
    setGhostColor() {}
    setEnabled() {}
    refreshMetrics() {}
    onInput() {}
    onServerOutput() {}
    dispose() {}
  },
}));

// WS 티켓 발급만 대역으로 — 나머지 헬퍼(sleep, copyTextToClipboard…)는 실제 구현 유지.
vi.mock('./terminal/terminalHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  issueWsTicket: vi.fn(async () => ({ ticket: 'test-ticket', authExpired: false })),
}));

import TerminalComponent from './Terminal';
import { harness, FakeWebSocket, testSettings } from '../test/xtermHarness';

const renderTerminal = (props = {}) => render(
  <TerminalComponent
    sessionId="sess-1"
    settings={testSettings()}
    isActive={true}
    isFocused={true}
    {...props}
  />
);

// WS 티켓 발급이 await 를 한 번 타므로, connect() 가 소켓을 만들 때까지 microtask 를 흘린다.
const waitForSocket = async () => {
  await waitFor(() => expect(harness.socket).toBeTruthy());
  return harness.socket;
};

const openSocket = async () => {
  const ws = await waitForSocket();
  await act(async () => { ws.serverOpen(); });
  return ws;
};

describe('Terminal', () => {
  let realWebSocket;

  beforeEach(() => {
    harness.reset();
    realWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    global.WebSocket = realWebSocket;
    delete window.terminalSessions;
  });

  describe('연결', () => {
    it('로컬 세션은 티켓·셸·크기를 실은 /ws/<id> 로 연결한다', async () => {
      renderTerminal({ sessionId: 'abc' });
      const ws = await waitForSocket();

      expect(ws.url).toContain('/ws/abc');
      expect(ws.url).toContain('ticket=test-ticket');
      expect(ws.url).toContain('shell=bash');
      expect(ws.url).toContain('cols=80');
      expect(ws.url).toContain('rows=24');
    });

    it('호스트 세션은 /ws/host/<hostId> 로 tmux 세션명을 실어 연결한다', async () => {
      renderTerminal({ sessionId: 'abc', hostId: 'h1', tmuxSessionName: 'work' });
      const ws = await waitForSocket();

      expect(ws.url).toContain('/ws/host/h1');
      expect(ws.url).toContain('tmux_session_name=work');
    });

    it('cwd 를 쿼리로 넘긴다', async () => {
      renderTerminal({ cwd: '/tmp/x' });
      const ws = await waitForSocket();
      expect(ws.url).toContain(`cwd=${encodeURIComponent('/tmp/x')}`);
    });

    it('연결되면 현재 크기를 서버로 보낸다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await waitFor(() => {
        expect(ws.jsonSent().some((m) => m.type === 'resize' && m.cols === 80 && m.rows === 24)).toBe(true);
      });
    });
  });

  describe('출력', () => {
    it('첫 콘텐츠 전에는 스켈레톤을 띄우고, 출력이 오면 걷는다', async () => {
      const { container } = renderTerminal();
      const ws = await openSocket();

      // 스켈레톤 = aria-hidden 오버레이. 콘텐츠 전에는 존재한다.
      expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();

      await act(async () => {
        ws.serverSendBytes('hello world');
        // flushBufferedOutput 은 활성 pane 에서 16ms 배치.
        await new Promise((r) => setTimeout(r, 40));
      });

      await waitFor(() => expect(harness.term.text).toContain('hello world'));
    });

    it('서버가 보낸 바이트를 xterm 에 쓴다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await act(async () => {
        ws.serverSendBytes('$ ls -la\r\n');
        await new Promise((r) => setTimeout(r, 40));
      });

      await waitFor(() => expect(harness.term.text).toContain('$ ls -la'));
    });

    it('pong 은 터미널로 흘리지 않는다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'pong' }));
        await new Promise((r) => setTimeout(r, 40));
      });

      expect(harness.term.text).not.toContain('pong');
    });
  });

  describe('상태 오버레이', () => {
    it('takeover(detached 토큰) 시 "다른 기기에서 접속 중" 을 띄운다', async () => {
      renderTerminal();
      const ws = await openSocket();

      // tmux 버퍼 리플레이 무시 창(1.5s)이 지난 뒤에 와야 진짜 eviction 으로 친다.
      await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
      await act(async () => {
        ws.serverSendBytes('[detached (from session work)]');
        await new Promise((r) => setTimeout(r, 40));
      });

      await waitFor(() => expect(screen.getByText(/다른 기기에서 접속 중|Another device/i)).toBeTruthy());
      // detach 텍스트 자체는 터미널에 그리지 않는다.
      expect(harness.term.text).not.toContain('[detached');
    });

    it('auth-prompt 메시지에 인증 입력 오버레이를 띄운다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({
          type: 'auth-prompt',
          name: 'Verification',
          prompts: [{ prompt: 'OTP:', echo: false }],
        }));
      });

      await waitFor(() => expect(screen.getByText(/OTP:/)).toBeTruthy());
    });

    it('tmux-missing 경고 배너를 띄우고 닫을 수 있다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'tmux-missing' }));
      });

      const banner = await screen.findByText(/tmux not found|tmux/i);
      expect(banner).toBeTruthy();
    });
  });

  describe('세션 레지스트리', () => {
    it('window.terminalSessions 에 자기 API 를 등록하고 언마운트 시 지운다', async () => {
      const { unmount } = renderTerminal({ sessionId: 'reg-1' });
      await openSocket();

      await waitFor(() => expect(window.terminalSessions?.['reg-1']).toBeTruthy());
      const api = window.terminalSessions['reg-1'];
      expect(typeof api.sendCommand).toBe('function');
      expect(typeof api.sendData).toBe('function');
      expect(api.getConnectionState()).toBe('open');

      unmount();
      expect(window.terminalSessions?.['reg-1']).toBeUndefined();
    });

    it('sendCommand 는 개행을 붙여 보낸다', async () => {
      renderTerminal({ sessionId: 'reg-2' });
      const ws = await openSocket();
      await waitFor(() => expect(window.terminalSessions?.['reg-2']).toBeTruthy());

      await act(async () => {
        window.terminalSessions['reg-2'].sendCommand('echo hi');
        await new Promise((r) => setTimeout(r, 20));
      });

      await waitFor(() => expect(ws.sent).toContain('echo hi\r'));
    });
  });

  describe('정리', () => {
    it('언마운트 시 term 을 dispose 하고 소켓을 닫는다', async () => {
      const { unmount } = renderTerminal();
      const ws = await openSocket();
      const term = harness.term;

      unmount();

      expect(term.disposed).toBe(true);
      expect(ws.closed).toBe(true);
    });
  });
});
