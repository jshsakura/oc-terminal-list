import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

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
 * WS 재연결 상태 기계의 *타이머 구동* 경로들.
 *
 * 실시간으로는 못 돈다(비활성 grace 60s, 하트비트 12s, 워치독 4s…). 가짜 타이머로
 * 시간을 앞당겨 검증한다. 여기가 이 앱에서 가장 조용히 망가지는 곳이다 —
 * "터미널이 멈췄는데 아무도 재연결을 안 한다" 류는 전부 이 경로에서 나온다.
 */

const settings = testSettings();

// 가짜 타이머 위에서 시간을 흘린다. 사이사이 마이크로태스크(fetch/티켓 await)도 함께 비운다.
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

const renderTerminal = (props = {}) => render(
  <TerminalComponent sessionId="s1" settings={settings} isActive isFocused {...props} />
);

// 소켓이 생길 때까지(티켓 await) 흘린 뒤 연결시킨다.
const openSocket = async () => {
  await tick(20);
  const ws = harness.socket;
  await act(async () => { ws.serverOpen(); });
  return ws;
};

describe('Terminal 재연결 타이머', () => {
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

  describe('배너 디바운스', () => {
    /* 짧은 블립마다 "재연결 중" 이 깜빡이면 프롬프트를 가려 오히려 방해가 된다.
       NOTICE_SHOW_DELAY_MS(2s) 안에 복구되면 배너는 아예 안 뜬다. */
    it('2초 안에 복구되는 짧은 끊김은 배너를 띄우지 않는다', async () => {
      renderTerminal();
      const first = await openSocket();

      await act(async () => { first.serverClose(); });
      await tick(500); // 아직 2s 전

      expect(screen.queryByText(/Reconnecting|재연결|오프라인/i)).toBeNull();

      // 재연결이 성공하면 배너는 끝내 안 뜬다.
      await tick(400);
      await act(async () => { harness.socket.serverOpen(); });
      await tick(3000);

      expect(screen.queryByText(/Reconnecting…|오프라인/i)).toBeNull();
    });

    it('끊김이 2초를 넘기면 재연결 pill 을 띄운다', async () => {
      renderTerminal();
      const first = await openSocket();

      await act(async () => { first.serverClose(); });
      await tick(2500); // 재연결이 아직 못 붙은 채로 2s 경과

      expect(screen.getByText(/Reconnecting…/i)).toBeTruthy();
    });
  });

  describe('로딩 멈춤', () => {
    /* 첫 콘텐츠가 안 오고 오버레이도 없는 상태가 LOAD_STUCK_MS(8s) 넘게 이어지면,
       사용자가 탈출할 방법(닫기 / 다시 시도)을 준다. */
    it('8초 넘게 콘텐츠가 안 오면 탈출구를 준다', async () => {
      const onClosePane = vi.fn();
      renderTerminal({ onClosePane });
      await openSocket(); // 열리기만 하고 출력은 없음

      await tick(8500);

      expect(screen.getByText(/Can't reach the server/i)).toBeTruthy();
      fireEvent.click(screen.getByText(/Dismiss tab/i));
      expect(onClosePane).toHaveBeenCalled();
    });

    it('출력이 들어오면 멈춤 오버레이를 걷는다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await tick(5000);
      await act(async () => { ws.serverSendBytes('$ '); });
      await tick(5000);

      expect(screen.queryByText(/Can't reach the server/i)).toBeNull();
    });
  });

  describe('하트비트', () => {
    it('5초마다 ping 을 보낸다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await tick(11000);

      expect(ws.jsonSent().filter((m) => m.type === 'ping').length).toBeGreaterThanOrEqual(2);
    });

    /* half-open 소켓 — OPEN 인 채로 아무 응답이 없는 상태. 모바일 네트워크 전환에서 흔하다.
       HEARTBEAT_DEAD_ACTIVE_MS(12s) 무응답이면 죽은 걸로 보고 닫아 재연결 경로를 태운다. */
    it('12초간 응답이 없으면 죽은 소켓으로 보고 끊는다', async () => {
      renderTerminal();
      const ws = await openSocket();
      ws.silent = true; // half-open: OPEN 인데 서버가 답을 끊었다

      await tick(16000); // 하트비트는 5s 간격 — 15s 틱에서 "12s 무응답" 이 성립한다

      expect(ws.closed).toBe(true);
      // 죽은 소켓을 닫으면 onclose 가 재연결을 태운다.
      await tick(1000);
      expect(harness.sockets.length).toBeGreaterThan(1);
    });

    it('서버가 pong 으로 답하는 동안은 끊지 않는다', async () => {
      renderTerminal();
      const ws = await openSocket(); // 대역이 ping 마다 pong 을 돌려준다

      await tick(60000);

      expect(ws.closed).toBe(false);
    });
  });

  describe('연결 타임아웃', () => {
    /* 열리지도 닫히지도 않는 좀비 소켓 — 죽은 네트워크 경로에서 흔하다.
       CONNECT_OPEN_TIMEOUT_MS(8s) 안에 안 열리면 버리고 새로 연다. */
    it('8초 안에 안 열리는 소켓은 버리고 다시 연다', async () => {
      renderTerminal();
      await tick(20);
      const zombie = harness.socket;
      expect(zombie.readyState).toBe(FakeWebSocket.CONNECTING);

      await tick(9000);

      expect(zombie.closed).toBe(true);
      await tick(1000);
      expect(harness.sockets.length).toBeGreaterThan(1);
    });
  });

  describe('교착 워치독', () => {
    /* "재연결 중" 배너는 떠 있는데 아무도 실제로 재연결을 안 하는 상태.
       모바일에서 close() 를 불러도 onclose 가 영영 안 오는 좀비 소켓이 주범이었다.
       RECONNECT_WATCHDOG_POLL_MS(4s) 주기로 점검해 강제 복구한다. */
    it('좀비 소켓(onclose 가 안 옴)이면 워치독이 강제로 다시 연결한다', async () => {
      renderTerminal({ sessionId: 'wd' });
      const first = await openSocket();
      first.zombie = true;  // close() 해도 onclose 가 영영 안 온다 (모바일에서 실제로 생긴다)
      first.silent = true;  // 서버 응답도 끊겼다

      await tick(16000); // 하트비트가 죽은 소켓을 감지해 close() — 그러나 onclose 는 안 온다
      expect(first.closed).toBe(true);

      // 사용자가 타이핑한다 → 소켓이 없으니 "재연결 중" 배너만 뜬다. 아무도 재연결을 안 한다.
      await act(async () => { window.terminalSessions.wd.sendData('ls'); });
      const before = harness.sockets.length;

      await tick(9000); // 워치독 폴링(4s 주기)

      expect(harness.sockets.length).toBeGreaterThan(before);
    });
  });

  describe('비활성 pane grace-close', () => {
    /* 비활성 pane 이 소켓·하트비트·티켓을 계속 돌리면 OS 가 탭을 죽인다(특히 모바일).
       60초 뒤 조용히 닫고, 활성 복귀 시 다시 붙는다 — tmux 가 세션을 들고 있어 손실은 없다. */
    it('비활성 60초 뒤 소켓을 닫고, 활성 복귀 시 다시 연결한다', async () => {
      const props = { sessionId: 's1', settings, isFocused: true };
      const { rerender } = render(<TerminalComponent {...props} isActive />);
      const ws = await openSocket();

      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      await tick(61000);

      expect(ws.closed).toBe(true);

      const before = harness.sockets.length;
      await act(async () => { rerender(<TerminalComponent {...props} isActive />); });
      await tick(500);

      expect(harness.sockets.length).toBeGreaterThan(before);
    });

    it('60초 전에 돌아오면 소켓을 그대로 둔다 (재연결 비용 0)', async () => {
      const props = { sessionId: 's1', settings, isFocused: true };
      const { rerender } = render(<TerminalComponent {...props} isActive />);
      const ws = await openSocket();

      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      await tick(30000);
      await act(async () => { rerender(<TerminalComponent {...props} isActive />); });
      await tick(40000);

      expect(ws.closed).toBe(false);
    });
  });

  describe('복귀 프로브', () => {
    /* iOS/Android 는 백그라운드에서 WS 를 OPEN 인 채로 얼려둔다. 화면이 다시 보이면
       ping 을 쏴 실제 생존을 확인하고, RESUME_PROBE_TIMEOUT_MS(2.5s) 안에 답이 없으면 갈아탄다. */
    it('복귀 시 조용했던 소켓에 ping 을 쏘고, 답이 없으면 갈아탄다', async () => {
      renderTerminal();
      const ws = await openSocket();
      ws.silent = true; // 서버가 조용해졌다(백그라운드에서 얼어붙은 소켓)

      // HEALTHY_RECV_MS(3s) 넘게 아무것도 못 받은 상태(하트비트 dead 12s 전).
      await tick(6000);
      const pingsBefore = ws.jsonSent().filter((m) => m.type === 'ping').length;

      await act(async () => { window.dispatchEvent(new Event('focus')); });
      expect(ws.jsonSent().filter((m) => m.type === 'ping').length).toBeGreaterThan(pingsBefore);

      const before = harness.sockets.length;
      await tick(3000); // 프로브 무응답

      expect(harness.sockets.length).toBeGreaterThan(before);
    });

    it('최근에 데이터를 받았으면 멀쩡한 소켓을 건드리지 않는다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await act(async () => { ws.serverSendBytes('output'); });
      const before = harness.sockets.length;

      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await tick(4000);

      expect(ws.closed).toBe(false);
      expect(harness.sockets.length).toBe(before);
    });
  });
});
