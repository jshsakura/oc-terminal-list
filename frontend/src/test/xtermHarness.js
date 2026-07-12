import { vi } from 'vitest';

/**
 * Terminal.jsx 테스트용 하네스.
 *
 * xterm.js 는 jsdom 에서 실제로 못 뜬다(canvas/WebGL). 애드온과 WebSocket 을 대역으로
 * 세워 컴포넌트의 *관찰 가능한 계약* — 어떤 URL 로 WS 를 열고, 받은 바이트를 term 에
 * 쓰고, 어떤 오버레이를 띄우고, 언마운트 때 무엇을 정리하는지 — 만 검증한다.
 */

// 마지막으로 만들어진 인스턴스들 — 테스트가 여기로 term/ws 를 집어 조작한다.
export const harness = {
  terms: [],
  sockets: [],
  reset() {
    this.terms = [];
    this.sockets = [];
  },
  get term() { return this.terms[this.terms.length - 1]; },
  get socket() { return this.sockets[this.sockets.length - 1]; },
};

const makeBuffer = () => ({
  active: {
    type: 'normal',
    viewportY: 0,
    length: 0,
    getLine: () => null,
  },
});

export class FakeTerminal {
  constructor(options = {}) {
    this.options = { ...options };
    this.cols = 80;
    this.rows = 24;
    this.buffer = makeBuffer();
    this.modes = { mouseTrackingMode: 'none' };
    this.unicode = { activeVersion: '6' };
    this.element = null;
    this.written = [];
    this.disposed = false;
    this.focused = false;
    this.pasted = [];
    // 컴포넌트가 등록한 콜백들 — 테스트에서 직접 발화시킨다.
    this.handlers = {};
    this._core = {};

    this.loadAddon = vi.fn((addon) => { addon._terminal = this; addon.activate?.(this); });
    this.open = vi.fn((el) => {
      this.element = el;
      // .xterm-screen 조회를 하는 코드가 있어 하나 심어둔다.
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      el?.appendChild?.(screen);
    });
    this.focus = vi.fn(() => { this.focused = true; });
    this.dispose = vi.fn(() => { this.disposed = true; });
    this.paste = vi.fn((t) => this.pasted.push(t));
    this.clear = vi.fn();
    this.getSelection = vi.fn(() => '');
    this.hasSelection = vi.fn(() => false);
    this.clearSelection = vi.fn();
    this.select = vi.fn();
    this.scrollLines = vi.fn();
    this.scrollPages = vi.fn();
    this.scrollToTop = vi.fn();
    this.scrollToBottom = vi.fn();
    this.resize = vi.fn();
    this.attachCustomWheelEventHandler = vi.fn((h) => { this.handlers.wheel = h; });
    this.attachCustomKeyEventHandler = vi.fn((h) => { this.handlers.key = h; });
    this.onBell = vi.fn((h) => { this.handlers.bell = h; });
    this.onData = vi.fn((h) => { this.handlers.data = h; });
    this.onScroll = vi.fn((h) => { this.handlers.scroll = h; });
    this.onSelectionChange = vi.fn((h) => { this.handlers.selection = h; });

    // write(data, cb) — 실제 xterm 처럼 파싱 후 비동기로 콜백. 컴포넌트는 이 콜백에서
    // hasContent 를 세우고 백프레셔 카운터를 차감한다.
    this.write = vi.fn((data, cb) => {
      this.written.push(data);
      if (cb) queueMicrotask(cb);
    });

    harness.terms.push(this);
  }

  // 테스트 편의 — 터미널에 실제로 그려진 텍스트
  get text() {
    const dec = new TextDecoder();
    return this.written
      .map((w) => (typeof w === 'string' ? w : dec.decode(w)))
      .join('');
  }
}

export class FakeFitAddon {
  constructor() {
    this._terminal = null;
    this.fit = vi.fn();
    this.proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  }
  activate(term) { this._terminal = term; }
  dispose() {}
}

class NoopAddon {
  activate() {}
  dispose() {}
}

export class FakeSearchAddon extends NoopAddon {
  constructor() {
    super();
    this.findNext = vi.fn(() => true);
    this.findPrevious = vi.fn(() => true);
    this.clearDecorations = vi.fn();
  }
}

export class FakeWebglAddon extends NoopAddon {
  constructor() {
    super();
    this.onContextLoss = vi.fn();
    this.dispose = vi.fn();
  }
}

/** 테스트가 직접 open/close/message 를 발화시키는 WebSocket 대역. */
export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.sent = [];
    this.binaryType = '';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.closed = false;
    harness.sockets.push(this);
  }

  send(data) { this.sent.push(data); }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // ── 테스트에서 서버 역할 ──
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  serverSend(data) {
    this.onmessage?.({ data });
  }

  // 주의: TextEncoder().encode(t).buffer 를 그대로 쓰면 안 된다. 이 환경의 TextEncoder 는
  // Node 렐름이라 그 .buffer 가 jsdom 의 ArrayBuffer 와 instanceof 가 어긋나고, 컴포넌트의
  // `event.data instanceof ArrayBuffer` 분기가 조용히 빗나간다(브라우저엔 없는 함정).
  // 컴포넌트가 보는 것과 같은 렐름의 ArrayBuffer 를 직접 만들어 채운다.
  serverSendBytes(text) {
    const bytes = new TextEncoder().encode(text);
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    this.onmessage?.({ data: buf });
  }

  serverClose(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  /** 컴포넌트가 JSON 으로 보낸 메시지들 (ping/resize 등) */
  jsonSent() {
    return this.sent
      .filter((s) => typeof s === 'string' && s.startsWith('{'))
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
  }
}

/** 테스트에서 쓰는 최소 settings — 컴포넌트가 읽는 키만. */
export const testSettings = (over = {}) => ({
  theme: 'catppuccin',
  fontSize: 14,
  fontFamily: 'monospace',
  smoothScroll: false,
  autoScroll: true,
  defaultShell: 'bash',
  language: 'en',
  terminalContrast: 'high',
  predictiveEcho: false,
  useWebgl: false,
  bellNotifications: false,
  ...over,
});
