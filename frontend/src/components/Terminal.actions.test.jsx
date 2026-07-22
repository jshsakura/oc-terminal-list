import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

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
  uploadFileAndGetPath: vi.fn(async () => ({ path: '/ws/.pasted/f.bin' })),
  copyTextToClipboard: vi.fn(async () => true),
}));

import TerminalComponent from './Terminal';
import { copyTextToClipboard, uploadFileAndGetPath } from './terminal/terminalHelpers';
import { harness, FakeWebSocket, testSettings } from '../test/xtermHarness';

/**
 * 사용자가 *클릭해서* 도달하는 경로들 — 상태 카드의 버튼과 컨텍스트 메뉴.
 * 터미널이 막혔을 때 빠져나갈 수 있는 유일한 문들이라, 조용히 깨지면 갇힌다.
 */

const settings = testSettings();

const renderTerminal = (props = {}) => render(
  <TerminalComponent sessionId="s1" settings={settings} isActive isFocused {...props} />
);

const openSocket = async () => {
  await waitFor(() => expect(harness.socket).toBeTruthy());
  const ws = harness.socket;
  await act(async () => { ws.serverOpen(); });
  return ws;
};

/* 종료 카드로 가는 가장 짧은 길 — 인증(MFA) 프롬프트를 사용자가 취소하면
   자동 재연결을 막고 ended 로 떨어진다. */
const reachEndedCard = async () => {
  const ws = await openSocket();
  await act(async () => {
    ws.serverSend(JSON.stringify({ type: 'auth-prompt', prompts: [{ prompt: 'OTP:' }] }));
  });
  await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
  await screen.findByText('Shell ended');
  return ws;
};

describe('Terminal 사용자 액션', () => {
  let realWebSocket;

  beforeEach(() => {
    harness.reset();
    realWebSocket = global.WebSocket;
    global.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    global.WebSocket = realWebSocket;
    delete window.terminalSessions;
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  describe('인증 프롬프트', () => {
    it('제출하면 값을 서버로 보낸다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'auth-prompt', prompts: [{ prompt: 'OTP:' }] }));
      });
      const input = document.querySelector('input[type="password"]');
      fireEvent.change(input, { target: { value: '123456' } });
      await act(async () => { fireEvent.click(screen.getByText('Continue')); });

      expect(ws.jsonSent().some((m) => m.type === 'auth-response' && m.values[0] === '123456')).toBe(true);
    });

    // 취소는 "자동 재연결하지 말라"는 뜻이다 — 다시 붙으면 또 MFA 를 물어보게 된다.
    it('취소하면 소켓을 닫고 자동 재연결하지 않는다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await reachEndedCard();

      expect(ws.closed).toBe(true);
      const count = harness.sockets.length;
      await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
      expect(harness.sockets.length).toBe(count); // 재연결 시도 없음
    });
  });

  describe('종료 카드', () => {
    it('"다시 연결" 은 기존 셸에만 붙는다 (create=0)', async () => {
      renderTerminal();
      await reachEndedCard();
      const before = harness.sockets.length;

      await act(async () => { fireEvent.click(screen.getByText('Reconnect')); });
      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(before));

      expect(harness.socket.url).toContain('create=0');
    });

    /* "새 셸 시작" 은 없으면 만든다. 이 둘이 뒤바뀌면 최악이다 — "다시 연결" 을 눌렀는데
       조용히 새 셸이 떠서 사용자의 작업이 사라진 것처럼 보인다. */
    it('"새 셸 시작" 은 없으면 새로 만든다 (create 생략)', async () => {
      renderTerminal();
      await reachEndedCard();
      const before = harness.sockets.length;

      await act(async () => { fireEvent.click(screen.getByText('Restart shell')); });
      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(before));

      expect(harness.socket.url).not.toContain('create=0');
    });

    it('"닫기" 는 pane 을 접는다', async () => {
      const onClosePane = vi.fn();
      renderTerminal({ onClosePane });
      await reachEndedCard();

      fireEvent.click(screen.getByText('Close'));
      expect(onClosePane).toHaveBeenCalled();
    });

    it('onClosePane 이 없으면 "닫기" 를 아예 안 보여준다', async () => {
      renderTerminal();
      await reachEndedCard();
      expect(screen.queryByText('Close')).toBeNull();
    });
  });

  describe('인계 카드', () => {
    it('"내가 가져오기" 는 세션에 다시 붙는다', async () => {
      renderTerminal();
      const ws = await openSocket();

      // tmux 버퍼 리플레이 무시 창(1.5s)이 지난 뒤의 detach 토큰 = 진짜 인계.
      await act(async () => { await new Promise((r) => setTimeout(r, 1600)); });
      await act(async () => {
        ws.serverSendBytes('[detached (from session work)]');
        await new Promise((r) => setTimeout(r, 40));
      });
      // tmux 가 우리를 떼어냈으니 서버는 소켓을 닫는다. evicted 라 자동 재연결은 하지 않는다.
      await act(async () => { ws.serverClose(); });
      await screen.findByText(/Another device|다른 기기/i);
      const before = harness.sockets.length;

      await act(async () => { fireEvent.click(screen.getByText(/Take it over|가져오기/i)); });

      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(before));
    });
  });

  describe('자동 닫기 되돌리기', () => {
    /* 셸이 exit 하면 pane 이 자동으로 닫힌다. 실수로 exit 했을 때를 위해 짧은 취소 여유를 준다 —
       되돌리면 닫히지 않고 종료 카드로 전환돼 다시 붙을 수 있다. */
    it('"되돌리기" 를 누르면 pane 이 닫히지 않는다', async () => {
      global.fetch = vi.fn(async () => ({
        ok: true, status: 200, json: async () => ({ attached: false, exists: false }),
      }));
      const onClosePane = vi.fn();
      renderTerminal({ onClosePane });
      const ws = await openSocket();
      await act(async () => { ws.serverClose(); });

      // RECOVERY_GRACE_MS(12s) 동안 회복을 기다린 뒤 자동 닫기 카운트다운(1.8s)이 뜬다.
      const undo = await screen.findByText('Undo', {}, { timeout: 20000 });
      fireEvent.click(undo);

      await act(async () => { await new Promise((r) => setTimeout(r, 2500)); });
      expect(onClosePane).not.toHaveBeenCalled();
      expect(screen.getByText('Shell ended')).toBeTruthy(); // 수동 선택지로 전환
    }, 30000);
  });

  describe('컨텍스트 메뉴', () => {
    const openMenu = async (container) => {
      const termBox = container.querySelector('div[style*="box-sizing"]');
      await act(async () => {
        fireEvent.mouseDown(termBox, { button: 2, clientX: 20, clientY: 20 });
      });
    };

    it('우클릭으로 열고 "전체 복사" 로 버퍼를 복사한다', async () => {
      const { container } = renderTerminal();
      const ws = await openSocket();
      await act(async () => {
        ws.serverSendBytes('hello');
        await new Promise((r) => setTimeout(r, 40));
      });
      // 가짜 term 의 버퍼에 내용이 있는 것처럼 꾸민다.
      harness.term.buffer.active.length = 1;
      harness.term.buffer.active.getLine = () => ({ translateToString: () => 'hello' });

      await openMenu(container);
      await act(async () => { fireEvent.click(screen.getByText('Copy all')); });

      expect(copyTextToClipboard).toHaveBeenCalledWith('hello');
      expect(screen.queryByText('Copy all')).toBeNull(); // 실행 후 닫힌다
    });

    it('"맨 아래로" 는 터미널을 아래로 내린다', async () => {
      const { container } = renderTerminal();
      await openSocket();

      await openMenu(container);
      await act(async () => { fireEvent.click(screen.getByText('Scroll to Bottom')); });

      expect(harness.term.scrollToBottom).toHaveBeenCalled();
    });

    it('"새로고침" 은 콜백이 있을 때만 나온다', async () => {
      const onRefresh = vi.fn();
      const { container } = renderTerminal({ onRefresh });
      await openSocket();

      await openMenu(container);
      await act(async () => { fireEvent.click(screen.getByText('Refresh')); });

      expect(onRefresh).toHaveBeenCalled();
    });

    /* "파일 보내기" — PTY 는 파일을 못 나른다. 서버에 올리고 그 경로를 터미널에 붙인다. */
    it('"파일 보내기" 는 업로드 후 경로를 터미널에 붙인다', async () => {
      const { container } = renderTerminal();
      await openSocket();
      await openMenu(container);

      await act(async () => { fireEvent.click(screen.getByText('Send file')); });

      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(['x'], 'a.bin', { type: 'application/octet-stream' });
      await act(async () => { fireEvent.change(fileInput, { target: { files: [file] } }); });

      // hostId 가 함께 넘어가야 원격 pane 에서도 그 호스트에 올라간다.
      await waitFor(() => expect(uploadFileAndGetPath).toHaveBeenCalledWith(file, undefined));
      await waitFor(() => expect(harness.term.pasted).toContain('/ws/.pasted/f.bin '));
    });
  });

  describe('오프라인', () => {
    /* 원인이 "이 기기" 인지 "서버" 인지 먼저 말해줘야 한다. 오프라인이면 "다시 시도" 는
       눌러도 안 되므로 아예 숨기고, 복구되면 자동으로 붙는다고 안내한다. */
    it('오프라인이면 원인을 이 기기로 표시하고 "다시 시도" 를 숨긴다', async () => {
      renderTerminal({ onClosePane: vi.fn() });
      await openSocket();

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      await act(async () => { window.dispatchEvent(new Event('offline')); });

      // LOAD_STUCK_MS(8s) — 콘텐츠가 안 온 채 멈춰 있으면 카드가 뜬다.
      await screen.findByText(/No internet connection|인터넷 연결 없음/i, {}, { timeout: 12000 });
      expect(screen.queryByText('Retry')).toBeNull();
      // 원인 배지 — 설명문에도 같은 말이 나오므로 여럿 중 하나면 된다.
      expect(screen.getAllByText(/This device|이 기기/i).length).toBeGreaterThan(0);
    }, 20000);
  });
});
