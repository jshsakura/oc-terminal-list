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

// 실제 fit 측정은 DOM 크기에 의존. 기본은 null → 컴포넌트가 FitAddon 기본값(80x24)으로 폴백.
// 컴포넌트가 fitAddon.proposeDimensions 를 몽키패치하므로, 치수를 바꾸려면 여기를 조작한다.
vi.mock('../utils/terminalFit', () => ({ measureTerminalFit: vi.fn(() => null) }));

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
import { issueWsTicket } from './terminal/terminalHelpers';
import { measureTerminalFit } from '../utils/terminalFit';
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
  let realFetch;

  beforeEach(() => {
    harness.reset();
    vi.mocked(measureTerminalFit).mockReturnValue(null);
    vi.mocked(issueWsTicket).mockResolvedValue({ ticket: 'test-ticket', authExpired: false });
    realWebSocket = global.WebSocket;
    realFetch = global.fetch;
    global.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    global.WebSocket = realWebSocket;
    global.fetch = realFetch;
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

    it('원격에는 로컬 `기본 셸` 설정을 보내지 않는다', async () => {
      /* 남의 호스트 로그인 셸(대개 zsh)을 이 서버의 설정으로 덮으면 안 된다.
         고른 것이 없으면 아무것도 안 싣는 것이 그 규칙이다. */
      renderTerminal({ sessionId: 'abc', hostId: 'h1', tmuxSessionName: 'work' });
      const ws = await waitForSocket();
      expect(ws.url).not.toContain('shell=');
    });

    it('원격이라도 pane 이 고른 셸은 싣는다', async () => {
      renderTerminal({ sessionId: 'abc', hostId: 'h1', tmuxSessionName: 'work', paneShell: 'zsh' });
      const ws = await waitForSocket();
      expect(ws.url).toContain('shell=zsh');
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
        // 출력 싱크는 리딩엣지라 조용하다 온 첫 바이트는 즉시 쓰인다 (createOutputSink).
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

    /* 배너가 말해야 하는 것은 "tmux 가 없다" 가 아니라 **"닫으면 사라진다"** 다.
       그리고 깔러 갈 길이 함께 있어야 한다 — 안내만 하고 길을 안 주면 사용자는
       배너를 닫고 잊은 뒤, 탭을 닫는 순간 작업을 잃는다. */
    it('멀티플렉서가 없으면 없는 도구 이름과 결과를 말한다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'mux-missing', multiplexer: 'tmux' }));
      });

      expect(await screen.findByText(/tmux .*not installed/i)).toBeTruthy();
    });

    it('배너의 설치 버튼이 그 호스트의 도구 화면을 연다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();
      const opened = [];
      const onOpen = (e) => opened.push(e.detail);
      window.addEventListener('iterm:open-tools', onOpen);

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'mux-missing', multiplexer: 'tmux' }));
      });
      await act(async () => { (await screen.findByText('Install')).click(); });
      window.removeEventListener('iterm:open-tools', onOpen);

      expect(opened).toEqual([{ hostId: 'h1' }]);
    });

    /* 옛 백엔드(롤백 등)가 보내는 이름도 그대로 받는다. */
    it('옛 tmux-missing 도 같은 배너를 띄운다', async () => {
      renderTerminal({ hostId: 'h1' });
      const ws = await openSocket();

      await act(async () => {
        ws.serverSend(JSON.stringify({ type: 'tmux-missing' }));
      });

      expect(await screen.findByText(/tmux .*not installed/i)).toBeTruthy();
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

  describe('입력', () => {
    // 지연에 민감한 단일 키는 큐를 거치지 않고 곧장 소켓으로 — 타이핑 체감 지연의 핵심.
    it('단일 키 입력은 큐를 우회해 즉시 보낸다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await act(async () => { harness.term.handlers.data('a'); });

      expect(ws.sent).toContain('a');
    });

    // 대용량 paste 를 한 번에 밀면 WS 버퍼/PTY/tmux 가 못 따라와 UI 가 얼고 입력이 유실된다.
    it('대용량 붙여넣기는 16KB 청크로 쪼개 보낸다', async () => {
      renderTerminal({ sessionId: 'bulk' });
      const ws = await openSocket();
      await waitFor(() => expect(window.terminalSessions?.bulk).toBeTruthy());

      const big = 'x'.repeat(40 * 1024);
      await act(async () => {
        window.terminalSessions.bulk.sendData(big);
        await new Promise((r) => setTimeout(r, 60));
      });

      const chunks = ws.sent.filter((s) => typeof s === 'string' && s.startsWith('x'));
      expect(chunks.length).toBeGreaterThan(1);
      expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(16 * 1024);
      expect(chunks.join('')).toBe(big);
    });

    // 끊긴 동안 친 키를 버리면 "키 씹힘"이 된다 — 큐에 쌓아뒀다가 다시 열리면 흘려보낸다.
    it('소켓이 닫힌 동안의 입력을 버리지 않고 재연결 후 보낸다', async () => {
      renderTerminal();
      const first = await openSocket();

      await act(async () => { first.serverClose(); });
      await act(async () => { harness.term.handlers.data('queued'); });

      // 재연결이 새 소켓을 연다(첫 시도는 150~300ms).
      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(1), { timeout: 3000 });
      const next = harness.socket;
      await act(async () => { next.serverOpen(); await new Promise((r) => setTimeout(r, 60)); });

      expect(next.sent).toContain('queued');
    });
  });

  describe('출력 배치', () => {
    // 비활성 pane 에서 xterm 파싱/렌더를 돌리면 메인스레드만 먹는다 — 활성 복귀 때 한 번에 쓴다.
    it('비활성 pane 은 출력을 모아뒀다가 활성 복귀 시 쓴다', async () => {
      const props = { sessionId: 's', settings: testSettings(), isFocused: true };
      const { rerender } = render(<TerminalComponent {...props} isActive={false} />);
      const ws = await openSocket();

      await act(async () => {
        ws.serverSendBytes('while-inactive');
        await new Promise((r) => setTimeout(r, 80));
      });
      expect(harness.term.text).not.toContain('while-inactive');

      await act(async () => {
        rerender(<TerminalComponent {...props} isActive={true} />);
        await new Promise((r) => setTimeout(r, 40));
      });
      await waitFor(() => expect(harness.term.text).toContain('while-inactive'));
    });
  });

  describe('재연결', () => {
    it('예기치 않은 끊김이면 새 소켓을 연다', async () => {
      renderTerminal();
      const first = await openSocket();

      await act(async () => { first.serverClose(1006); });

      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(1), { timeout: 3000 });
      expect(harness.socket).not.toBe(first);
    });

    it('연결이 열려 있으면 하트비트 ping 을 보낸다', async () => {
      renderTerminal();
      const ws = await openSocket();

      await act(async () => { await new Promise((r) => setTimeout(r, 5200)); });

      expect(ws.jsonSent().some((m) => m.type === 'ping')).toBe(true);
    }, 10000);
  });

  describe('재연결 — 티켓', () => {
    /* 서버가 연결 중 미리 밀어준 티켓을 쓰면 재연결 때 /api/ws-ticket fetch 를 건너뛴다.
       모바일 네트워크 전환으로 wedge 된 HTTP/2 풀을 우회하는 핵심 경로. */
    it('서버가 푸시한 티켓을 다음 재연결에 재사용한다 (fetch 생략)', async () => {
      renderTerminal();
      const first = await openSocket();
      const ticketCallsBefore = vi.mocked(issueWsTicket).mock.calls.length;

      await act(async () => {
        first.serverSend(JSON.stringify({
          type: 'ws_ticket',
          ticket: 'pushed-ticket',
          expires_at: Math.floor(Date.now() / 1000) + 60,
        }));
      });
      await act(async () => { first.serverClose(); });

      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(1), { timeout: 3000 });
      expect(harness.socket.url).toContain('ticket=pushed-ticket');
      // 티켓을 이미 들고 있었으므로 발급 fetch 를 다시 하지 않는다.
      expect(vi.mocked(issueWsTicket).mock.calls.length).toBe(ticketCallsBefore);
    });

    /* 로그아웃/세션만료로 티켓을 못 받으면, 로그인 화면 전환 위에 "셸 종료" 오버레이까지
       겹쳐 띄우면 안 된다(로그아웃마다 무서운 에러가 뜨는 것처럼 보인다). */
    it('인증 만료로 티켓을 못 받으면 종료 오버레이를 띄우지 않는다', async () => {
      vi.mocked(issueWsTicket).mockResolvedValueOnce({ ticket: null, authExpired: true });
      renderTerminal();

      await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

      expect(harness.sockets.length).toBe(0);
      expect(screen.queryByText(/셸이 종료|Shell ended/i)).toBeNull();
    });
  });

  describe('재연결 — 세션 소멸', () => {
    /* 호스트 재부팅 등으로 원격 tmux 세션이 통째로 사라진 경우. create=0 재시도는 전부 같은
       결과라 "[session not found]" 스팸만 반복된다 → 새 세션 생성으로 전환해야 한다. */
    it('session-gone 직후 끊기면 새 세션 생성(create 생략)으로 재연결한다', async () => {
      renderTerminal({ hostId: 'h1', tmuxSessionName: 'work' });
      const first = await openSocket();

      await act(async () => { first.serverSend(JSON.stringify({ type: 'session-gone' })); });
      await act(async () => { first.serverClose(); });

      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(1), { timeout: 3000 });
      // create=0 이 없다 = 없으면 만들어라(새 세션).
      expect(harness.socket.url).not.toContain('create=0');
    });

    it('평범한 끊김은 기존 셸에만 재연결한다 (create=0)', async () => {
      renderTerminal();
      const first = await openSocket();

      await act(async () => { first.serverClose(); });

      await waitFor(() => expect(harness.sockets.length).toBeGreaterThan(1), { timeout: 3000 });
      expect(harness.socket.url).toContain('create=0');
    });
  });

  describe('재연결 — preflight 판정', () => {
    it('다른 기기가 붙어 있으면 자동 재연결하지 않고 인계 카드를 띄운다', async () => {
      // preflight 가 "다른 클라이언트가 attach 중" 이라고 답하게 한다.
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ attached: true, other_client_active: true, same_client_active: false, exists: true }),
      }));

      renderTerminal();
      const first = await openSocket();
      await act(async () => { first.serverClose(); });

      // TAKEOVER_CONFIRM_MS(3.5s) 동안 재확인한 뒤에야 확정한다 — 단발 오탐 방지.
      await act(async () => { await new Promise((r) => setTimeout(r, 4500)); });

      await waitFor(() => expect(screen.getByText(/다른 기기에서 접속 중|Another device/i)).toBeTruthy());
    }, 15000);

    it('셸이 정말 종료됐으면(exists=false) pane 을 자동으로 닫는다', async () => {
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ attached: false, exists: false }),
      }));
      const onClosePane = vi.fn();

      renderTerminal({ onClosePane });
      const first = await openSocket();
      await act(async () => { first.serverClose(); });

      /* 전환 레이스(attach 중, tmux 재기동)와 겹칠 수 있어 RECOVERY_GRACE_MS(12s) 동안
         회복을 기다린 뒤에야 종료로 확정하고, AUTO_CLOSE_MS(1.8s) 취소 여유를 준다. */
      await act(async () => { await new Promise((r) => setTimeout(r, 15000)); });

      expect(onClosePane).toHaveBeenCalled();
    }, 25000);
  });

  describe('리사이즈', () => {
    it('크기가 바뀌면 서버에 새 cols/rows 를 보낸다', async () => {
      renderTerminal();
      const ws = await openSocket();
      await waitFor(() => expect(ws.jsonSent().some((m) => m.type === 'resize')).toBe(true));

      vi.mocked(measureTerminalFit).mockReturnValue({ cols: 120, rows: 40, remainderX: 0, remainderY: 0 });
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
        await new Promise((r) => setTimeout(r, 400));
      });

      await waitFor(() => {
        expect(ws.jsonSent().some((m) => m.type === 'resize' && m.cols === 120 && m.rows === 40)).toBe(true);
      });
    });
  });

  describe('WebGL 수명', () => {
    // 컨텍스트는 브라우저당 ~16개 한도 — 비활성 pane 이 물고 있으면 고갈되어 탭이 통째로 죽는다.
    it('활성이면 부착하고, 비활성이 되면 유예 후 반납한다', async () => {
      const props = { sessionId: 'gl', settings: testSettings({ useWebgl: true }), isFocused: true };
      const { rerender } = render(<TerminalComponent {...props} isActive={true} />);
      await openSocket();

      await waitFor(() => expect(harness.webgl).toBeTruthy());
      const addon = harness.webgl;
      expect(addon.dispose).not.toHaveBeenCalled();

      // 주의: rerender 와 대기를 한 act() 에 넣으면 안 된다 — 이펙트가 act 종료 시점에야
      // flush 돼서 반납 타이머가 대기가 끝난 뒤에 걸린다. act 를 나눠 이펙트를 먼저 태운다.
      await act(async () => { rerender(<TerminalComponent {...props} isActive={false} />); });
      // WEBGL_DETACH_GRACE_MS(8s) 유예를 넘겨야 반납한다 — 빠른 탭 전환 churn 방지용 유예.
      await act(async () => { await new Promise((r) => setTimeout(r, 8400)); });

      expect(addon.dispose).toHaveBeenCalled();
    }, 20000);
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
