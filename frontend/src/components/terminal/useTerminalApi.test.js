import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';

vi.mock('./terminalHelpers', () => ({
  copyTextToClipboard: vi.fn(async () => true),
  looksLikeBulkCommand: vi.fn(() => false),
}));
vi.mock('../../utils/commandHistory', () => ({ pushCommand: vi.fn() }));

import useTerminalApi from './useTerminalApi';
import { copyTextToClipboard, looksLikeBulkCommand } from './terminalHelpers';
import { pushCommand } from '../../utils/commandHistory';

const OPEN = 1;

/* Terminal 의 명령형 API. 빠른입력·모바일바·커맨드팔레트가 전부 이걸 통해 터미널을 만진다 —
   여기가 조용히 깨지면 "명령을 보냈는데 아무 일도 안 일어남" 이 된다. */

// 버퍼에 line 들을 채운 가짜 xterm.
const makeTerm = (lines = [], over = {}) => ({
  buffer: {
    active: {
      type: 'normal',
      viewportY: 0,
      length: lines.length,
      getLine: (i) => (lines[i] === undefined ? null : { translateToString: () => lines[i] }),
    },
  },
  getSelection: vi.fn(() => ''),
  scrollPages: vi.fn(),
  scrollLines: vi.fn(),
  scrollToTop: vi.fn(),
  focus: vi.fn(),
  clear: vi.fn(),
  write: vi.fn(),
  ...over,
});

const setup = (over = {}) => {
  const term = over.term ?? makeTerm();
  const socket = over.socket ?? { readyState: OPEN, send: vi.fn() };
  const enqueue = over.enqueue ?? vi.fn(() => true);
  const search = { findNext: vi.fn(() => true), findPrevious: vi.fn(() => true), clearDecorations: vi.fn() };
  const webgl = { noteActivity: vi.fn() };
  const scrollToBottom = vi.fn();
  const fitNow = vi.fn();

  const refs = {
    xtermRef: { current: term },
    wsRef: { current: socket },
    searchAddonRef: { current: search },
    enqueueInputRef: { current: enqueue },
    forceScrollToBottomRef: { current: scrollToBottom },
    fitNowRef: { current: fitNow },
    webglRef: { current: webgl },
    lastDimsRef: { current: { cols: 120, rows: 40 } },
    evictedRef: { current: false },
    endedRef: { current: false },
    hasContentRef: { current: true },
  };

  const forwardedRef = createRef();
  const hook = renderHook(() => useTerminalApi({
    refs,
    forwardedRef,
    sessionId: over.sessionId ?? 's1',
    paneId: 'p1',
    tabId: 't1',
    isReady: true,
  }));

  return { hook, refs, term, socket, enqueue, search, webgl, scrollToBottom, fitNow, forwardedRef };
};

const api = (sessionId = 's1') => window.terminalSessions[sessionId];

describe('useTerminalApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(looksLikeBulkCommand).mockReturnValue(false);
  });
  afterEach(() => { delete window.terminalSessions; });

  describe('입력 주입', () => {
    it('sendData 는 입력 큐를 태운다 (순서 보존·백프레셔)', () => {
      const { enqueue, socket } = setup();

      expect(api().sendData('ls')).toBe(true);
      expect(enqueue).toHaveBeenCalledWith('ls', { delay: 0 });
      expect(socket.send).not.toHaveBeenCalled();
    });

    it('큐가 없으면(정리 직후 등) 소켓으로 직접 보낸다', () => {
      const { refs, socket } = setup();
      refs.enqueueInputRef.current = null; // 이펙트 정리로 큐가 내려간 상태

      expect(api().sendData('ls')).toBe(true);
      expect(socket.send).toHaveBeenCalledWith('ls');
    });

    it('큐도 없고 소켓도 닫혔으면 false 를 돌려준다', () => {
      const { refs } = setup({ socket: { readyState: 3, send: vi.fn() } });
      refs.enqueueInputRef.current = null;

      expect(api().sendData('ls')).toBe(false);
    });

    // 개행이 없으면 셸이 명령을 실행하지 않는다 — 커서만 깜빡이고 "안 먹네" 가 된다.
    it('sendCommand 는 개행을 보장한다', () => {
      const { enqueue } = setup();

      api().sendCommand('echo hi');
      expect(enqueue).toHaveBeenCalledWith('echo hi\r', expect.anything());

      enqueue.mockClear();
      api().sendCommand('echo hi\n'); // 이미 개행이면 덧붙이지 않는다
      expect(enqueue).toHaveBeenCalledWith('echo hi\n', expect.anything());
    });

    /* 명령은 큐 앞에 꽂고(priority), 밀린 휠 리포트는 걷어낸다(dropQueuedWheel).
       안 그러면 스크롤 이벤트 뒤에 줄서서 한참 뒤에 실행된다. */
    it('sendCommand 는 우선순위로 넣고 밀린 휠을 걷어낸다', () => {
      const { enqueue, scrollToBottom } = setup();

      api().sendCommand('ls');

      expect(enqueue).toHaveBeenCalledWith('ls\r', { delay: 0, priority: true, dropQueuedWheel: true });
      expect(scrollToBottom).toHaveBeenCalled(); // 보낸 결과가 보이게 맨 아래로
    });

    it('빈 명령은 보내지 않는다', () => {
      const { enqueue } = setup();
      expect(api().sendCommand('   ')).toBe(false);
      expect(api().sendCommand('')).toBe(false);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('sendCommand 는 히스토리에 남긴다', () => {
      setup();
      api().sendCommand('git status');
      expect(pushCommand).toHaveBeenCalledWith('s1', 'git status');
    });

    it('sendData 는 명령처럼 보일 때만 히스토리에 남긴다', () => {
      setup();
      api().sendData('a'); // 단일 키 — 히스토리 오염 금지
      expect(pushCommand).not.toHaveBeenCalled();

      vi.mocked(looksLikeBulkCommand).mockReturnValue(true);
      api().sendData('npm run build\r');
      expect(pushCommand).toHaveBeenCalledWith('s1', 'npm run build\r');
    });
  });

  describe('스크롤', () => {
    /* alt-screen(vim/tmux)에는 스크롤백이 없다. 여기서 PgUp/PgDn escape 를 PTY 로 보내면
       편집 중인 파일에 `^[[5~` 가 그대로 박힌다 — 그래서 아무것도 하지 않는다. */
    it('alt-screen 에서는 스크롤 요청을 무시한다', () => {
      const term = makeTerm([]);
      term.buffer.active.type = 'alternate';
      setup({ term });

      api().scrollPages(-1);
      api().scrollLines(-3);
      api().scrollToTop();

      expect(term.scrollPages).not.toHaveBeenCalled();
      expect(term.scrollLines).not.toHaveBeenCalled();
      expect(term.scrollToTop).not.toHaveBeenCalled();
    });

    it('일반 버퍼에서는 xterm 스크롤백을 굴린다', () => {
      const { term } = setup();

      api().scrollPages(-1);
      api().scrollLines(5);
      api().scrollToTop();

      expect(term.scrollPages).toHaveBeenCalledWith(-1);
      expect(term.scrollLines).toHaveBeenCalledWith(5);
      expect(term.scrollToTop).toHaveBeenCalled();
    });

    it('0 은 무시한다', () => {
      const { term } = setup();
      api().scrollPages(0);
      api().scrollLines(0);
      expect(term.scrollPages).not.toHaveBeenCalled();
      expect(term.scrollLines).not.toHaveBeenCalled();
    });

    it('scrollToBottom 은 스마트스크롤을 통해 내린다', () => {
      const { scrollToBottom } = setup();
      api().scrollToBottom();
      expect(scrollToBottom).toHaveBeenCalled();
    });
  });

  describe('버퍼 읽기 / 복사', () => {
    it('스크롤백 전체를 평문으로 뽑고 끝의 빈 줄은 버린다', () => {
      setup({ term: makeTerm(['first', 'second', '', '']) });
      expect(api().getBufferText(true)).toBe('first\nsecond');
    });

    it('viewport 만 뽑을 수도 있다', () => {
      const term = makeTerm(['old1', 'old2', 'visible']);
      term.buffer.active.viewportY = 2;
      setup({ term });
      expect(api().getBufferText(false)).toBe('visible');
    });

    it('copyAll 은 버퍼 전체를 클립보드에 넣는다', async () => {
      setup({ term: makeTerm(['line1', 'line2']) });

      await act(async () => { await api().copyAll(); });

      expect(copyTextToClipboard).toHaveBeenCalledWith('line1\nline2');
    });

    it('버퍼가 비었으면 복사하지 않고 false 를 돌려준다', async () => {
      setup({ term: makeTerm([]) });

      let result;
      await act(async () => { result = await api().copyAll(); });

      expect(result).toBe(false);
      expect(copyTextToClipboard).not.toHaveBeenCalled();
    });
  });

  describe('검색', () => {
    it('앞뒤로 증분 검색한다', () => {
      const { search } = setup();

      api().searchNext('needle');
      expect(search.findNext).toHaveBeenCalledWith('needle', { incremental: true });

      api().searchPrevious('needle');
      expect(search.findPrevious).toHaveBeenCalledWith('needle', { incremental: true });

      api().closeSearch();
      expect(search.clearDecorations).toHaveBeenCalled();
    });

    it('빈 질의는 검색하지 않는다', () => {
      const { search } = setup();
      expect(api().searchNext('')).toBe(false);
      expect(search.findNext).not.toHaveBeenCalled();
    });
  });

  describe('포커스 / WebGL', () => {
    // 포커스 = 곧 타이핑한다 → idle 로 반납했던 WebGL 을 미리 붙여 repaint 를 눈에 안 띄게.
    it('포커스하면 WebGL 활동을 알린다', () => {
      const { term, webgl } = setup();

      api().focus();

      expect(term.focus).toHaveBeenCalled();
      expect(webgl.noteActivity).toHaveBeenCalled();
    });
  });

  describe('전역 레지스트리', () => {
    it('sessionId 로 등록하고 언마운트 시 지운다', () => {
      const { hook } = setup({ sessionId: 'reg' });
      expect(window.terminalSessions.reg).toBeTruthy();

      hook.unmount();
      expect(window.terminalSessions.reg).toBeUndefined();
    });

    it('소켓 상태를 문자열로 노출한다 (Info 패널용)', () => {
      const s = setup();
      expect(api().getConnectionState()).toBe('open');

      s.refs.wsRef.current = { readyState: 0 };
      expect(api().getConnectionState()).toBe('connecting');

      s.refs.wsRef.current = null;
      expect(api().getConnectionState()).toBe('closed');
    });

    it('현재 터미널 크기를 복사해서 준다 (내부 ref 유출 금지)', () => {
      const { refs } = setup();
      const dims = api().getDims();

      expect(dims).toEqual({ cols: 120, rows: 40 });
      dims.cols = 999;
      expect(refs.lastDimsRef.current.cols).toBe(120); // 원본 불변
    });

    it('마우스 트래킹을 escape 로 켜고 끈다', () => {
      const { term } = setup();

      api().setMouseTracking(true);
      expect(term.write).toHaveBeenCalledWith('\x1b[?1000h\x1b[?1002h\x1b[?1006h');

      api().setMouseTracking(false);
      expect(term.write).toHaveBeenCalledWith('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
    });

    it('세션 상태를 스냅샷으로 준다', () => {
      setup({ sessionId: 'snap' });
      expect(api('snap').getSessionStatus()).toMatchObject({
        evicted: false,
        ended: false,
        isReady: true,
        hasContent: true,
        sessionId: 'snap',
        paneId: 'p1',
        tabId: 't1',
      });
    });
  });

  describe('forwardRef', () => {
    // 부모 PaneGrid 가 broadcast fan-out 에서 이 ref 로 sendData 를 부른다.
    it('부모에게 sendData / sendCommand 를 노출한다', () => {
      const { forwardedRef, enqueue } = setup();

      expect(typeof forwardedRef.current.sendData).toBe('function');
      forwardedRef.current.sendCommand('pwd');

      expect(enqueue).toHaveBeenCalledWith('pwd\r', expect.anything());
    });
  });
});
