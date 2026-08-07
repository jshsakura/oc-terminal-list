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
import { _resetProbeLease } from './terminal/outageProbe';

/**
 * 장기 장애(outage) — 터널이 죽었거나 서버가 내려간 상태.
 *
 * 여기서 앱이 지켜야 할 두 가지가 충돌한다:
 *  1) 절대 포기하지 않는다. mosh 처럼 인페이지로 무한 복구한다("셸 종료" 데드엔드 금지).
 *  2) 죽은 서버를 두들기지 않는다. 재시도 간격을 키워 공유 터널을 포화시키지 않는다.
 * 그래서 백오프(4→8→16→30s)로 살살 두드리되, /api/health 로 서버 복귀를 감지하면
 * 남은 백오프를 기다리지 않고 즉시 붙는다.
 */

const settings = testSettings();
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

const renderTerminal = (props = {}) => render(
  <TerminalComponent sessionId="s1" settings={settings} isActive isFocused {...props} />
);

// 서버가 죽었다: 소켓은 만들어지지만 절대 열리지 않는다(연결 타임아웃 8s 마다 버려진다).
const startOutage = async () => {
  await tick(20);
  await act(async () => { harness.socket.serverOpen(); });
  await act(async () => { harness.socket.serverClose(); });
};

const gapsBetweenSockets = () => harness.sockets
  .slice(1)
  .map((ws, i) => ws.createdAt - harness.sockets[i].createdAt);

/* 백오프 *대기* 구간(직전 소켓은 죽었고 다음 재시도는 예약만 된 상태)까지 흘린다.
   갓 시작한 핸드셰이크(3s 미만 CONNECTING) 위에서는 복귀 신호가 일부러 아무것도 안 한다 —
   멀쩡한 시도를 끊고 새로 여는 게 더 나쁘기 때문. 그 구간을 피해서 착지시켜야 한다. */
const settleIntoBackoffGap = async () => {
  for (let i = 0; i < 60; i++) {
    if (harness.socket?.closed) return;
    await tick(1000);
  }
  throw new Error('백오프 대기 구간에 도달하지 못했다');
};

describe('Terminal 장기 장애', () => {
  let realWebSocket;
  let realFetch;
  let health; // /api/health 응답을 테스트가 조종한다

  beforeEach(() => {
    harness.reset();
    _resetProbeLease();
    vi.useFakeTimers();
    // 백오프에 지터(Math.random)가 섞여 있다 — 고정해야 타이밍이 재현 가능하다.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    realWebSocket = global.WebSocket;
    realFetch = global.fetch;
    global.WebSocket = FakeWebSocket;

    health = { ok: false };
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/health')) {
        if (health.throws) throw new Error('down');
        return { ok: health.ok, status: health.ok ? 200 : 502, json: async () => ({}) };
      }
      // preflight 등 — 세션은 살아있다고 답한다(셸 종료로 오인하지 않게).
      return { ok: true, status: 200, json: async () => ({ attached: false, exists: true }) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    global.WebSocket = realWebSocket;
    global.fetch = realFetch;
    delete window.terminalSessions;
  });

  /* 재연결 버스트(횟수 12회 / 벽시계 90s)를 다 소진해도 "셸 종료" 데드엔드로 끝내지 않는다.
     셸이 죽었다는 증거는 없고 연결이 안 붙을 뿐이다 — 계속 두드리면 터널/서버 복귀 시
     새로고침 없이 살아난다. */
  it('버스트를 다 소진해도 포기하지 않고 계속 재연결한다', async () => {
    renderTerminal();
    await startOutage();

    await tick(150000); // 벽시계 상한(90s)을 한참 넘긴다

    expect(screen.queryByText('Shell ended')).toBeNull(); // 데드엔드 금지
    expect(screen.getByText(/Reconnecting…/i)).toBeTruthy(); // 차분한 pill 만
    const before = harness.sockets.length;

    await tick(60000);
    expect(harness.sockets.length).toBeGreaterThan(before); // 여전히 시도 중
  }, 30000);

  /* 죽은 터널을 1초마다 두들기면 공유 Cloudflare 터널이 포화되어 다른 사이트까지 죽는다.
     라운드가 올라갈수록 간격을 키운다(4→8→16→30s cap). */
  it('장애가 길어질수록 재시도 간격을 키운다', async () => {
    renderTerminal();
    await startOutage();

    await tick(240000);

    const gaps = gapsBetweenSockets();
    expect(gaps.length).toBeGreaterThan(4);

    // 초반 시도는 빠르고(즉시 복구 노림), 후반은 느리다(터널 보호).
    const early = Math.min(...gaps.slice(0, 2));
    const late = Math.max(...gaps.slice(-2));
    expect(late).toBeGreaterThan(early);
    // 상한을 지킨다 — 아무리 길어져도 30s + 연결타임아웃(8s) 안쪽.
    expect(Math.max(...gaps)).toBeLessThanOrEqual(30000 + 8000 + 1000);
  }, 30000);

  /* 긴 백오프(최대 30s) 대기 중 서버가 돌아와도 그걸 다 기다리면 체감이 나쁘다.
     활성·가시 pane 하나만 /api/health 를 저부하로 두드려 복귀를 즉시 감지한다. */
  it('서버가 돌아오면(down→up) 남은 백오프를 기다리지 않고 즉시 붙는다', async () => {
    renderTerminal();
    await startOutage();

    /* 백오프가 상한(30s)에 닿을 때까지 흘린다. 시도 횟수(12회)를 먼저 소진해야 라운드가
       오르기 시작하므로 꽤 오래 걸린다 — 그래야 "기다리지 않았다" 가 증명된다. */
    await tick(400000);
    // 이 시점의 간격은 38s(백오프 30s 상한 + 연결 타임아웃 8s)다.
    const lastGap = gapsBetweenSockets().at(-1);
    expect(lastGap).toBeGreaterThan(20000);

    const before = harness.sockets.length;

    // 서버 복귀. 복귀 순간이 "연결 시도 중"(최대 8s) 창에 떨어질 수 있으므로 그만큼 여유를 준다.
    health.ok = true;
    await tick(15000);

    // 백오프(30s)만 있었다면 이 창 안에 새 소켓이 생길 수 없다 → 프로브가 앞당긴 것.
    expect(harness.sockets.length).toBeGreaterThan(before);
  }, 30000);


  /* 프로브 게이트가 isActive 였던 시절, **분할 형제는 전부 isActive=true** 라 pane 수만큼
     곱해서 두드렸다. 이 앱의 장애는 대개 공유 터널 포화라 — 막혀서 생긴 장애를 프로브가
     더 밀어붙였다. 이제 페이지당 한 pane 만 두드린다(outageProbe.js 의 리스).
     사다리(간격 확대)는 순수 테스트가 덮는다 — 여기서 검증할 수 없는 건 pane 간 조율뿐이다. */
  it('분할 형제가 넷이어도 /api/health 를 두드리는 pane 은 하나뿐이다', async () => {
    render(
      <>
        <TerminalComponent sessionId="p1" paneId="p1" settings={settings} isActive isFocused />
        <TerminalComponent sessionId="p2" paneId="p2" settings={settings} isActive isFocused={false} />
        <TerminalComponent sessionId="p3" paneId="p3" settings={settings} isActive isFocused={false} />
        <TerminalComponent sessionId="p4" paneId="p4" settings={settings} isActive isFocused={false} />
      </>,
    );
    // 네 pane 을 **모두** 장애로 몰아넣는다 — harness.socket 은 마지막 하나만 가리킨다.
    await tick(20);
    for (const ws of [...harness.sockets]) {
      await act(async () => { ws.serverOpen(); });
      await act(async () => { ws.serverClose(); });
    }
    // 프로브는 백오프 대기가 OUTAGE_PROBE_MIN_DELAY_MS(4s) 를 넘어야 켜진다 — 라운드가
    // 오를 때까지 흘린다(기존 down→up 테스트와 같은 이유로 오래 걸린다).
    await tick(400000);

    const countHealth = () => global.fetch.mock.calls
      .filter((c) => String(c[0]).includes('/api/health')).length;
    const before = countHealth();
    await tick(30000);
    const during = countHealth() - before;

    expect(during).toBeGreaterThan(0);          // 그래도 복귀 감지는 살아있어야 한다
    expect(during).toBeLessThanOrEqual(12);     // pane 4개가 각자 3s 로 두드리면 40회였다
  }, 30000);

  /* 첫 프로브부터 성공이면 서버는 원래 살아있는데 WS 쪽만 실패 중인 것 —
     조기 재연결해봐야 3s 주기 hammering 만 된다. 프로브를 접고 백오프에 맡긴다. */
  it('서버가 계속 살아있었으면 프로브로 조기 재연결하지 않는다', async () => {
    health.ok = true; // 서버는 처음부터 멀쩡 — 죽은 건 WS 경로뿐이다
    renderTerminal();
    await startOutage();

    await tick(400000);

    /* 프로브가 성공했다고 매번 앞당기면 3s 주기 hammering 이 된다. down→up "전환" 이
       아니었으므로 프로브는 접히고, 재시도 간격은 백오프 그대로(38s) 유지돼야 한다. */
    expect(gapsBetweenSockets().at(-1)).toBeGreaterThan(20000);
  }, 30000);

  /* 사용자가 돌아온 순간(포커스/online)은 "지금 네트워크가 살아났다"는 가장 강한 신호다 —
     백오프를 리셋하고 즉시 재시도한다. */
  it('포커스 복귀는 백오프를 리셋하고 즉시 재시도한다', async () => {
    renderTerminal();
    await startOutage();

    await tick(400000); // 백오프가 상한(간격 38s)에 닿은 상태
    await settleIntoBackoffGap();
    const before = harness.sockets.length;

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await tick(500);

    // 1) 예약된 백오프(수십 초)를 기다리지 않고 곧바로 재시도한다.
    expect(harness.sockets.length).toBeGreaterThan(before);

    /* 2) 백오프 자체가 리셋됐다 — 다시 실패해도 다음 시도는 38s 가 아니라 빠른 버스트로
          돌아간다. 사용자가 돌아온 순간은 "지금 네트워크가 살아났다"는 강한 신호라
          다시 공격적으로 붙어봐야 한다. */
    const resumedIdx = harness.sockets.length - 1;
    const resumedAt = harness.sockets[resumedIdx].createdAt;
    await tick(20000);
    const nextTry = harness.sockets[resumedIdx + 1];
    // 리셋 안 됐다면 다음 시도는 38s 뒤다. 리셋됐으면 연결타임아웃(8s) 직후 바로 재시도.
    expect(nextTry.createdAt - resumedAt).toBeLessThan(15000);
  }, 30000);

  it('online 이벤트도 즉시 재시도를 깨운다', async () => {
    renderTerminal();
    await startOutage();

    await tick(180000);
    await settleIntoBackoffGap();
    const before = harness.sockets.length;

    await act(async () => { window.dispatchEvent(new Event('online')); });
    await tick(500);

    expect(harness.sockets.length).toBeGreaterThan(before);
  }, 30000);
});
