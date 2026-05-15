/**
 * Terminal 컴포넌트
 * xterm.js 기반 터미널 에뮬레이터 (테마 및 스마트 스크롤 지원)
 */
import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { MonitorSmartphone, PowerOff, Copy, ClipboardPaste, Scissors, ArrowDownToLine, RotateCcw, AlertTriangle, X, KeyRound } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { tokens } from '../styles/tokens';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';

const { fontSize, fontWeight, lineHeight, radius, shadow, space } = tokens;

// clipboard.writeText 가 없거나 비-HTTPS 컨텍스트에서 실패할 경우 textarea 폴백.
const copyTextToClipboard = (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  }
  execCommandCopy(text);
  return Promise.resolve();
};

const execCommandCopy = (text) => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch { /* noop */ }
  document.body.removeChild(ta);
};

const TerminalComponent = ({ sessionId, hostId, isMobile = false, tmuxSuffix = null, tmuxSessionName = null, effectiveTmuxSession = null, settings, onSendData, isActive = true, layoutSignal = '', cwd = null, paneIndex = 0, paneId = null, tabId = null, onTakeOver = null, onReadyChange = null, onStatusChange = null }) => {
  const { t } = useTranslation(settings.language);
  const terminalRef = useRef(null);
  const touchOverlayRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  const wsRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const resizeTrailingTimeoutRef = useRef(null);
  const fitNowRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const wsFlushTimeoutRef = useRef(null);
  const wsBufferRef = useRef([]);
  const inputQueueRef = useRef([]);
  const inputFlushTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const lastDimsRef = useRef({ cols: 0, rows: 0 });
  /* 다른 클라이언트가 takeover (tmux attach -d) 했을 때 PTY 출력에 들어오는
     `[detached (from session ...)]` 토큰을 감지해 evictedRef 를 세움. WS close 시 이 ref 가
     true 면 자동 재접속 로직을 모두 skip — 사용자가 직접 "내가 가져오기" 버튼을 눌러야만 재attach. */
  const evictedRef = useRef(false);
  const endedRef = useRef(false);
  const hasContentRef = useRef(false);
  /* useEffect 내부의 connect()/runPreflight() 를 takeover 버튼/자동 재attach 폴링/탭 활성 변경에서
     호출할 수 있게 ref 로 공개. */
  const connectRef = useRef(null);
  const runPreflightRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [evicted, setEvicted] = useState(false);
  const [ended, setEnded] = useState(false);
  const contentReadyRef = useRef(false);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // 상태 변화 시 부모에 통지 — evicted, ended, isReady, hasContent 변경마다 호출
  const notifyStatus = useCallback(() => {
    onStatusChangeRef.current?.({
      evicted: evictedRef.current,
      ended: endedRef.current,
      isReady,
      hasContent: hasContentRef.current,
      sessionId,
      paneId,
      tabId,
    });
  }, [sessionId, paneId, tabId, isReady]);

  // 터미널 상태 변화 시마다 부모 통지 (evicted, ended, isReady, hasContent ref 동기화)
  useEffect(() => {
    hasContentRef.current = hasContent;
    notifyStatus();
  }, [evicted, ended, isReady, hasContent, notifyStatus]);

  // 모바일 여부를 이벤트 리스너 내부에서 최신 상태로 참조하기 위함
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);

  const [authPrompt, setAuthPrompt] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [tmuxFallback, setTmuxFallback] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const copyFlashTimerRef = useRef(null);
  // authPrompt 열고 닫을 때 전역 이벤트 — App.jsx 가 모바일 단축키바를 그동안 숨김.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: !!authPrompt } }));
  }, [authPrompt]);

  // 스마트 스크롤 훅 — xterm buffer API 기반 (DOM scrollTop 아님)
  const { handleUserScroll, handleNewData } = useSmartScroll(xtermRef, {
    autoScroll: settings.autoScroll,
  });
  // handleNewData 는 autoScroll 설정에 의존하므로 렌더링마다 바뀔 수 있음.
  // useEffect 내부의 flushBufferedOutput 클로저가 항상 최신 콜백을 참조하도록 ref 유지.
  const handleNewDataRef = useRef(handleNewData);
  handleNewDataRef.current = handleNewData;

  // 테마 가져오기
  const currentTheme = themes[settings.theme] || themes.catppuccin;
  const themeUi = buildThemeUI(currentTheme);

  // 터미널 생성 및 WebSocket 연결
  useEffect(() => {
    if (!terminalRef.current) return;

    // 모바일에서 키보드 팝업 시 화면 밀림 방지를 위한 CSS 주입
    const styleId = 'xterm-mobile-fix';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        /* xterm.js 의 숨겨진 입력창이 브라우저 스크롤을 유발하지 않게 터미널 상단에 고정 */
        .xterm .xterm-helper-textarea {
          top: 0 !important;
          left: 0 !important;
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          z-index: -1 !important;
          opacity: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }

    // xterm 스크롤바 완전 제거
    // 1) .xterm-viewport 네이티브 브라우저 스크롤바
    // 2) .xterm-scrollable-element > .scrollbar — xterm 자체 DOM 오버레이 스크롤바 (스크롤 시 .visible 추가됨)
    const scrollbarFixId = 'xterm-scrollbar-fix-v2';
    if (!document.getElementById(scrollbarFixId)) {
      document.getElementById('xterm-scrollbar-fix')?.remove();
      const style = document.createElement('style');
      style.id = scrollbarFixId;
      style.innerHTML = `
        .xterm .xterm-viewport {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
          overflow-x: hidden !important;
        }
        .xterm .xterm-viewport::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
          background: transparent !important;
        }
        .xterm-scroll-area {
          scrollbar-width: none !important;
        }
        .xterm-scroll-area::-webkit-scrollbar {
          display: none !important;
        }
        .xterm .xterm-scrollable-element > .scrollbar {
          display: none !important;
        }
        .xterm .xterm-scrollable-element > .shadow {
          display: none !important;
        }
        /* Let iOS native-scroll the xterm-viewport (overflow-y:scroll covers the full
           terminal area). xterm.js _handleScroll fires on scrollTop changes and
           re-renders the canvas — no custom JS touch handler needed. */
        .xterm .xterm-viewport {
          -webkit-overflow-scrolling: touch;
        }
      `;
      document.head.appendChild(style);
    }

    setIsReady(false);
    setHasContent(false);
    contentReadyRef.current = false;
    hasContentRef.current = false;
    evictedRef.current = false;
    endedRef.current = false;
    onReadyChangeRef.current?.(false);

    // 1. xterm.js 인스턴스 생성 (최신 프리미엄 옵션 적용)
    const terminalFont = normalizeTerminalFontFamily(settings.fontFamily);
    const term = new Terminal({
      theme: currentTheme,
      fontFamily: terminalFont,
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      scrollback: 3000,
      tabStopWidth: 4,
      minimumContrastRatio: 7,
      allowProposedApi: true,
      convertEol: false,
      bracketedPasteMode: true,
      windowsMode: false,
      smoothScrollDuration: settings.smoothScroll ? 100 : 0,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      altClickMovesCursor: true,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // FitAddon v0.11.0 이 scrollbarWidth 만큼 cols 를 과소계산해서 우측 빈틈 생기는 문제 해결.
    // proposeDimensions 를 덮어써 scrollbarWidth 공제를 완전히 스킵.
    const origPropose = fitAddon.proposeDimensions.bind(fitAddon);
    fitAddon.proposeDimensions = function() {
      const t = this._terminal;
      if (!t?.element?.parentElement) return origPropose();
      const core = t._core;
      const dims = core?._renderService?.dimensions;
      if (!dims || dims.css.cell.width === 0) return origPropose();
      const parentStyle = window.getComputedStyle(t.element.parentElement);
      const parentH = parseInt(parentStyle.getPropertyValue('height'));
      const parentW = Math.max(0, parseInt(parentStyle.getPropertyValue('width')));
      const elStyle = window.getComputedStyle(t.element);
      const padH = parseInt(elStyle.getPropertyValue('padding-left')) + parseInt(elStyle.getPropertyValue('padding-right'));
      const padV = parseInt(elStyle.getPropertyValue('padding-top')) + parseInt(elStyle.getPropertyValue('padding-bottom'));
      return {
        cols: Math.max(2, Math.floor((parentW - padH) / dims.css.cell.width)),
        rows: Math.max(1, Math.floor((parentH - padV) / dims.css.cell.height)),
      };
    };

    const origFit = fitAddon.fit.bind(fitAddon);
    fitAddon.fit = function() {
      const container = terminalRef.current;
      if (container) {
        container.style.width = '100%';
        container.style.height = '100%';
      }
      origFit();
    };

    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);

    // NOTE: xterm v6 에서 FitAddon 은 core.viewport.scrollBarWidth 대신
    // options.overviewRuler?.width || DEFAULT_SCROLL_BAR_WIDTH(=14) 를 사용하므로
    // 위에서 proposeDimensions 를 monkey-patch 해서 scrollbarWidth 공제를 스킵함.
    // 아래 defineProperty 도 혹시 모를 내부 viewport 참조용으로 유지.
    try {
      const core = term._core;
      if (core?.viewport) {
        Object.defineProperty(core.viewport, 'scrollBarWidth', {
          configurable: true,
          get: () => 0,
          set: () => {},
        });
      }
    } catch {}

    // Wheel/touch scroll routing.
    // tmux attach runs the outer xterm in the alternate buffer, so xterm's local
    // scrollback cannot represent the real tmux history. In that state we send
    // SGR mouse-wheel reports to tmux. This intentionally prioritizes scrolling
    // over native xterm mouse selection/copy behavior.
    let wheelLineRemainder = 0;
    let touchLineRemainder = 0;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const getCellHeight = () => (
      term._core?._renderService?.dimensions?.css?.cell?.height
      || Math.max(1, Math.round((term.element?.clientHeight || 0) / Math.max(1, term.rows)))
      || 17
    );

    const deltaToLines = (deltaY, deltaMode = 0) => {
      if (deltaMode === 1) return deltaY;
      if (deltaMode === 2) return deltaY * Math.max(1, term.rows);
      return deltaY / getCellHeight();
    };

    const cellFromClientPoint = (clientX, clientY) => {
      const screen = term.element?.querySelector('.xterm-screen') || term.element;
      const rect = screen?.getBoundingClientRect?.();
      const dims = term._core?._renderService?.dimensions?.css?.cell;
      const cellW = dims?.width || Math.max(1, (rect?.width || 0) / Math.max(1, term.cols)) || 9;
      const cellH = dims?.height || getCellHeight();
      const x = Number.isFinite(clientX) ? clientX : ((rect?.left || 0) + (rect?.width || 0) / 2);
      const y = Number.isFinite(clientY) ? clientY : ((rect?.top || 0) + (rect?.height || 0) / 2);
      return {
        col: clamp(Math.floor((x - (rect?.left || 0)) / cellW) + 1, 1, Math.max(1, term.cols)),
        row: clamp(Math.floor((y - (rect?.top || 0)) / cellH) + 1, 1, Math.max(1, term.rows)),
      };
    };

    const sendTmuxWheel = (lines, clientX, clientY, source = 'wheel') => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || lines === 0) return;
      const { col, row } = cellFromClientPoint(clientX, clientY);
      const button = lines < 0 ? 64 : 65; // SGR mouse: wheel up/down
      const maxPerEvent = source === 'touch' ? 8 : 12;
      const count = Math.min(maxPerEvent, Math.max(1, Math.abs(lines)));
      let payload = '';
      for (let i = 0; i < count; i++) {
        payload += `\x1b[<${button};${col};${row}M`;
      }
      ws.send(payload);
    };

    const handleTerminalScrollDelta = (deltaY, deltaMode, clientX, clientY, source = 'wheel') => {
      const rawLines = deltaToLines(deltaY, deltaMode);
      if (!Number.isFinite(rawLines) || rawLines === 0) return false;

      if (source === 'touch') {
        touchLineRemainder += rawLines;
      } else {
        wheelLineRemainder += rawLines;
      }
      const remainder = source === 'touch' ? touchLineRemainder : wheelLineRemainder;
      const lines = Math.trunc(remainder);
      if (source === 'touch') {
        touchLineRemainder -= lines;
      } else {
        wheelLineRemainder -= lines;
      }
      if (lines === 0) return true;

      const buf = term.buffer?.active;
      if (buf?.type === 'normal') {
        try { term.scrollLines(lines); } catch { /* noop */ }
      } else {
        sendTmuxWheel(lines, clientX, clientY, source);
      }
      return true;
    };

    // attachCustomWheelEventHandler return semantics (from xterm.d.ts):
    //   return true  → allow xterm.js default processing
    //   return false → cancel xterm.js processing (we handled it)
    term.attachCustomWheelEventHandler((e) => {
      handleTerminalScrollDelta(e.deltaY, e.deltaMode, e.clientX, e.clientY, 'wheel');
      return false;
    });

    // WebGL 렌더러 — 디폴트 ON. 입력 → 화면 반영이 DOM 보다 훨씬 빠르고
    // CPU 점유도 낮아진다. 단, 초기화 실패하거나 GPU context 가 lost 되면
    // 조용히 dispose 하고 xterm.js 의 DOM 렌더러로 자동 폴백 (사용자 개입 X).
    // 명시적으로 false 를 저장한 사용자(특정 GPU 이슈 회피용)는 그대로 OFF.
    const wantWebgl = settings?.useWebgl !== false;
    if (wantWebgl) {
      let webglAddon = null;
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          // GPU context 가 죽으면 더 못 그림 → dispose 후 자동으로 DOM 렌더러가 인계.
          try { webglAddon?.dispose(); } catch { /* 이미 정리됨 */ }
          webglAddon = null;
        });
        term.loadAddon(webglAddon);
      } catch (e) {
        // 초기화 실패 (WebGL 비활성 환경, iframe 정책 등) — 조용히 폴백.
        try { webglAddon?.dispose(); } catch { /* noop */ }
        if (localStorage.getItem('debug_terminal') === '1') {
          console.warn('[xterm] WebGL init failed, using DOM renderer:', e);
        }
      }
    }

    const handleKeyDown = (e) => {
      // Ctrl+Shift+F → 검색 — 표준 터미널 컨벤션과 별개의 앱 단축키
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('terminal:open-search', { detail: { sessionId } }));
      }
    };

    /* xterm 키 가로채기 — Ctrl+V → paste, Ctrl+Shift+C → copy, F12 → DevTools. */

    // paste 이벤트: ClipboardEvent.clipboardData → clipboard-read 권한 불필요.
    // capture 단계(true)에서 xterm 자체 핸들러보다 먼저 실행해 중복 전송 방지.
    const handlePaste = (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      term.paste(text);
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.key === 'F12') return false;
      // Ctrl+V / Cmd+V: return false(xterm 처리 중단) but e.preventDefault() 호출 안 함 →
      // 브라우저가 paste 이벤트를 발화 → handlePaste 가 clipboardData 로 권한 없이 읽음.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
        return false;
      }
      // Ctrl+Shift+C (Linux/Win) 또는 Cmd+C (Mac, 선택 있을 때) → copy
      if ((e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) ||
          (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C'))) {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          copyTextToClipboard(sel);
          return false;
        }
      }
      return true;
    });

    // 우클릭: 네이티브 컨텍스트 메뉴를 막아 tmux 가 마우스 이벤트를 처리할 수 있게 함.
    // 단, 모바일에서 텍스트 선택이 있는 경우엔 '복사' 등을 위해 네이티브 메뉴 허용.
    const handleContextMenu = (e) => {
      e.preventDefault();
      const term = xtermRef.current;
      if (!term) return;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        hasSelection: !!term.hasSelection(),
      });
    };

    /* 드래그 중 mousemove 마다 onSelectionChange fire — 정착(80ms idle) 후 한 번만 클립보드 write.
       race / 이중 발화 방지. */
    let selectionTimer = null;
    term.onSelectionChange(() => {
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const selection = term.getSelection();
        // 모바일은 자동 복사가 방해될 수 있으므로 (선택 핸들 유지 등) PC 에서만 자동 복사.
        if (selection && !isMobileRef.current) {
          copyTextToClipboard(selection).then(() => {
            setCopyFlash(true);
            if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
            copyFlashTimerRef.current = setTimeout(() => setCopyFlash(false), 1800);
          });
        }
      }, 80);
    });

    const container = terminalRef.current;
    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('paste', handlePaste, true);

    // Mobile scroll + long-press: 오버레이 div가 canvas 위에서 터치를 독점 처리.
    // touch-action:none 이 오버레이에 있으므로 iOS가 scroll 제스처를 선점하지 않고
    // touchmove passive:false 에서 preventDefault() 가 보장됨.
    const overlay = touchOverlayRef.current;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchScrolling = false;
    let scrollAccum = 0;
    let longPressTimer = null;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isTouchScrolling = false;
      scrollAccum = 0;
      longPressTimer = setTimeout(() => {
        if (!isTouchScrolling) {
          const t = xtermRef.current;
          if (t) setContextMenu({ x: touchStartX, y: touchStartY, hasSelection: !!t.hasSelection() });
        }
      }, 500);
    };

    const handleTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      clearTimeout(longPressTimer);
      const dy = touchStartY - e.touches[0].clientY; // positive = 손가락 위로
      const dx = Math.abs(e.touches[0].clientX - touchStartX);

      if (!isTouchScrolling) {
        if (Math.abs(dy) > 5 && Math.abs(dy) > dx) isTouchScrolling = true;
        else return;
      }

      e.preventDefault();
      touchStartY = e.touches[0].clientY;
      scrollAccum += dy;

      handleTerminalScrollDelta(scrollAccum, 0, e.touches[0].clientX, e.touches[0].clientY, 'touch');
      scrollAccum = 0;
    };

    const handleTouchEnd = () => { clearTimeout(longPressTimer); };

    if (overlay) {
      overlay.addEventListener('touchstart', handleTouchStart, { passive: true });
      overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
      overlay.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });


    // ⚠️  WS 연결 전에 fit() 동기 호출 — xterm.js 의 cols/rows 와 백엔드/tmux 에
    // 알리는 차원이 일치하도록 한다. 늦게 fit 하면 첫 렌더가 80x24 로 나간 뒤
    // 컨테이너 실제 크기로 리사이즈되며 초기 viewport 가 잘려 빈 화면처럼 보인다.
    try {
      fitAddon.fit();
    } catch (e) {
      // 컨테이너가 아직 0x0 인 극단 케이스 방어
    }
    term.focus();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('auth_token');
    const shell = encodeURIComponent(settings.defaultShell || 'bash');

    /* preflight 결과로 WS 오픈을 gating. 다른 기기가 이미 attach 중이면 건드리지 않고
       evicted 오버레이만 띄움. 사용자가 명시적으로 "내가 가져오기" 누를 때까지 대기. */
    let cancelled = false;
    const runPreflight = async () => {
      const sessionToCheck = hostId ? effectiveTmuxSession : sessionId;
      if (!sessionToCheck) return { attached: false, exists: true };
      const url = hostId
        ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(sessionToCheck)}`
        : `/api/sessions/${sessionToCheck}/clients`;
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { attached: false, exists: true };
        const data = await res.json();
        // exists 가 false 면 셸이 exit 등으로 tmux 세션이 사라진 상태 → 사용자에게 알리고 명시적 restart.
        return { attached: !!data.attached, count: data.count || 0, exists: data.exists !== false };
      } catch {
        return { attached: false, exists: true };
      }
    };

    const connect = () => {
      if (cancelled) return;
      /* 재연결 시작 — evicted 플래그 리셋. tmux 가 재attach 후 버퍼 리플레이 시
         이전 [detached] 메시지를 다시 내려보내므로 오픈 후 1.5초간 무시. */
      evictedRef.current = false;
      let ignoreDetachUntil = 0;
      const proposed = fitAddon.proposeDimensions();
      const cols = proposed?.cols || term.cols || 80;
      const rows = proposed?.rows || term.rows || 24;
      lastDimsRef.current = { cols, rows };
      // 호스트 연결이면 SSH 브리지로, 아니면 로컬 tmux 브리지로
      const cwdQS = cwd ? `&cwd=${encodeURIComponent(cwd)}` : '';
      const paneQS = paneIndex ? `&pane_index=${paneIndex}` : '';
      // tmuxSuffix — 호스트 탭마다 별도 base session 분리 (새 탭 = 새 작업공간)
      const sfxQS = (hostId && tmuxSuffix) ? `&tmux_suffix=${encodeURIComponent(tmuxSuffix)}` : '';
      // tmuxSessionName — 명시적 영속 세션 attach (Home 의 Resume). 주어지면 base/suffix 무시.
      const sessQS = (hostId && tmuxSessionName) ? `&tmux_session_name=${encodeURIComponent(tmuxSessionName)}` : '';
      const wsUrl = hostId
        ? `${protocol}//${host}/ws/host/${hostId}?token=${token}&cols=${cols}&rows=${rows}${paneQS}${cwdQS}${sfxQS}${sessQS}`
        : `${protocol}//${host}/ws/${sessionId}?token=${token}&cols=${cols}&rows=${rows}&shell=${shell}${cwdQS}`;

      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      wsRef.current = socket;

      socket.onopen = () => {
      logger.info(`WebSocket 연결 성공: ${sessionId}`);
      ignoreDetachUntil = Date.now() + 1500; // tmux 버퍼 리플레이 윈도우
      setIsReady(true);
      reconnectAttemptsRef.current = 0;
      
      // 서버에 현재 크기 무조건 한번 더 전송 — tmux 가 이전 클라이언트 차원으로 잠긴 케이스 강제 갱신.
      const sendResize = () => {
        try { fitAddon.fit(); } catch {}
        const dims = fitAddon.proposeDimensions();
        const c = dims?.cols || term.cols || 80;
        const r = dims?.rows || term.rows || 24;
        lastDimsRef.current = { cols: c, rows: r };
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
        }
      };
      setTimeout(sendResize, 0);

      // 호스트 세션은 attach 후 SIGWINCH 한 번 더 흔들어서 tmux→shell 재그리기 유도.
      // (Ctrl+L 은 zsh 키바인딩이 없는 환경에선 ^L 노출되므로 사용 안 함)
      if (hostId) {
        setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const dims = fitAddon.proposeDimensions();
          const c = dims?.cols || term.cols || 80;
          const r = dims?.rows || term.rows || 24;
          // 1px 줄였다가 즉시 복원 → SIGWINCH 가 확실히 두 번 전파
          socket.send(JSON.stringify({ type: 'resize', cols: Math.max(20, c - 1), rows: Math.max(5, r - 1) }));
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
            }
          }, 60);
      }, 150);
      }
    };

    const flushBufferedOutput = () => {
      wsFlushTimeoutRef.current = null;

      if (wsBufferRef.current.length === 0) return;

      // wsBufferRef.current contains ArrayBuffers. We need to calculate total length and combine them.
      let totalLength = 0;
      for (const buffer of wsBufferRef.current) {
        totalLength += buffer.byteLength;
      }
      
      const mergedBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const buffer of wsBufferRef.current) {
        mergedBuffer.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }

      wsBufferRef.current = [];

      term.write(mergedBuffer, () => {
        handleNewDataRef.current();
        setHasContent(true);
        hasContentRef.current = true;
        if (!contentReadyRef.current) {
          contentReadyRef.current = true;
          onReadyChangeRef.current?.(true);
        }
      });
    };

    // 데이터 도착 시 활동 신호 — 탭 busy 인디케이터 트리거.
    // 100ms 쓰로틀로 조여 반응성 ↑ (이전 300ms 면 짧은 출력 burst 가 한 번 디스패치되고 끝나
    // busy on/off 가 깜빡 보였음). App.jsx 가 별도 윈도우로 fade-out 처리.
    let lastActivityDispatch = 0;
    const dispatchActivity = () => {
      const now = Date.now();
      if (now - lastActivityDispatch < 100) return;
      lastActivityDispatch = now;
      try {
        window.dispatchEvent(new CustomEvent('iterm:activity', {
          detail: { paneId, tabId, sessionId, hostId, ts: now },
        }));
      } catch {}
    };

    const handleEviction = () => {
      evictedRef.current = true;
      // Clear any buffered output — nothing after eviction should reach the terminal
      wsBufferRef.current = [];
      if (wsFlushTimeoutRef.current) {
        clearTimeout(wsFlushTimeoutRef.current);
        wsFlushTimeoutRef.current = null;
      }
      setEvicted(true);
    };

    socket.onmessage = (event) => {
      // binary array buffer data
      if (event.data instanceof ArrayBuffer) {
        // Fast heuristic check for detached token without decoding large buffers
        if (event.data.byteLength < 500) {
          try {
            const text = new TextDecoder('utf-8').decode(event.data);
            if (text.includes('[detached (from session') && Date.now() > ignoreDetachUntil) {
              handleEviction();
              return; // don't write detach text to terminal
            }
          } catch {}
        }

        wsBufferRef.current.push(event.data);
        dispatchActivity();
        if (wsFlushTimeoutRef.current) return;
        wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, 16);
        return;
      }

      /* JSON 프로토콜 메시지 — 인증 prompt (TOTP/2FA) 등. 터미널 출력으로 가지 않게 일찍 분기. */
      if (typeof event.data === 'string' && event.data.length > 1 && event.data[0] === '{' && event.data[event.data.length - 1] === '}') {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.type === 'auth-prompt') {
            setAuthPrompt(msg);
            return;
          }
          if (msg && msg.type === 'tmux-missing') {
            setTmuxFallback(true);
            return;
          }
        } catch { /* JSON 아님, 일반 출력으로 통과 */ }
      }
      /* tmux 가 다른 클라이언트에게 takeover 당해 우리를 detach 시킬 때, 마지막에 보내는
         `[detached (from session ...)]` 한 줄로 의도적 detach 임을 식별 — 네트워크 끊김과 분리. */
      if (typeof event.data === 'string' && event.data.includes('[detached (from session')
          && Date.now() > ignoreDetachUntil) {
        handleEviction();
        return; // don't write detach text to terminal
      }

      // string payload (like detached message, or unhandled json fallback)
      if (typeof event.data === 'string') {
        const encoder = new TextEncoder();
        wsBufferRef.current.push(encoder.encode(event.data).buffer);
        dispatchActivity();
        if (wsFlushTimeoutRef.current) return;
        wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, 16);
      }
    };

    socket.onclose = (event) => {
      if (intentionalCloseRef.current) return;
      logger.warn(`WebSocket 연결 끊김: ${sessionId} (code: ${event.code})`);
      setIsReady(false);
      if (evictedRef.current) {
        /* takeover 당함 — 자동 재접속 금지. 사용자가 "내가 가져오기" 버튼으로만 재attach. */
        setEvicted(true);
        return;
      }
      // detach token 못 봤어도 server-initiated close 면 takeover 또는 셸 종료 가능성.
      // preflight: attached 면 takeover 오버레이 / exists=false 면 종료 오버레이 / 그 외 reconnect.
      const checkAndRecover = async () => {
        const getPf = async () => {
          try {
            return await (runPreflightRef.current?.() || Promise.resolve({ attached: false, exists: true }));
          } catch {
            return { attached: false, exists: true };
          }
        };

        const pf = await getPf();
        if (cancelled) return;

        if (pf.attached) {
          evictedRef.current = true;
          setEvicted(true);
          return;
        }

        if (pf.exists === false) {
          // exists=false 직후는 race condition (tmux 재기동 중, 다른 기기 세션 종료 등) 일 수 있음.
          // 2초 뒤 한 번 더 확인 후 판정 — 오검출 방지.
          await new Promise((r) => setTimeout(r, 2000));
          if (cancelled) return;
          const pf2 = await getPf();
          if (cancelled) return;
          if (pf2.attached) {
            evictedRef.current = true;
            setEvicted(true);
            return;
          }
          if (pf2.exists === false) {
            endedRef.current = true;
            setEnded(true);
            return;
          }
          // pf2.exists = true → 세션 살아남음, 재접속으로 fall-through
        }

        if (cancelled) return;
        // 호스트 네트워크 불안정 (RPi5 wifi 등) 케이스 대응 — 시도 횟수 늘리고 cap 도 큼.
        // 1→2→4→8→8→8…s, 최대 12회 ≈ 1분 30초. 그 후 ended 화면.
        const attempts = reconnectAttemptsRef.current;
        if (attempts < 12) {
          const delay = Math.min(8000, Math.pow(2, attempts) * 1000);
          reconnectAttemptsRef.current = attempts + 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!cancelled) connectRef.current?.();
          }, delay);
        } else {
          // 끝까지 실패 — ended 오버레이로 사용자 명시 액션 유도.
          endedRef.current = true;
          setEnded(true);
        }
      };
      checkAndRecover();
    };

      socket.onerror = (error) => {
        logger.error(`WebSocket 에러: ${sessionId}`, error);
      };
    }; // ← end of connect()

    /* connect/runPreflight 를 외부(takeover 버튼, auto-resume 폴링)에서 부를 수 있게 ref 로 노출. */
    connectRef.current = connect;
    runPreflightRef.current = runPreflight;

    /* mount: 바로 connect. 예전에는 preflight 로 attached 여부를 확인했지만,
       탭 전환/pane 이동으로 인한 unmount→remount 직후 구 WS 가 tmux 에서 아직 등록된
       채로 남아 attached=true 를 반환해 false eviction 오버레이가 뜨는 문제가 있었음.
       진짜 eviction 은 데이터 스트림 내 [detached (from session...)] 토큰으로 감지하므로
       mount preflight 없이도 충분히 보호됨. */
    if (!cancelled) connect();

    // 4. 사용자 입력 처리 — connect() 가 여러 번 호출돼도 (takeover/auto-resume) 항상 최신 ws 를 잡게 ref 사용.
    // 대용량 paste 는 절대 동기 while 루프로 WebSocket.send() 를 몰아넣지 않는다.
    // 브라우저 WebSocket buffer / 서버 receive_text / PTY / tmux / vim 이 모두 별도 속도로 drain 되므로
    // 수 MB~수십 MB 를 한 번에 밀면 UI freeze, WS close, tmux/vim 입력 유실이 생길 수 있다.
    const INPUT_CHUNK = 16 * 1024;
    const INPUT_BYTES_PER_TICK = 128 * 1024;
    const WS_BUFFER_HIGH_WATER = 512 * 1024;

    const scheduleInputFlush = (delay = 0) => {
      if (inputFlushTimeoutRef.current) return;
      inputFlushTimeoutRef.current = setTimeout(flushInputQueue, delay);
    };

    const flushInputQueue = () => {
      inputFlushTimeoutRef.current = null;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (inputQueueRef.current.length === 0) return;

      if (ws.bufferedAmount > WS_BUFFER_HIGH_WATER) {
        scheduleInputFlush(16);
        return;
      }

      let sent = 0;
      while (inputQueueRef.current.length > 0 && sent < INPUT_BYTES_PER_TICK) {
        if (ws.bufferedAmount > WS_BUFFER_HIGH_WATER) break;
        let next = inputQueueRef.current[0];
        if (!next) {
          inputQueueRef.current.shift();
          continue;
        }
        const chunk = next.length > INPUT_CHUNK ? next.slice(0, INPUT_CHUNK) : next;
        ws.send(chunk);
        sent += chunk.length;
        if (next.length > INPUT_CHUNK) {
          inputQueueRef.current[0] = next.slice(INPUT_CHUNK);
        } else {
          inputQueueRef.current.shift();
        }
      }

      if (inputQueueRef.current.length > 0) {
        scheduleInputFlush(ws.bufferedAmount > WS_BUFFER_HIGH_WATER ? 16 : 1);
      }
    };

    term.onData((data) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (data.length <= INPUT_CHUNK && inputQueueRef.current.length === 0 && ws.bufferedAmount < WS_BUFFER_HIGH_WATER) {
        ws.send(data);
        return;
      }
      inputQueueRef.current.push(data);
      scheduleInputFlush(0);
    });

    // 스크롤 이벤트 연결
    term.onScroll(() => {
      handleUserScroll();
    });

    // 윈도우/패널 리사이즈 대응.
    // - 데스크탑: rAF 직후 빠르게 1회 fit 해서 열린 pane 들이 즉시 따라오게 한다.
    // - 모바일 visualViewport/키보드: 최종 크기 안정화 후 trailing fit 을 한 번 더 쏴서 떨림과
    //   중간 크기 고정을 동시에 피한다.
    const doFit = (reason = 'resize') => {
      if (!fitAddonRef.current) return;
      const proposed = fitAddonRef.current.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      fitAddonRef.current.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0
            && (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows)) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };
    fitNowRef.current = doFit;

    const scheduleFit = (delay = 0, reason = 'resize') => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        resizeTimeoutRef.current = null;
        requestAnimationFrame(() => doFit(reason));
      }, delay);
    };

    const handleResize = () => {
      // Skip intermediate fits during pane drag — a single fit fires via layoutSignal on mouseup
      if (window.__paneResizingActive) return;
      scheduleFit(isMobileRef.current ? 160 : 32, 'observer');
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      resizeTrailingTimeoutRef.current = setTimeout(() => doFit('observer-trailing'), isMobileRef.current ? 360 : 140);
    };

    const handleGlobalFit = () => {
      if (window.__paneResizingActive) return;
      scheduleFit(0, 'global');
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      resizeTrailingTimeoutRef.current = setTimeout(() => doFit('global-trailing'), 120);
    };

    // [중요] ResizeObserver를 통한 컨테이너 크기 변화 감지 (에디터 열고 닫기 등 레이아웃 변화 대응)
    const observer = new ResizeObserver(() => handleResize());
    if (terminalRef.current) observer.observe(terminalRef.current);
    window.addEventListener('resize', handleResize);
    window.addEventListener('iterm:fit-terminals', handleGlobalFit);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      cancelled = true;
      intentionalCloseRef.current = true;
      contentReadyRef.current = false;
      onReadyChangeRef.current?.(false);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('iterm:fit-terminals', handleGlobalFit);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      if (overlay) {
        overlay.removeEventListener('touchstart', handleTouchStart);
        overlay.removeEventListener('touchmove', handleTouchMove);
        overlay.removeEventListener('touchend', handleTouchEnd);
      }
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
        container.removeEventListener('keydown', handleKeyDown);
        container.removeEventListener('paste', handlePaste, true);
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchend', handleTouchEnd);
      }
      try { wsRef.current?.close(); } catch {}
      connectRef.current = null;
      runPreflightRef.current = null;
      wsBufferRef.current = [];
      try { term.dispose(); } catch {}
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsFlushTimeoutRef.current) clearTimeout(wsFlushTimeoutRef.current);
      if (inputFlushTimeoutRef.current) clearTimeout(inputFlushTimeoutRef.current);
      if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
      inputQueueRef.current = [];
      fitNowRef.current = null;
    };
  }, [sessionId]);

  /* evicted 동안 백엔드 폴링 — 다른 기기가 떨어지면(`count == 0`) 사용자 클릭 없이도 자동 재attach.
     "내가 모바일 닫고나서도 여기 사이즈가 작은 상태로 남아있다" 상황을 방지.
     핑퐁 방지: count=0 을 2회 연속 확인한 뒤에만 재attach (단발 0 = 일시적 blip 무시). */
  useEffect(() => {
    if (!evicted) return undefined;
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth_token') : null;
    const sessionToCheck = hostId ? effectiveTmuxSession : sessionId;
    if (!sessionToCheck) return undefined;
    const url = hostId
      ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(sessionToCheck)}`
      : `/api/sessions/${sessionToCheck}/clients`;
    let cancelled = false;
    let zeroStreak = 0;
    const ZERO_THRESHOLD = 2; // 2회 연속 count=0 이어야 재attach
    const tick = async () => {
      try {
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (cancelled) return;
        if (!res.ok) { zeroStreak = 0; return; }
        const data = await res.json();
        if (!data.attached) {
          zeroStreak++;
          if (zeroStreak >= ZERO_THRESHOLD) {
            /* 다른 기기 다 떨어짐 → 자동 재attach. connectRef 직접 호출해 remount 없이 WS 만 다시 열음.
               새 attach 가 PC 의 PTY 사이즈로 spawn 되니 tmux 가 자동으로 PC 사이즈로 resize 됨. */
            evictedRef.current = false;
            setEvicted(false);
            if (connectRef.current) connectRef.current();
          }
        } else {
          zeroStreak = 0;
        }
      } catch { zeroStreak = 0; /* 네트워크 일시 실패 — 다음 tick 에서 다시 */ }
    };
    /* 초기 대기 8s(기기가 안정화될 시간) + 이후 10s 간격으로 폴링. */
    const initial = setTimeout(tick, 8000);
    const id = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [evicted, hostId, effectiveTmuxSession, sessionId]);

  // 테마 및 설정(폰트 크기 등) 변경 시 반영
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = currentTheme;
      xtermRef.current.options.fontSize = settings.fontSize;
      xtermRef.current.options.fontFamily = normalizeTerminalFontFamily(settings.fontFamily);
      xtermRef.current.options.smoothScrollDuration = settings.smoothScroll ? 100 : 0;
      
      // 폰트 크기가 바뀌면 즉시 fit() 을 호출해 그리드 크기 재계산 (xterm.js 내부 캐시 갱신)
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch (e) {}
      }

      // 폰트 변경 후 리사이즈 필요 (폰트 로드 대기를 위해 약간의 지연).
      // hidden(비활성) 탭이면 0×0 이라 fit 스킵 — 가시화될 때 layoutSignal 효과로 다시 fit 됨.
      setTimeout(() => {
        if (!fitAddonRef.current) return;
        const proposed = fitAddonRef.current.proposeDimensions();
        if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
            lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      }, 50); // 200ms 는 너무 길어 반응이 느려 보이므로 50ms 로 단축
    }
  }, [currentTheme, settings.fontSize, settings.fontFamily, settings.smoothScroll]);

  useEffect(() => {
    if (!isActive) return;

    /* 활성 탭이 되는 순간 = 가시 영역이 처음 생기는 순간. display:none→grid 전환 직후라
       rAF 한 프레임 뒤면 레이아웃이 확정되므로 즉시 fit. 서브탭 전환 시 squish 방지. */
    let rafId = requestAnimationFrame(() => {
      if (!fitAddonRef.current) return;
      const proposed = fitAddonRef.current.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      fitAddonRef.current.fit();
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [layoutSignal, isActive]);

  // 재연결 로직
  const handleReconnect = () => {
    if (reconnectAttemptsRef.current < 5) {
      const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptsRef.current += 1;
        logger.info(`재연결 시도 중... (${reconnectAttemptsRef.current}/5)`);
        // useEffect가 재실행되도록 강제하거나 소켓만 다시 생성
        // 여기서는 단순함을 위해 페이지 새로고침 제안 또는 상태 트리거
      }, delay);
    }
  };

  // 외부 전송용 핸들러 (MobileToolbar 등에서 사용)
  const sendData = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const getSelection = useCallback(() => {
    return xtermRef.current?.getSelection() || '';
  }, []);

  const scrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
  }, []);

  // 페이지/라인 단위 스크롤 — xterm.js client-side scrollback 만 조작한다.
  // 편집기/셸이 해석하지 못하는 PgUp/PgDn escape sequence 를 PTY 로 보내면
  // 파일이나 prompt 에 `^[[5~` / `^[[6~` 가 그대로 들어갈 수 있다.
  const scrollPages = useCallback((pages) => {
    const term = xtermRef.current;
    if (!term || pages === 0) return;
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollPages(pages); } catch { /* noop */ }
    }
  }, []);

  const scrollLines = useCallback((lines) => {
    const term = xtermRef.current;
    if (!term || lines === 0) return;
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollLines(lines); } catch { /* noop */ }
    }
  }, []);

  const scrollToTop = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollToTop(); } catch { /* noop */ }
    }
  }, []);

  // 전체 버퍼 → 일반 텍스트. 모바일에서 손가락 선택이 까다로워 화면 통째로
  // 텍스트로 띄워주거나 한번에 클립보드에 복사하는 편의 기능에 사용.
  // includeScrollback=true 면 스크롤백 전체, false 면 viewport 만.
  const getBufferText = useCallback((includeScrollback = true) => {
    const term = xtermRef.current;
    if (!term) return '';
    const buf = term.buffer.active;
    const start = includeScrollback ? 0 : buf.viewportY;
    const end = buf.length;
    const lines = [];
    for (let i = start; i < end; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      // translateToString(true) — trailing whitespace trim
      lines.push(line.translateToString(true));
    }
    // 끝쪽 빈 줄 정리
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }, []);

  // 전체 버퍼를 한번에 클립보드로 — 모바일 long-select 가 어려운 환경에서 유용.
  const copyAll = useCallback(async () => {
    const text = getBufferText(true);
    if (!text) return false;
    await copyTextToClipboard(text);
    return true;
  }, [getBufferText]);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  const clear = useCallback(() => {
    xtermRef.current?.clear();
  }, []);

  const searchNext = useCallback((query, options = {}) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findNext(query, {
      incremental: true,
      ...options,
    }) || false;
  }, []);

  const searchPrevious = useCallback((query, options = {}) => {
    if (!query || !searchAddonRef.current) return false;
    return searchAddonRef.current.findPrevious(query, {
      incremental: true,
      ...options,
    }) || false;
  }, []);

  const closeSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
  }, []);

  useEffect(() => {
    if (isActive && xtermRef.current && isReady) {
      const timer = setTimeout(() => {
        xtermRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, isReady]);

  // 전역 세션 관리자에 현재 활성 함수 등록
  useEffect(() => {
    if (!window.terminalSessions) window.terminalSessions = {};
    window.terminalSessions[sessionId] = {
      sendData,
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
      // xterm에 PTY 출력인 척 escape sequence 주입. 마우스 트래킹 임시 제어 등에 사용.
      writeEscape: (seq) => xtermRef.current?.write(seq),
      setMouseTracking: (enabled) => {
        const t = xtermRef.current;
        if (!t) return;
        if (enabled) {
          t.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
        } else {
          t.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
        }
      },
      /* Info 패널이 읽어가는 라이브 메타데이터 — 사이즈/연결상태 등.
         값은 ref 기반이라 항상 최신. (객체 자체는 그대로, 내부 ref 만 변동) */
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
      if (window.terminalSessions) {
        delete window.terminalSessions[sessionId];
      }
    };
  }, [sessionId, sendData, getSelection, getBufferText, copyAll, scrollToBottom, scrollToTop, scrollPages, scrollLines, focus, clear, searchNext, searchPrevious, closeSearch, isReady]);

  // 로깅 헬퍼
  const logger = {
    info: (msg) => {
      if (localStorage.getItem('debug_terminal') === '1') {
        console.log(`[Terminal:${sessionId}] ${msg}`);
      }
    },
    warn: (msg) => console.warn(`[Terminal:${sessionId}] ${msg}`),
    error: (msg, err) => console.error(`[Terminal:${sessionId}] ${msg}`, err),
  };

  return (
    <>
      <style>{`
        @keyframes term-skeleton-pulse {
          0%   { opacity: 0.35; }
          50%  { opacity: 0.7; }
          100% { opacity: 0.35; }
        }
        /* Bottom/right overscan: keep xterm sizing math tied to the wrapper,
           but let the rendered surface bleed a few pixels into the clipped edge.
           This hides fractional cell remainders without shifting the top/left origin. */
        .xterm {
          width: calc(100% + 4px) !important;
          height: calc(100% + 4px) !important;
          overflow: visible !important;
        }
        .xterm-scrollable-element { height: 100% !important; }
        .xterm-viewport { height: 100% !important; }
      `}</style>

      {/* 스켈레톤: 첫 콘텐츠가 그려지기 전까지 표시 */}
      {!hasContent && (
        <div
          aria-hidden="true"
          style={{
            ...styles.statusOverlay,
            backgroundColor: themeUi.base,
            padding: '14px 18px',
            justifyContent: 'flex-start',
            alignItems: 'stretch',
            gap: '10px',
          }}
        >
          {[62, 38, 84, 50, 72, 30, 66, 44, 78, 40].map((width, i) => (
            <div
              key={i}
              style={{
                height: '12px',
                width: `${width}%`,
                borderRadius: '4px',
                background: themeUi.surface1 || themeUi['border-strong'] || '#313244',
                animation: 'term-skeleton-pulse 1.4s ease-in-out infinite',
                animationDelay: `${i * 90}ms`,
              }}
            />
          ))}
        </div>
      )}

      {/* xterm.js 컨테이너 — 좌/우/상에 약간의 호흡 패딩.
          fitAddon 은 element.clientWidth(=content box, padding 제외) 기준이라 cols 자동 계산 정확.
          tmux 안 건드림. */}
      <div
        ref={terminalRef}
        onClick={() => {
          if (xtermRef.current) {
            xtermRef.current.focus();
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background: currentTheme.background,
          overflow: 'hidden',
          opacity: hasContent ? 1 : 0,
          transition: 'opacity 0.18s ease',
          caretColor: 'transparent',
          outline: 'none',
        }}
      />

      {/* 모바일 터치 오버레이: canvas 위에 깔아 touch-action:none + passive:false 스크롤 보장.
          iOS는 이 div가 터치 타깃이 되므로 scroll 제스처를 선점하지 않음.
          onClick으로 터미널 포커스(iOS 키보드)도 처리. */}
      {isMobile && (
        <div
          ref={touchOverlayRef}
          aria-hidden="true"
          onClick={() => xtermRef.current?.focus()}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            touchAction: 'none',
            cursor: 'default',
          }}
        />
      )}

      {/* context menu — 우클릭 시 복사/붙여넣기/전체복사/하단스크롤 */}
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          themeUi={themeUi}
          t={t}
          onCopy={() => {
            const sel = xtermRef.current?.getSelection();
            if (sel) copyTextToClipboard(sel);
            setContextMenu(null);
          }}
          onCopyAll={() => {
            copyAll();
            setContextMenu(null);
          }}
          onPaste={async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text && xtermRef.current) {
                xtermRef.current.paste(text);
              }
            } catch {}
            setContextMenu(null);
          }}
          onClear={() => {
            xtermRef.current?.clear();
            setContextMenu(null);
          }}
          onScrollToBottom={() => {
            xtermRef.current?.scrollToBottom();
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* "Copied!" 토스트 — 드래그 선택 후 자동 복사 시 짧게 표시 */}
      {copyFlash && (
        <div
          aria-live="assertive"
          aria-atomic="true"
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0 || '#313244'} 92%, transparent)`,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: themeUi.text,
            border: `1px solid ${themeUi.border}`,
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 15,
            opacity: 0.92,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <Copy size={11} strokeWidth={2} style={{ color: themeUi.accent }} />
          {t('copied') || 'Copied'}
        </div>
      )}

      {/* takeover 배너 — 패널 하단 인라인, 여러 패널에 동시 노출 가능 */}
      {tmuxFallback && (
        <div style={styles.inlineBanner(themeUi)}>
          <AlertTriangle size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: themeUi.warning || '#f9e2af' }} />
          <span style={styles.bannerText(themeUi)}>
            {t('tmuxFallbackWarning') || 'tmux not found on this host — session will not persist across disconnects'}
          </span>
          <button
            type="button"
            onClick={() => setTmuxFallback(false)}
            style={styles.bannerButton(themeUi)}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      {evicted && (
        <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
          <div style={styles.glassIconTile(themeUi, themeUi.warning || '#f9e2af')}>
            <MonitorSmartphone size={18} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
              {t('takenOverTitle') || '다른 기기에서 접속 중'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
              {t('takenOverDesc') || '이 세션은 다른 기기가 사용하고 있습니다.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              evictedRef.current = false;
              setEvicted(false);
              if (connectRef.current) connectRef.current();
              else if (onTakeOver) onTakeOver();
              else window.location.reload();
            }}
            style={styles.glassActionBtn(themeUi, themeUi.accent)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
          >
            {t('takeOver') || '내가 가져오기'}
          </button>
        </GlassOverlayCard>
      )}

      {ended && !evicted && (
        <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
          <div style={styles.glassIconTile(themeUi, themeUi.subtext)}>
            <PowerOff size={18} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
              {t('shellEndedTitle') || '셸이 종료되었습니다'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
              {t('shellEndedDesc') || '새 셸을 시작하거나 패널을 닫을 수 있습니다.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              endedRef.current = false;
              setEnded(false);
              reconnectAttemptsRef.current = 0;
              if (connectRef.current) connectRef.current();
              else window.location.reload();
            }}
            style={styles.glassActionBtn(themeUi, themeUi.accent)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
          >
            {t('restartShell') || '새 셸 시작'}
          </button>
        </GlassOverlayCard>
      )}

      {/* SSH keyboard-interactive (TOTP/OTP/2FA) 챌린지 prompt — 호스트 연결 직전에 백엔드가 트리거. */}
      {authPrompt && (
        <AuthPromptOverlay
          prompt={authPrompt}
          themeUi={themeUi}
          t={t}
          onSubmit={(values) => {
            try {
              wsRef.current?.send(JSON.stringify({ type: 'auth-response', values }));
            } catch { /* noop */ }
            setAuthPrompt(null);
            setTimeout(() => xtermRef.current?.focus(), 100);
          }}
          onCancel={() => {
            try {
              wsRef.current?.send(JSON.stringify({ type: 'auth-cancel' }));
            } catch { /* noop */ }
            setAuthPrompt(null);
            // 명시적 취소 — 자동 재연결 막고 WS 닫음. 사용자가 host 카드에서 다시 시도.
            intentionalCloseRef.current = true;
            try { wsRef.current?.close(); } catch { /* noop */ }
            // 화면에 cancelled 상태 — ended 오버레이로 "다시 시작" 노출.
            endedRef.current = true;
            setEnded(true);
          }}
        />
      )}
    </>
  );
};

const GlassOverlayCard = ({ themeUi, zIndex = 10040, children }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.38)',
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
    zIndex,
    fontFamily: 'inherit',
  }}>
    <div style={{
      background: `color-mix(in srgb, ${themeUi.surface0 || themeUi.base} 82%, transparent)`,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: `1px solid ${themeUi.borderStrong || themeUi.border}`,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
      padding: '20px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      minWidth: '220px', maxWidth: '280px',
    }}>
      {children}
    </div>
  </div>
);

const AuthPromptOverlay = ({ prompt, themeUi, t, onSubmit, onCancel }) => {
  const initial = (prompt.prompts || []).map(() => '');
  const [values, setValues] = useState(initial);
  const pasteFirst = async () => {
    try {
      const text = (await navigator.clipboard.readText() || '').trim();
      if (text) setValues((v) => [text, ...v.slice(1)]);
    } catch { /* clipboard 권한 없음 — 사용자 수동 paste */ }
  };
  /* 현재 터미널 테마에서 직접 도출한 UI 팔레트 사용.
     MFA 입력 후 취소/끊김 화면까지 같은 색 체계로 유지한다. */
  return (
    <div
      onClick={onCancel}
      style={{
        ...styles.fixedModalOverlay(themeUi, 10050),
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
        style={{
          ...styles.modalCard(themeUi),
        }}
      >
        <header style={styles.modalHeader(themeUi)}>
          <div style={styles.iconTile(themeUi)}>
            <KeyRound size={16} strokeWidth={2} />
          </div>
          <div style={styles.modalTitle(themeUi)}>
            {prompt.name || (t('authPromptTitle') || 'Additional verification')}
          </div>
        </header>
        <div style={styles.modalBody(themeUi, 'left')}>
          {prompt.instructions && (
            <div style={{ whiteSpace: 'pre-line' }}>
              {prompt.instructions}
            </div>
          )}
          {(prompt.prompts || []).map((p, i) => (
            <label key={i} style={styles.promptField}>
              <span style={styles.promptLabel(themeUi)}>
                {p.prompt || (t('authPromptCode') || 'Code')}
              </span>
              <div style={styles.promptInputRow}>
                <input
                  type={p.echo ? 'text' : 'password'}
                  inputMode="text"
                  autoFocus={i === 0}
                  autoComplete="one-time-code"
                  value={values[i] || ''}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  style={styles.promptInput(themeUi)}
                />
                {i === 0 && (
                  <button
                    type="button"
                    onClick={pasteFirst}
                    title={t('paste') || 'Paste'}
                    style={styles.promptPasteButton(themeUi)}
                  >
                    {t('paste') || 'Paste'}
                  </button>
                )}
              </div>
            </label>
          ))}
        </div>
        <footer style={styles.modalFooter(themeUi)}>
          <button
            type="button"
            onClick={onCancel}
            style={styles.secondaryModalButton(themeUi)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${themeUi.surface1 || themeUi.surface0}`; e.currentTarget.style.color = themeUi.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0} 70%, transparent)`; e.currentTarget.style.color = themeUi.subtext; }}
          >
            {t('cancel') || 'Cancel'}
          </button>
          <button
            type="submit"
            style={styles.primaryModalButton(themeUi)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
          >
            {t('authPromptSubmit') || 'Continue'}
          </button>
        </footer>
      </form>
    </div>
  );
};

const TerminalContextMenu = ({ x, y, hasSelection, themeUi, t, onCopy, onCopyAll, onPaste, onClear, onScrollToBottom, onClose }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleClick = (e) => {
      if (e.button === 2) return;
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nx = x, ny = y;
      if (nx + rect.width > window.innerWidth - margin) nx = window.innerWidth - rect.width - margin;
      if (nx < margin) nx = margin;
      if (ny + rect.height > window.innerHeight - margin) ny = window.innerHeight - rect.height - margin;
      if (ny < margin) ny = margin;
      setPos({ x: nx, y: ny });
    }
  }, [x, y]);

  const items = [];
  if (hasSelection) {
    items.push({ icon: Copy, label: t('copy') || 'Copy', action: onCopy });
  }
  items.push({ icon: Scissors, label: t('copyAll') || 'Copy all', action: onCopyAll });
  items.push({ icon: ClipboardPaste, label: t('paste') || 'Paste', action: onPaste });
  items.push({ icon: RotateCcw, label: t('clear') || 'Clear', action: onClear });
  items.push({ icon: ArrowDownToLine, label: t('scrollToBottom') || 'Scroll to bottom', action: onScrollToBottom });

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const selectHint = isMac ? 'Option+drag to select' : 'Shift+drag to select';

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200000,
        background: themeUi.base,
        border: `1px solid ${themeUi.border}`,
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        padding: '4px 0',
        minWidth: '160px',
        fontFamily: tokens.font.sans,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: 'transparent',
            color: themeUi.text,
            fontSize: tokens.fontSize['12'],
            fontFamily: tokens.font.sans,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = themeUi.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <item.icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.7 }} />
          {item.label}
        </button>
      ))}
      <div style={{ height: '1px', background: themeUi.border, margin: '3px 0' }} />
      <div style={{
        padding: '4px 12px',
        fontSize: tokens.fontSize['11'],
        color: themeUi.subtext,
        opacity: 0.7,
        fontFamily: tokens.font.sans,
        letterSpacing: '0.01em',
      }}>
        {selectHint}
      </div>
    </div>
  );
};

const styles = {
  statusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalOverlay: (themeUi, zIndex) => ({
    position: 'absolute',
    inset: 0,
    padding: space['3'],
    background: themeUi.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex,
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    fontFamily: 'inherit',
  }),
  fixedModalOverlay: (themeUi, zIndex) => ({
    position: 'absolute',
    inset: 0,
    padding: space['3'],
    background: 'rgba(0,0,0,0.38)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex,
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
    fontFamily: 'inherit',
  }),
  modalCard: (themeUi) => ({
    width: '90%',
    maxWidth: '360px',
    maxHeight: '80%',
    background: `color-mix(in srgb, ${themeUi.surface0 || themeUi.base} 82%, transparent)`,
    color: themeUi.text,
    border: `1px solid ${themeUi.borderStrong || themeUi.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  }),
  modalHeader: (themeUi) => ({
    display: 'flex',
    alignItems: 'center',
    gap: space['3'],
    padding: `${space['4']} ${space['4']} ${space['2']}`,
  }),
  iconTile: (themeUi) => ({
    width: '36px',
    height: '36px',
    borderRadius: '9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, ${themeUi.accent} 18%, transparent)`,
    border: `1px solid color-mix(in srgb, ${themeUi.accent} 40%, transparent)`,
    color: themeUi.accent,
    fontSize: '12px',
    fontWeight: 700,
    flexShrink: 0,
  }),
  glassIconTile: (themeUi, tileColor) => ({
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, ${tileColor} 18%, transparent)`,
    border: `1px solid color-mix(in srgb, ${tileColor} 40%, transparent)`,
    color: tileColor,
    flexShrink: 0,
  }),
  glassActionBtn: (themeUi, btnColor) => ({
    width: '100%',
    height: '32px',
    borderRadius: '7px',
    border: `1px solid color-mix(in srgb, ${btnColor} 60%, transparent)`,
    background: `color-mix(in srgb, ${btnColor} 22%, transparent)`,
    color: btnColor,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'background 120ms',
  }),
  modalTitle: (themeUi) => ({
    color: themeUi.text,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    letterSpacing: '0.01em',
    flex: 1,
  }),
  modalBody: (themeUi, textAlign = 'center') => ({
    flex: 1,
    padding: `${space['2']} ${space['4']}`,
    color: themeUi.subtext,
    fontSize: fontSize['12'],
    lineHeight: lineHeight.normal,
    textAlign,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
  }),
  modalFooter: (themeUi) => ({
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['3']} ${space['4']} ${space['4']}`,
  }),
  primaryModalButton: (themeUi) => ({
    flex: 1,
    height: '32px',
    borderRadius: '7px',
    border: `1px solid color-mix(in srgb, ${themeUi.accent} 60%, transparent)`,
    background: `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`,
    color: themeUi.accent,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'background 120ms',
  }),
  secondaryModalButton: (themeUi) => ({
    flex: 1,
    height: '32px',
    borderRadius: '7px',
    border: `1px solid ${themeUi.border}`,
    background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0} 70%, transparent)`,
    color: themeUi.subtext,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'background 120ms',
  }),
  promptField: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
  },
  promptLabel: (themeUi) => ({
    fontSize: fontSize['12'],
    color: themeUi.subtext,
  }),
  promptInputRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
  },
  promptInput: (themeUi) => ({
    flex: 1,
    minWidth: 0,
    height: '38px',
    padding: `0 ${space['3']}`,
    background: `color-mix(in srgb, ${themeUi.mantle || themeUi.base} 80%, transparent)`,
    color: themeUi.text,
    border: `1px solid ${themeUi.borderStrong || themeUi.border}`,
    borderRadius: '7px',
    outline: 'none',
    fontSize: fontSize['14'],
    fontFamily: 'inherit',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  }),
  inlineBanner: (themeUi) => ({
    position: 'absolute',
    bottom: space['2'],
    left: space['2'],
    right: space['2'],
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['1.5']} ${space['3']}`,
    background: `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0} 75%, transparent)`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${themeUi.borderStrong || themeUi.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    zIndex: 12,
    fontSize: fontSize['11'],
    fontFamily: 'inherit',
  }),
  bannerText: (themeUi) => ({
    flex: 1,
    color: themeUi.subtext,
    fontSize: fontSize['11'],
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  bannerButton: (themeUi) => ({
    height: '22px',
    padding: `0 ${space['2']}`,
    borderRadius: '5px',
    border: `1px solid color-mix(in srgb, ${themeUi.accent} 60%, transparent)`,
    background: `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`,
    color: themeUi.accent,
    fontSize: fontSize['11'],
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  promptPasteButton: (themeUi) => ({
    height: '40px',
    padding: `0 ${space['3']}`,
    background: themeUi.surface1,
    color: themeUi.text,
    border: `1px solid ${themeUi.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }),
};

export default memo(TerminalComponent);
