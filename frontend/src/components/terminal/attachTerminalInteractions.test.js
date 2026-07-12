import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./terminalHelpers', () => ({
  copyTextToClipboard: vi.fn(async () => true),
  uploadImageAndGetPath: vi.fn(async () => ({ path: '/ws/.pasted/a.webp' })),
}));

import attachTerminalInteractions from './attachTerminalInteractions';
import { copyTextToClipboard, uploadImageAndGetPath } from './terminalHelpers';

/* 휠/터치 라우팅은 실기기 회귀가 가장 잦은 곳이다(마우스로는 재현이 안 된다).
   xterm 없이 순수 모듈로 검증한다 — 셀 10x20px, 80칸 x 20줄 화면. */

const OPEN = 1;

const makeTerm = (over = {}) => {
  // 진짜 DOM 이어야 한다 — 자연 마우스 선택이 screen.contains(e.target) 를 부른다.
  const screenEl = document.createElement('div');
  screenEl.className = 'xterm-screen';
  screenEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 });
  const termEl = document.createElement('div');
  termEl.appendChild(screenEl);
  const term = {
    screenEl,
    cols: 80,
    rows: 20,
    buffer: { active: { type: 'normal', viewportY: 0 } },
    modes: { mouseTrackingMode: 'none' },
    element: termEl,
    _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } },
    handlers: {},
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    clearSelection: vi.fn(),
    scrollLines: vi.fn(),
    select: vi.fn(),
    paste: vi.fn(),
    focus: vi.fn(),
    attachCustomWheelEventHandler: vi.fn(function (h) { this.handlers.wheel = h; }),
    attachCustomKeyEventHandler: vi.fn(function (h) { this.handlers.key = h; }),
    onSelectionChange: vi.fn(function (h) { this.handlers.selection = h; }),
    ...over,
  };
  return term;
};

// jsdom 의 TouchEvent 는 touches 를 생성자로 못 넣는다 — Event 에 직접 얹는다.
const touchEvent = (type, x, y, count = 1) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.touches = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
  return e;
};

const keyEvent = (over = {}) => ({
  type: 'keydown',
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault: vi.fn(),
  ...over,
});

describe('attachTerminalInteractions', () => {
  let term;
  let container;
  let overlay;
  let input;
  let socket;
  let setContextMenu;
  let setCopyFlash;
  let setImagePasteState;
  let handle;

  const mount = (opts = {}) => {
    handle = attachTerminalInteractions({
      term,
      container,
      overlay,
      input,
      getSocket: () => socket,
      isMobile: () => false,
      sessionId: 's1',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      setContextMenu,
      setCopyFlash,
      setImagePasteState,
      ...opts,
    });
    return handle;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    term = makeTerm();
    container = document.createElement('div');
    overlay = document.createElement('div');
    document.body.append(container, overlay);
    input = { push: vi.fn() };
    socket = { readyState: OPEN };
    setContextMenu = vi.fn();
    setCopyFlash = vi.fn();
    setImagePasteState = vi.fn();
  });

  afterEach(() => {
    handle?.detach();
    container.remove();
    overlay.remove();
  });

  describe('휠 스크롤 라우팅', () => {
    const wheel = (deltaY, deltaMode = 0) => term.handlers.wheel({ deltaY, deltaMode, clientX: 55, clientY: 45 });

    it('일반 버퍼에서는 xterm 스크롤백을 직접 굴린다', () => {
      mount();
      wheel(60); // 60px / 20px = 3줄

      expect(term.scrollLines).toHaveBeenCalledWith(3);
      expect(input.push).not.toHaveBeenCalled();
    });

    /* tmux/vim 은 alt-screen 을 쓴다 — xterm 로컬 스크롤백은 진짜 히스토리가 아니라서
       굴려봐야 빈 화면만 나온다. SGR 휠 리포트를 앱으로 보내야 앱이 스크롤한다.
       (기억: "claude/vim 안에서 휠이 안 먹는다" 회귀의 근원이 이 분기다) */
    it('alt-screen(tmux/vim)에서는 SGR 휠 리포트를 앱으로 보낸다', () => {
      term.buffer.active.type = 'alternate';
      mount();
      wheel(60);

      expect(term.scrollLines).not.toHaveBeenCalled();
      expect(input.push).toHaveBeenCalledTimes(1);
      // 3줄 아래 → 버튼 65 를 3번, 좌표는 (6칸, 3줄) — 55px/10, 45px/20 → 1-based
      expect(input.push.mock.calls[0][0]).toBe('\x1b[<65;6;3M'.repeat(3));
    });

    it('마우스 트래킹이 켜져 있으면 일반 버퍼여도 앱으로 보낸다', () => {
      term.modes.mouseTrackingMode = 'any';
      mount();
      wheel(20);

      expect(term.scrollLines).not.toHaveBeenCalled();
      expect(input.push).toHaveBeenCalled();
    });

    it('위로 굴리면 버튼 64, 아래로 굴리면 65', () => {
      term.buffer.active.type = 'alternate';
      mount();

      wheel(-20);
      expect(input.push.mock.calls[0][0]).toContain('[<64;');

      wheel(20);
      expect(input.push.mock.calls[1][0]).toContain('[<65;');
    });

    it('분수 줄은 누적했다가 한 줄이 될 때만 스크롤한다 (트랙패드 부드러운 스크롤)', () => {
      mount();
      wheel(8);  // 0.4줄
      wheel(8);  // 누적 0.8줄
      expect(term.scrollLines).not.toHaveBeenCalled();

      wheel(8);  // 누적 1.2줄 → 1줄 발화, 0.2 남김
      expect(term.scrollLines).toHaveBeenCalledWith(1);
    });

    it('한 이벤트로 보내는 휠 리포트를 12개로 제한한다 (관성 스크롤이 tmux 를 익사시키지 않게)', () => {
      term.buffer.active.type = 'alternate';
      mount();
      wheel(2000); // 100줄

      const reports = input.push.mock.calls[0][0].match(/\x1b\[</g).length;
      expect(reports).toBe(12);
    });

    it('스크롤하면 기존 선택을 지운다', () => {
      term.hasSelection = vi.fn(() => true);
      mount();
      wheel(60);

      expect(term.clearSelection).toHaveBeenCalled();
    });

    it('소켓이 닫혀 있으면 휠 리포트를 보내지 않는다', () => {
      term.buffer.active.type = 'alternate';
      socket = { readyState: 3 };
      mount();
      wheel(60);

      expect(input.push).not.toHaveBeenCalled();
    });

    it('xterm 기본 처리를 항상 막는다 (우리가 처리했으므로)', () => {
      mount();
      expect(wheel(60)).toBe(false);
    });
  });

  describe('모바일 터치', () => {
    it('세로 드래그는 스크롤한다', () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 100, 200));
      overlay.dispatchEvent(touchEvent('touchmove', 100, 140)); // 위로 60px

      expect(term.scrollLines).toHaveBeenCalledWith(3);
    });

    it('가로 우세 제스처는 스크롤로 치지 않는다', () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 100, 200));
      overlay.dispatchEvent(touchEvent('touchmove', 300, 198)); // 가로 200px, 세로 2px

      expect(term.scrollLines).not.toHaveBeenCalled();
    });

    it('손가락 두 개(핀치 등)는 무시한다', () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 100, 200, 2));
      overlay.dispatchEvent(touchEvent('touchmove', 100, 140, 2));

      expect(term.scrollLines).not.toHaveBeenCalled();
    });

    /* 짧은 탭 → 포커스. touchstart 에서 preventDefault 했으므로 합성 click 이 안 온다 —
       여기서 직접 focus 해야 iOS 키보드가 올라온다. */
    it('짧은 탭은 터미널을 포커스한다 (iOS 키보드)', () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 100, 200));
      overlay.dispatchEvent(touchEvent('touchend', 100, 200));

      expect(term.focus).toHaveBeenCalled();
    });

    it('스크롤한 뒤의 touchend 는 포커스하지 않는다', () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 100, 200));
      overlay.dispatchEvent(touchEvent('touchmove', 100, 140));
      overlay.dispatchEvent(touchEvent('touchend', 100, 140));

      expect(term.focus).not.toHaveBeenCalled();
    });

    it('길게 누르면 컨텍스트 메뉴를 연다', async () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 120, 220));
      await new Promise((r) => setTimeout(r, 560)); // LONG_PRESS_MS = 500

      expect(setContextMenu).toHaveBeenCalledWith({ x: 120, y: 220, hasSelection: false });
    });

    it('스크롤 중이면 롱프레스가 뜨지 않는다', async () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 120, 220));
      overlay.dispatchEvent(touchEvent('touchmove', 120, 160));
      await new Promise((r) => setTimeout(r, 560));

      expect(setContextMenu).not.toHaveBeenCalled();
    });
  });

  describe('우클릭 메뉴', () => {
    const rightDown = () => container.dispatchEvent(
      new MouseEvent('mousedown', { button: 2, clientX: 30, clientY: 40, bubbles: true, cancelable: true }),
    );

    it('우클릭 mousedown 에서 메뉴를 연다 (원격 TUI 로 새어나가기 전에)', () => {
      mount();
      rightDown();

      expect(setContextMenu).toHaveBeenCalledWith({ x: 30, y: 40, hasSelection: false });
    });

    it('뒤따르는 contextmenu 는 중복으로 열지 않는다', () => {
      mount();
      rightDown();
      container.dispatchEvent(new MouseEvent('contextmenu', { clientX: 30, clientY: 40, bubbles: true, cancelable: true }));

      expect(setContextMenu).toHaveBeenCalledTimes(1);
    });

    it('좌클릭은 메뉴를 열지 않는다', () => {
      mount();
      container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));

      expect(setContextMenu).not.toHaveBeenCalled();
    });
  });

  describe('키 가로채기', () => {
    it('Ctrl+Shift+F 는 앱 검색을 연다', () => {
      mount();
      const spy = vi.fn();
      window.addEventListener('terminal:open-search', spy);

      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }));

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0].detail).toEqual({ sessionId: 's1' });
      window.removeEventListener('terminal:open-search', spy);
    });

    it('F12 는 브라우저에 양보한다', () => {
      mount();
      expect(term.handlers.key(keyEvent({ key: 'F12' }))).toBe(false);
    });

    /* Ctrl+V 는 false 만 돌려 xterm 처리를 막되 preventDefault 는 하지 않는다 —
       그래야 브라우저가 paste 이벤트를 발화하고 권한 없이 클립보드를 읽을 수 있다. */
    it('Ctrl+V 는 xterm 처리만 막고 브라우저 paste 는 살려둔다', () => {
      mount();
      const e = keyEvent({ key: 'v', ctrlKey: true });

      expect(term.handlers.key(e)).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('선택이 있을 때 Ctrl+Shift+C 는 복사한다', () => {
      term.getSelection = vi.fn(() => 'picked');
      mount();
      const e = keyEvent({ key: 'c', ctrlKey: true, shiftKey: true });

      expect(term.handlers.key(e)).toBe(false);
      expect(copyTextToClipboard).toHaveBeenCalledWith('picked');
    });

    it('선택이 없으면 Ctrl+Shift+C 를 터미널로 흘려보낸다', () => {
      mount();
      expect(term.handlers.key(keyEvent({ key: 'c', ctrlKey: true, shiftKey: true }))).toBe(true);
      expect(copyTextToClipboard).not.toHaveBeenCalled();
    });

    it('keydown 이 아닌 이벤트는 건드리지 않는다', () => {
      mount();
      expect(term.handlers.key(keyEvent({ type: 'keyup', key: 'F12' }))).toBe(true);
    });
  });

  describe('붙여넣기', () => {
    const pasteEvent = (items, text = '') => {
      const e = new Event('paste', { bubbles: true, cancelable: true });
      e.clipboardData = { items, getData: () => text };
      return e;
    };

    it('텍스트는 그대로 터미널에 붙인다', () => {
      mount();
      container.dispatchEvent(pasteEvent([], 'ls -la'));

      expect(term.paste).toHaveBeenCalledWith('ls -la');
    });

    // PTY 는 텍스트만 나른다 — 이미지는 서버에 올리고 그 *경로* 를 대신 입력한다.
    it('이미지는 업로드해서 저장 경로를 붙인다', async () => {
      mount();
      const blob = new File(['x'], 'a.png', { type: 'image/png' });
      container.dispatchEvent(pasteEvent([{ kind: 'file', type: 'image/png', getAsFile: () => blob }]));

      await vi.waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledWith(blob));
      await vi.waitFor(() => expect(term.paste).toHaveBeenCalledWith('/ws/.pasted/a.webp '));
      expect(setImagePasteState).toHaveBeenCalledWith('uploading');
    });

    it('업로드가 실패하면 경로를 붙이지 않고 실패를 알린다', async () => {
      vi.mocked(uploadImageAndGetPath).mockRejectedValueOnce(new Error('boom'));
      mount();
      const blob = new File(['x'], 'a.png', { type: 'image/png' });
      container.dispatchEvent(pasteEvent([{ kind: 'file', type: 'image/png', getAsFile: () => blob }]));

      await vi.waitFor(() => expect(setImagePasteState).toHaveBeenCalledWith('error'));
      expect(term.paste).not.toHaveBeenCalled();
    });

    it('빈 클립보드는 무시한다', () => {
      mount();
      container.dispatchEvent(pasteEvent([], ''));

      expect(term.paste).not.toHaveBeenCalled();
    });
  });

  describe('선택 → 자동 복사', () => {
    it('드래그가 멎으면 한 번만 클립보드에 쓴다', async () => {
      term.getSelection = vi.fn(() => 'dragged');
      mount();

      // 드래그 중에는 매 mousemove 마다 발화한다 — 마지막 것만 살아남아야 한다.
      term.handlers.selection();
      term.handlers.selection();
      term.handlers.selection();
      await new Promise((r) => setTimeout(r, 120)); // SELECTION_SETTLE_MS = 80

      expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
      expect(copyTextToClipboard).toHaveBeenCalledWith('dragged');
    });

    it('모바일에서는 자동 복사하지 않는다 (선택 핸들 조작을 방해한다)', async () => {
      term.getSelection = vi.fn(() => 'dragged');
      mount({ isMobile: () => true });

      term.handlers.selection();
      await new Promise((r) => setTimeout(r, 120));

      expect(copyTextToClipboard).not.toHaveBeenCalled();
    });
  });

  /* tmux/vim 이 마우스 트래킹을 켜도 PC 기본 UX 는 지킨다: 클릭은 앱으로 보내고,
     임계값을 넘겨 끌기 시작할 때만 xterm 선택으로 전환한다. */
  describe('자연스러운 마우스 선택 (마우스 트래킹 중에도)', () => {
    const down = (x, y, target) => {
      const e = new MouseEvent('mousedown', { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'target', { value: target ?? term.screenEl });
      container.dispatchEvent(e);
    };
    const move = (x, y) => document.dispatchEvent(
      new MouseEvent('mousemove', { buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );

    beforeEach(() => { term.modes.mouseTrackingMode = 'any'; });

    it('임계값(5px) 밑의 움직임은 선택으로 치지 않는다 — 클릭은 앱으로 간다', () => {
      mount();
      down(50, 50);
      move(52, 52);

      expect(term.select).not.toHaveBeenCalled();
    });

    it('임계값을 넘겨 끌면 xterm 선택으로 전환한다', () => {
      mount();
      down(50, 50);   // 셀 (5, 2) 0-based
      move(150, 90);  // 셀 (15, 4)

      expect(term.select).toHaveBeenCalled();
      const [column, row, length] = term.select.mock.calls[0];
      expect({ column, row }).toEqual({ column: 5, row: 2 });
      expect(length).toBe(2 * 80 + (15 - 5) + 1); // 두 줄 + 10칸 + 1
    });

    it('마우스 트래킹이 꺼져 있으면 xterm 기본 선택에 맡긴다', () => {
      term.modes.mouseTrackingMode = 'none';
      mount();
      down(50, 50);
      move(150, 90);

      expect(term.select).not.toHaveBeenCalled();
    });

    it('화면 밖(스크롤바 등)에서 시작한 드래그는 무시한다', () => {
      mount();
      down(50, 50, container);
      move(150, 90);

      expect(term.select).not.toHaveBeenCalled();
    });

    it('버튼을 뗀 뒤의 움직임은 더 이상 선택하지 않는다', () => {
      mount();
      down(50, 50);
      move(150, 90);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      term.select.mockClear();

      move(250, 130);
      expect(term.select).not.toHaveBeenCalled();
    });
  });

  describe('detach', () => {
    it('걷어낸 뒤에는 리스너가 반응하지 않는다', () => {
      mount();
      handle.detach();
      handle = null;

      container.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
      overlay.dispatchEvent(touchEvent('touchstart', 10, 10));
      overlay.dispatchEvent(touchEvent('touchend', 10, 10));

      expect(setContextMenu).not.toHaveBeenCalled();
      expect(term.focus).not.toHaveBeenCalled();
    });

    it('걷어내면 대기 중인 롱프레스도 취소된다', async () => {
      mount();
      overlay.dispatchEvent(touchEvent('touchstart', 10, 10));
      handle.detach();
      handle = null;
      await new Promise((r) => setTimeout(r, 560));

      expect(setContextMenu).not.toHaveBeenCalled();
    });
  });
});
