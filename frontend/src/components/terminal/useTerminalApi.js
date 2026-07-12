import { useCallback, useEffect, useImperativeHandle } from 'react';
import { copyTextToClipboard, looksLikeBulkCommand } from './terminalHelpers';
import { pushCommand as pushCommandHistory } from '../../utils/commandHistory';

/**
 * Terminal 의 명령형 API — 스크롤·검색·복사·입력 주입.
 *
 * 두 군데로 노출한다:
 *  - forwardRef (부모 PaneGrid 가 broadcast fan-out 에 sendData 를 쓴다)
 *  - window.terminalSessions[sessionId] (빠른입력·모바일바·커맨드팔레트가 전역으로 찾는다)
 *
 * 전부 ref 위에서만 동작한다 — 렌더 상태를 읽지 않으므로 WS/xterm 이 재생성돼도
 * 콜백 정체성이 유지되고, 여기서 나가는 함수들이 stale 해지지 않는다.
 */
const useTerminalApi = ({ refs, forwardedRef, sessionId, paneId, tabId, isReady }) => {
  const {
    xtermRef, wsRef, searchAddonRef,
    enqueueInputRef, forceScrollToBottomRef, fitNowRef, webglRef,
    lastDimsRef, evictedRef, endedRef, hasContentRef,
  } = refs;

  // 입력 큐를 우선 태우고(순서 보존·백프레셔), 큐가 없으면 소켓으로 직접.
  const sendData = useCallback((data) => {
    if (looksLikeBulkCommand(data)) {
      try { pushCommandHistory(sessionId, data); } catch { /* noop */ }
    }
    if (enqueueInputRef.current?.(data, { delay: 0 })) return true;
    if (wsRef.current?.readyState === WebSocket.OPEN && typeof data === 'string') {
      wsRef.current.send(data);
      return true;
    }
    return false;
  }, [sessionId, enqueueInputRef, wsRef]);

  // 명령 한 줄 — 개행을 보장하고, 스크롤을 맨 아래로 내린 뒤 큐 앞에 꽂는다(priority).
  // dropQueuedWheel — 밀린 휠 이벤트를 걷어내 명령이 스크롤 뒤에 밀리지 않게.
  const sendCommand = useCallback((command) => {
    if (typeof command !== 'string' || !command.trim()) return false;
    try { pushCommandHistory(sessionId, command); } catch { /* noop */ }
    try { forceScrollToBottomRef.current?.(); } catch { /* noop */ }
    const payload = command.endsWith('\r') || command.endsWith('\n') ? command : `${command}\r`;
    if (enqueueInputRef.current?.(payload, { delay: 0, priority: true, dropQueuedWheel: true })) {
      return true;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload);
      return true;
    }
    return false;
  }, [sessionId, enqueueInputRef, forceScrollToBottomRef, wsRef]);

  useImperativeHandle(forwardedRef, () => ({ sendData, sendCommand }), [sendData, sendCommand]);

  const getSelection = useCallback(() => xtermRef.current?.getSelection() || '', [xtermRef]);

  const scrollToBottom = useCallback(() => {
    forceScrollToBottomRef.current?.();
  }, [forceScrollToBottomRef]);

  /* 페이지/라인 단위 스크롤 — xterm 의 클라이언트 스크롤백만 만진다.
     PgUp/PgDn escape 를 PTY 로 보내면 셸/에디터가 해석 못 해 `^[[5~` 가 파일에 박힌다.
     alt-screen(vim/tmux) 에서는 스크롤백 자체가 없으므로 아무것도 하지 않는다. */
  const scrollableBuffer = useCallback(() => {
    const term = xtermRef.current;
    if (!term || term.buffer?.active?.type !== 'normal') return null;
    return term;
  }, [xtermRef]);

  const scrollPages = useCallback((pages) => {
    if (pages === 0) return;
    const term = scrollableBuffer();
    if (!term) return;
    try { term.scrollPages(pages); } catch { /* noop */ }
  }, [scrollableBuffer]);

  const scrollLines = useCallback((lines) => {
    if (lines === 0) return;
    const term = scrollableBuffer();
    if (!term) return;
    try { term.scrollLines(lines); } catch { /* noop */ }
  }, [scrollableBuffer]);

  const scrollToTop = useCallback(() => {
    const term = scrollableBuffer();
    if (!term) return;
    try { term.scrollToTop(); } catch { /* noop */ }
  }, [scrollableBuffer]);

  /* 버퍼 전체 → 평문. 모바일은 손가락 선택이 까다로워 화면을 통째로 넘겨주는 편의 기능에 쓴다.
     includeScrollback=false 면 현재 viewport 만. */
  const getBufferText = useCallback((includeScrollback = true) => {
    const term = xtermRef.current;
    if (!term) return '';
    const buf = term.buffer.active;
    const start = includeScrollback ? 0 : buf.viewportY;
    const lines = [];
    for (let i = start; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      lines.push(line.translateToString(true)); // true = 우측 공백 trim
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }, [xtermRef]);

  const copyAll = useCallback(async () => {
    const text = getBufferText(true);
    if (!text) return false;
    await copyTextToClipboard(text);
    return true;
  }, [getBufferText]);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
    // 포커스 복귀 = 활동 → 타이핑 전에 미리 WebGL 을 재부착해 repaint 가 눈에 안 띄게.
    webglRef.current?.noteActivity();
  }, [xtermRef, webglRef]);

  const clear = useCallback(() => {
    xtermRef.current?.clear();
  }, [xtermRef]);

  const searchNext = useCallback((query, options = {}) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findNext(query, { incremental: true, ...options }) || false;
  }, [searchAddonRef]);

  const searchPrevious = useCallback((query, options = {}) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findPrevious(query, { incremental: true, ...options }) || false;
  }, [searchAddonRef]);

  const closeSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
  }, [searchAddonRef]);

  // 전역 세션 관리자에 등록 — 빠른입력/모바일바/팔레트가 sessionId 로 찾아 쓴다.
  useEffect(() => {
    if (!window.terminalSessions) window.terminalSessions = {};
    window.terminalSessions[sessionId] = {
      sendData,
      sendCommand,
      getSelection,
      getBufferText,
      copyAll,
      scrollToBottom,
      scrollToTop,
      scrollPages,
      scrollLines,
      focus,
      clear,
      fit: () => fitNowRef.current?.('api'),
      searchNext,
      searchPrevious,
      closeSearch,
      // xterm 에 PTY 출력인 척 escape 를 주입. 마우스 트래킹 임시 제어 등에 쓴다.
      writeEscape: (seq) => xtermRef.current?.write(seq),
      setMouseTracking: (enabled) => {
        const term = xtermRef.current;
        if (!term) return;
        term.write(enabled
          ? '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
          : '\x1b[?1000l\x1b[?1002l\x1b[?1006l');
      },
      /* Info 패널이 읽어가는 라이브 메타데이터 — 값이 ref 기반이라 항상 최신
         (객체 자체는 그대로 두고 내부 ref 만 변한다). */
      getDims: () => ({ ...lastDimsRef.current }),
      getConnectionState: () => {
        const ws = wsRef.current;
        if (!ws) return 'closed';
        switch (ws.readyState) {
          case WebSocket.CONNECTING: return 'connecting';
          case WebSocket.OPEN:       return 'open';
          case WebSocket.CLOSING:    return 'closing';
          default:                   return 'closed';
        }
      },
      getSessionStatus: () => ({
        evicted: evictedRef.current,
        ended: endedRef.current,
        isReady,
        hasContent: hasContentRef.current,
        sessionId,
        paneId,
        tabId,
      }),
    };

    return () => {
      if (window.terminalSessions) delete window.terminalSessions[sessionId];
    };
  }, [
    sessionId, paneId, tabId, isReady,
    sendData, sendCommand, getSelection, getBufferText, copyAll,
    scrollToBottom, scrollToTop, scrollPages, scrollLines,
    focus, clear, searchNext, searchPrevious, closeSearch,
    xtermRef, wsRef, fitNowRef, lastDimsRef, evictedRef, endedRef, hasContentRef,
  ]);

  return { sendData, sendCommand, copyAll, focus };
};

export default useTerminalApi;
