/**
 * Terminal 컴포넌트
 * xterm.js 기반 터미널 에뮬레이터 (테마 및 스마트 스크롤 지원)
 */
import { useEffect, useRef, useState, useCallback, useMemo, memo, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ImageAddon } from '@xterm/addon-image';
import { MonitorSmartphone, PowerOff, Copy, ClipboardPaste, Scissors, ArrowDownToLine, RotateCcw, Loader2, AlertTriangle, X, KeyRound } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { tokens } from '../styles/tokens';
import { glassDividerStyle, glassMenuItemHover, glassMenuStyle } from '../styles/glass';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';
import { authHeaders } from '../utils/auth';
import { measureTerminalFit } from '../utils/terminalFit';
import {
  shouldUseNaturalMouseSelection,
  selectionArgsFromCells,
  shouldRouteWheelToPty,
  shouldClearSelectionOnScroll,
} from '../utils/terminalMouseSelection';
import { isTerminalAutoResponse } from '../utils/terminalInput';
import { pushCommand as pushCommandHistory, pushLocalCommand as pushLocalCommandHistory } from '../utils/commandHistory';
import { getNetworkSummary, getTerminalClientId } from '../utils/clientIdentity';

// onData / sendData 가 통과한 데이터 중 어떤 것이 "히스토리에 기록할 만한 명령" 인지 판정.
// 단일 키스트로크와 escape sequence 를 거르고, multi-char 입력만 통과 — paste / Quick Input / IME 조합.
const looksLikeBulkCommand = (data) => {
  if (typeof data !== 'string') return false;
  if (data.length < 2) return false;
  if (data.charCodeAt(0) === 0x1b) return false; // ANSI escape
  // 한 글자라도 가시문자가 있어야 함
  let hasPrintable = false;
  for (let i = 0; i < data.length; i += 1) {
    const c = data.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f) { hasPrintable = true; break; }
  }
  return hasPrintable;
};

const looksLikeRecoverableBulkInput = (data) => {
  if (typeof data !== 'string' || data.length < 16) return false;
  const cleaned = data
    .replace(/^\x1b\[200~/, '')
    .replace(/\x1b\[201~$/, '')
    .replace(/[\r\n]+$/g, '')
    .trim();
  return looksLikeBulkCommand(cleaned);
};

const { fontSize, fontWeight, lineHeight, radius, shadow, space } = tokens;

// 모듈 스코프 — 매 메시지마다 재생성하지 않고 재사용 (GC 절감)
const _textDecoder = new TextDecoder('utf-8');
const _textEncoder = new TextEncoder();
const RECOVERY_GRACE_MS = 12000;
const RECOVERY_POLL_MS = 1000;
const TAKEOVER_CONFIRM_MS = 3500;
const TAKEOVER_CONFIRM_POLL_MS = 500;
const MAX_RECONNECT_ATTEMPTS = 12;
// 셸이 깨끗이 종료(exit)된 게 확인되면 짧은 취소 여유를 두고 pane 자동 닫기.
const AUTO_CLOSE_MS = 1800;
// 로딩이 이 시간을 넘기면 "멈춤"으로 보고 수동 닫기 버튼을 노출 (행 걸린 pane 탈출구).
const LOAD_STUCK_MS = 8000;
// 앱 레벨 하트비트 — half-open(죽었지만 OPEN 으로 보이는) 소켓 감지.
// 클라이언트가 ping 을 보내고 서버 pong(또는 그 외 메시지) 을 일정 시간 못 받으면 죽은 소켓으로 보고 강제 재연결.
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_DEAD_MS = 35000;
const RESUME_PROBE_TIMEOUT_MS = 2500;
const RESUME_PROBE_THROTTLE_MS = 1500;
// WS 가 이 시간 안에 onopen 못 하면 재연결 실패로 보고 중단 (무한 "연결 중..." 방지).
const CONNECT_OPEN_TIMEOUT_MS = 12000;
// onopen 직후 바로 끊기는 flapping 연결은 성공으로 보지 않는다.
const RECONNECT_STABLE_RESET_MS = 15000;
const TMUX_WHEEL_INPUT_RE = /^(?:\x1b\[<(?:64|65);\d+;\d+M)+$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// spin keyframes — 모듈 로드 시 한 번만 주입
(() => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('tl-spin-kf')) return;
  const s = document.createElement('style');
  s.id = 'tl-spin-kf';
  s.textContent = '@keyframes tl-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
})();

const issueWsTicket = async (path) => {
  try {
    const res = await fetch('/api/ws-ticket', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(7000)
        : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
      return { ticket: null, authExpired: true };
    }
    if (!res.ok) return { ticket: null, authExpired: false };
    const data = await res.json();
    return { ticket: data?.ticket || null, authExpired: false };
  } catch {
    return { ticket: null, authExpired: false };
  }
};

const TerminalComponent = forwardRef(({ sessionId, hostId, isMobile = false, tmuxSuffix = null, tmuxSessionName = null, effectiveTmuxSession = null, settings, onSendData, onBroadcast, isActive = true, isFocused = true, layoutSignal = '', cwd = null, paneIndex = 0, paneId = null, tabId = null, onTakeOver = null, onReadyChange = null, onStatusChange = null, onClosePane = null }, ref) => {
  const { t } = useTranslation(settings.language);
  const terminalClientIdRef = useRef(getTerminalClientId());
  const terminalRef = useRef(null);
  const touchOverlayRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  // WebglAddon — 비활성 탭에서는 GPU 페인팅 멈춰서 CPU/배터리 절약 (특히 모바일).
  // 활성화 시 DOM renderer 가 인계 → 활성 복귀 시 새 WebglAddon 재부착.
  const webglAddonRef = useRef(null);
  // 사용자가 명시적으로 WebGL 끈 경우엔 (settings.useWebgl===false) 자동 재부착 안 함.
  const wantWebglRef = useRef(true);
  // 비활성 탭에서 누적된 WS 출력을 활성 복귀 시 한 번에 flush 하기 위한 ref.
  const flushBufferedOutputRef = useRef(null);
  // 비활성 grace-close 타이머 + close 가 inactivity 때문이었는지 표시.
  const graceCloseTimerRef = useRef(null);
  const wasClosedForInactivityRef = useRef(false);
  const wsRef = useRef(null);
  const wsGenerationRef = useRef(0);
  const resizeTimeoutRef = useRef(null);
  const resizeTrailingTimeoutRef = useRef(null);
  const fitNowRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const stableReconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const livenessProbeTimerRef = useRef(null);
  const resumeProbeTimerRef = useRef(null);
  const lastResumeProbeAtRef = useRef(0);
  const lastRecvRef = useRef(0);
  const authPromptRef = useRef(false);
  const wsFlushTimeoutRef = useRef(null);
  const wsBufferRef = useRef([]);
  const inputQueueRef = useRef([]);
  const enqueueInputRef = useRef(null);
  const probeLivenessRef = useRef(null);
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
  const [endedNotice, setEndedNotice] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  // exit 등으로 셸이 종료돼 pane 을 자동으로 닫는 중 — 짧은 취소 카운트다운 표시.
  const [closing, setClosing] = useState(false);
  const autoCloseTimerRef = useRef(null);
  // 로딩이 오래 걸려 멈춘 것으로 보일 때 true — 스켈레톤 위에 수동 닫기 버튼 노출.
  const [loadStuck, setLoadStuck] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState('');
  // 클립보드 이미지 붙여넣기 진행 상태: 'uploading' | 'done' | 'error' | null
  const [imagePasteState, setImagePasteState] = useState(null);
  const reconnectingRef = useRef(false);
  const contentReadyRef = useRef(false);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // 상태 변화 시 부모에 통지 — evicted, ended, isReady, hasContent 변경마다 호출
  // exit 로 셸이 종료된 게 확인됐을 때: 짧은 취소 여유 후 pane 자동 닫기.
  // onClosePane 이 없으면(닫을 방법 없음) 기존 ended 오버레이로 폴백.
  const beginAutoClose = useCallback(() => {
    if (!onClosePane) {
      endedRef.current = true;
      setEnded(true);
      setEndedNotice('');
      return;
    }
    setClosing(true);
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null;
      onClosePane();
    }, AUTO_CLOSE_MS);
  }, [onClosePane]);

  const cancelAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setClosing(false);
    // 자동 닫기를 취소하면 수동 액션(닫기/다시 연결)을 고를 수 있게 ended 오버레이로 전환.
    endedRef.current = true;
    setEnded(true);
    setEndedNotice('');
  }, []);

  const markEnded = useCallback((notice = '') => {
    endedRef.current = true;
    evictedRef.current = false;
    reconnectingRef.current = false;
    setIsReady(false);
    setReconnecting(false);
    setEvicted(false);
    setClosing(false);
    setConnectionNotice('');
    setEnded(true);
    setEndedNotice(notice);
    onStatusChangeRef.current?.({
      evicted: false,
      ended: true,
      isReady: false,
      hasContent: hasContentRef.current,
      sessionId,
      paneId,
      tabId,
    });
  }, [sessionId, paneId, tabId]);

  const clearEndedForReconnect = useCallback(() => {
    endedRef.current = false;
    setEnded(false);
    setEndedNotice('');
    setClosing(false);
  }, []);

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
  // isActive 를 ref 로도 들고 다님 — handleResize 같은 long-lived 콜백에서 stale closure 피하기.
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const [authPrompt, setAuthPrompt] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [tmuxFallback, setTmuxFallback] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [edgeGutter, setEdgeGutter] = useState({ right: 0, bottom: 0 });
  const copyFlashTimerRef = useRef(null);
  const edgeGutterRef = useRef(edgeGutter);

  const updateEdgeGutter = useCallback((metrics) => {
    if (!metrics) return;
    const next = {
      right: Math.round(metrics.remainderX * 100) / 100,
      bottom: Math.round(metrics.remainderY * 100) / 100,
    };
    const prev = edgeGutterRef.current;
    if (Math.abs(prev.right - next.right) < 0.5 && Math.abs(prev.bottom - next.bottom) < 0.5) return;
    edgeGutterRef.current = next;
    setEdgeGutter(next);
  }, []);
  // authPrompt 열고 닫을 때 전역 이벤트 — App.jsx 가 모바일 단축키바를 그동안 숨김.
  // 언마운트 시 강제 close — TrueNAS MFA 시도 중 탭 닫으면 App 의 authPromptOpen 이
  // true 로 stuck 되어 모바일바가 전체 탭에서 사라지는 버그 방지.
  useEffect(() => {
    authPromptRef.current = !!authPrompt;
    window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: !!authPrompt } }));
    return () => {
      if (authPrompt) {
        window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: false } }));
      }
    };
  }, [authPrompt]);

  // 언마운트 시 auto-close 타이머 정리 (pane 이 다른 경로로 먼저 닫히는 경우 대비).
  useEffect(() => () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  // 로딩 멈춤 감지 — 콘텐츠가 안 들어오고 다른 오버레이도 없는 상태가 LOAD_STUCK_MS 넘게
  // 지속되면 수동 닫기 버튼을 노출한다. 콘텐츠/연결 회복 시 즉시 해제.
  useEffect(() => {
    if (hasContent || ended || evicted || closing) {
      setLoadStuck(false);
      return;
    }
    const timer = setTimeout(() => setLoadStuck(true), LOAD_STUCK_MS);
    return () => clearTimeout(timer);
  }, [hasContent, ended, evicted, closing, reconnecting]);

  // 스마트 스크롤 훅 — xterm buffer API 기반 (DOM scrollTop 아님)
  const { handleUserScroll, handleNewData, forceScrollToBottom } = useSmartScroll(xtermRef, {
    autoScroll: settings.autoScroll,
  });
  // handleNewData 는 autoScroll 설정에 의존하므로 렌더링마다 바뀔 수 있음.
  // useEffect 내부의 flushBufferedOutput 클로저가 항상 최신 콜백을 참조하도록 ref 유지.
  const handleNewDataRef = useRef(handleNewData);
  handleNewDataRef.current = handleNewData;
  const forceScrollToBottomRef = useRef(forceScrollToBottom);
  forceScrollToBottomRef.current = forceScrollToBottom;

  // 테마 가져오기 — settings.theme 이 바뀔 때만 재계산 (매 렌더마다 buildThemeUI 객체
  // 새로 만드는 비용 + 자식 props 변경에 의한 불필요 리렌더 방지).
  const currentTheme = useMemo(
    () => themes[settings.theme] || themes.catppuccin,
    [settings.theme],
  );
  const themeUi = useMemo(() => buildThemeUI(currentTheme), [currentTheme]);
  const connectionKey = useMemo(() => JSON.stringify({
    sessionId,
    hostId: hostId || null,
    tmuxSuffix: tmuxSuffix || null,
    tmuxSessionName: tmuxSessionName || null,
    effectiveTmuxSession: effectiveTmuxSession || null,
    paneIndex,
    cwd: cwd ?? null,
    shell: settings.defaultShell || 'bash',
  }), [sessionId, hostId, tmuxSuffix, tmuxSessionName, effectiveTmuxSession, paneIndex, cwd, settings.defaultShell]);

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
      const metrics = measureTerminalFit(this._terminal, null);
      if (!metrics) return origPropose();
      updateEdgeGutter(metrics);
      return { cols: metrics.cols, rows: metrics.rows };
    };

    const origFit = fitAddon.fit.bind(fitAddon);
    fitAddon.fit = function() {
      const container = terminalRef.current;
      if (container) {
        container.style.width = '100%';
        container.style.height = '100%';
      }
      origFit();
      const metrics = measureTerminalFit(this._terminal, null);
      updateEdgeGutter(metrics);
    };

    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    const imageAddon = new ImageAddon();
    term.loadAddon(imageAddon);

    // BEL(\x07) 수신 시 탭이 백그라운드면 브라우저 알림 (설정 켜야 동작)
    term.onBell(() => {
      if (!settings.bellNotifications) return;
      if (!document.hidden) return;
      if (Notification.permission !== 'granted') return;
      new Notification('Terminal bell', {
        body: paneId ? `Pane ${paneId.slice(0, 6)}` : 'Terminal',
        icon: '/favicon.svg',
        tag: `bell-${paneId || sessionId}`,
        silent: false,
      });
    });

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

    const bufferCellFromClientPoint = (clientX, clientY) => {
      const cell = cellFromClientPoint(clientX, clientY);
      return {
        col: cell.col - 1,
        row: (term.buffer?.active?.viewportY || 0) + cell.row - 1,
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
      // 즉시 ws.send 대신 입력 큐에 push — 트랙패드 스무스 스크롤로 초당 100+ 회 호출돼도
      // 다음 flush 틱에 합쳐서 1회 전송. 키 입력과 같은 경로라 순서도 그대로 유지.
      inputQueueRef.current.push(payload);
      scheduleInputFlush(0);
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
      if (shouldClearSelectionOnScroll({ hasSelection: term.hasSelection(), lines })) {
        try { term.clearSelection(); } catch { /* noop */ }
      }

      const routeToPty = shouldRouteWheelToPty({
        bufferType: term.buffer?.active?.type || 'normal',
        mouseTrackingMode: term.modes?.mouseTrackingMode || 'none',
      });
      if (!routeToPty) {
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
    wantWebglRef.current = wantWebgl;
    // 한 번 부착하면 라이프타임 유지 — 비활성 탭이라도 미리 로드해놔야 활성 전환 시 깜빡임 없음.
    if (wantWebgl) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          // GPU context 가 죽으면 더 못 그림 → dispose 후 자동으로 DOM 렌더러가 인계.
          try { webglAddonRef.current?.dispose(); } catch { /* 이미 정리됨 */ }
          webglAddonRef.current = null;
        });
        term.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch (e) {
        // 초기화 실패 (WebGL 비활성 환경, iframe 정책 등) — 조용히 폴백.
        try { webglAddonRef.current?.dispose(); } catch { /* noop */ }
        webglAddonRef.current = null;
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
    // 클립보드 이미지 → 서버 업로드 후 저장 경로를 터미널 입력으로 주입.
    // (PTY 는 텍스트만 전달하므로 이미지 자체는 못 보냄 → 경로로 우회.)
    const uploadPastedImage = async (blob) => {
      setImagePasteState('uploading');
      try {
        const fd = new FormData();
        const ext = (blob.type.split('/')[1] || 'png').replace('+xml', '');
        fd.append('file', blob, `pasted.${ext}`);
        const res = await fetch('/api/terminal/paste-image', {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || `${res.status}`);
        // 경로 뒤 공백 — 사용자가 이어서 질문을 타이핑할 수 있게.
        term.paste(`${data.path} `);
        setImagePasteState('done');
        setTimeout(() => setImagePasteState(null), 1200);
      } catch (err) {
        logger.error('image paste upload failed', err);
        setImagePasteState('error');
        setTimeout(() => setImagePasteState(null), 2500);
      }
    };

    const handlePaste = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      // 이미지가 클립보드에 있으면 텍스트보다 우선 처리.
      const imageItem = Array.from(cd.items || []).find(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      if (imageItem) {
        const blob = imageItem.getAsFile();
        if (blob) {
          e.preventDefault();
          e.stopPropagation();
          uploadPastedImage(blob);
          return;
        }
      }
      const text = cd.getData('text/plain');
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

    // 우클릭: 브라우저 메뉴와 원격 TUI/tmux 마우스 이벤트를 모두 막고 앱 메뉴만 띄운다.
    // contextmenu 시점만 막으면 먼저 발생한 right-button mousedown 이 xterm 을 통해
    // 원격 앱으로 전달되어 TUI 자체 메뉴가 터미널 위에 그려질 수 있다.
    let lastRightClickMenuAt = 0;
    const openContextMenuFromEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      const term = xtermRef.current;
      if (!term) return;
      lastRightClickMenuAt = Date.now();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        hasSelection: !!term.hasSelection(),
      });
    };
    const handleRightMouseDown = (e) => {
      if (e.button !== 2) return;
      openContextMenuFromEvent(e);
    };
    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (Date.now() - lastRightClickMenuAt < 700) return;
      openContextMenuFromEvent(e);
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
    container.addEventListener('mousedown', handleRightMouseDown, true);
    container.addEventListener('contextmenu', handleContextMenu, true);
    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('paste', handlePaste, true);

    // tmux/vim 계열이 mouse tracking 을 켜도 PC 기본 UX 는 유지한다.
    // 클릭은 앱으로 보내고, plain left-drag 가 임계값을 넘는 순간부터만 xterm selection 으로 전환한다.
    let naturalSelection = null;
    const handleNaturalMouseDown = (e) => {
      const screen = term.element?.querySelector('.xterm-screen');
      if (!screen?.contains(e.target)) {
        naturalSelection = null;
        return;
      }
      if (!shouldUseNaturalMouseSelection({
        event: e,
        isMobile: isMobileRef.current,
        mouseTrackingMode: term.modes?.mouseTrackingMode || 'none',
      })) {
        naturalSelection = null;
        return;
      }
      naturalSelection = {
        startX: e.clientX,
        startY: e.clientY,
        start: bufferCellFromClientPoint(e.clientX, e.clientY),
        selecting: false,
      };
    };
    const handleNaturalMouseMove = (e) => {
      if (!naturalSelection || (e.buttons & 1) !== 1) return;
      const dx = Math.abs(e.clientX - naturalSelection.startX);
      const dy = Math.abs(e.clientY - naturalSelection.startY);
      if (!naturalSelection.selecting && Math.max(dx, dy) < 5) return;
      naturalSelection.selecting = true;
      e.preventDefault();
      e.stopPropagation();
      const args = selectionArgsFromCells(
        naturalSelection.start,
        bufferCellFromClientPoint(e.clientX, e.clientY),
        term.cols,
      );
      if (args) term.select(args.column, args.row, args.length);
    };
    const handleNaturalMouseUp = (e) => {
      if (!naturalSelection) return;
      if (naturalSelection.selecting) {
        e.preventDefault();
        e.stopPropagation();
      }
      naturalSelection = null;
    };
    container.addEventListener('mousedown', handleNaturalMouseDown, true);
    document.addEventListener('mousemove', handleNaturalMouseMove, true);
    document.addEventListener('mouseup', handleNaturalMouseUp, true);

    // Mobile scroll + long-press: 오버레이 div가 canvas 위에서 터치를 독점 처리.
    // touch-action:none 이 오버레이에 있으므로 iOS가 scroll 제스처를 선점하지 않고
    // touchmove passive:false 에서 preventDefault() 가 보장됨.
    const overlay = touchOverlayRef.current;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchScrolling = false;
    let longPressFired = false;
    let scrollAccum = 0;
    let longPressTimer = null;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isTouchScrolling = false;
      longPressFired = false;
      scrollAccum = 0;
      longPressTimer = setTimeout(() => {
        if (!isTouchScrolling) {
          longPressFired = true;
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

    const handleTouchEnd = () => {
      clearTimeout(longPressTimer);
      // 짧은 탭(스크롤·롱프레스 아님) → 터미널 포커스로 iOS 키보드 호출.
      // touchstart 에서 preventDefault 하면 합성 click 이 억제되므로
      // onClick 대신 여기서 사용자 제스처 컨텍스트 안에서 직접 focus 한다.
      if (!isTouchScrolling && !longPressFired) {
        xtermRef.current?.focus();
      }
    };
    const handleTouchContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (overlay) {
      overlay.addEventListener('contextmenu', handleTouchContextMenu);
      overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
      overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
      overlay.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
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
    const shell = encodeURIComponent(settings.defaultShell || 'bash');

    /* preflight 결과로 WS 오픈을 gating. 다른 기기가 이미 attach 중이면 건드리지 않고
       evicted 오버레이만 띄움. 사용자가 명시적으로 "내가 가져오기" 누를 때까지 대기. */
    let cancelled = false;
    const runPreflight = async () => {
      const sessionToCheck = hostId ? effectiveTmuxSession : sessionId;
      if (!sessionToCheck) return { attached: false, exists: true };
      const clientQS = `&client_id=${encodeURIComponent(terminalClientIdRef.current)}`;
      const url = hostId
        ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(sessionToCheck)}${clientQS}`
        : `/api/sessions/${sessionToCheck}/clients?client_id=${encodeURIComponent(terminalClientIdRef.current)}`;
      try {
        const res = await fetch(url, {
          headers: authHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { attached: false, exists: true };
        const data = await res.json();
        // exists 가 false 면 셸이 exit 등으로 tmux 세션이 사라진 상태 → 사용자에게 알리고 명시적 restart.
        return {
          ...data,
          attached: !!data.attached,
          count: data.count || 0,
          exists: data.exists !== false,
        };
      } catch {
        return { attached: false, exists: true };
      }
    };

    const scheduleReconnect = (createIfMissing, notice = '') => {
      if (cancelled) return false;
      const attempts = reconnectAttemptsRef.current;
      if (attempts >= MAX_RECONNECT_ATTEMPTS) return false;
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const delay = Math.min(8000, Math.pow(2, attempts) * 1000);
      reconnectAttemptsRef.current = attempts + 1;
      reconnectingRef.current = true;
      setReconnecting(true);
      clearEndedForReconnect();
      if (notice) setConnectionNotice(notice);
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (!cancelled) connectRef.current?.({ create: createIfMissing, autoRecover: true });
      }, delay);
      return true;
    };

    const scheduleExistingReconnect = (notice = t('networkReconnect') || 'Network connection changed. Reconnecting...') => {
      if (cancelled) return false;
      if (scheduleReconnect(false, notice)) return true;
      markEnded(t('reconnectExistingShellFailed') || 'No existing shell was found. Start a new shell to continue.');
      return false;
    };

    const connect = async (options = {}) => {
      if (cancelled) return;
      const createIfMissing = options.create !== false;
      const autoRecover = options.autoRecover !== false;
      /* 재연결 시작 — evicted 플래그 리셋. tmux 가 재attach 후 버퍼 리플레이 시
         이전 [detached] 메시지를 다시 내려보내므로 오픈 후 1.5초간 무시. */
      evictedRef.current = false;
      // 새 연결 시도 시작 — 이후 예기치 않은 close 는 다시 자동복구 대상이 되도록 리셋.
      intentionalCloseRef.current = false;
      setEndedNotice('');
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
      const createQS = createIfMissing ? '' : '&create=0';
      const clientQS = `&client_id=${encodeURIComponent(terminalClientIdRef.current)}`;
      const wsPath = hostId ? `/ws/host/${hostId}` : `/ws/${sessionId}`;
      const ticketResult = await issueWsTicket(wsPath);
      if (cancelled) return;
      const wsTicket = ticketResult.ticket;
      if (!wsTicket) {
        logger.warn(`WebSocket ticket 발급 실패: ${sessionId}`);
        if (!ticketResult.authExpired && autoRecover) {
          if (scheduleReconnect(createIfMissing, t('networkReconnect') || 'Network connection changed. Reconnecting...')) return;
        }
        // 스피너를 반드시 풀어준다 — 안 그러면 "연결 중..." 무한 대기.
        // 401/403 이면 issueWsTicket 이 이미 session-expired 를 쏴서 로그인 화면이 뜬다.
        markEnded(t('reconnectTicketFailed') || '재연결에 실패했습니다. 세션이 만료되었거나 서버에 연결할 수 없습니다.');
        return;
      }
      const authQS = `ticket=${encodeURIComponent(wsTicket)}`;
      const wsUrl = hostId
        ? `${protocol}//${host}${wsPath}?${authQS}&cols=${cols}&rows=${rows}${paneQS}${cwdQS}${sfxQS}${sessQS}${createQS}${clientQS}`
        : `${protocol}//${host}${wsPath}?${authQS}&cols=${cols}&rows=${rows}&shell=${shell}${cwdQS}${createQS}${clientQS}`;

      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      const wsGeneration = wsGenerationRef.current + 1;
      wsGenerationRef.current = wsGeneration;
      wsRef.current = socket;

      // onopen 까지 너무 오래 걸리면(열리지도 닫히지도 않는 좀비 소켓) 중단하고 재시도 가능 상태로.
      let openTimer = setTimeout(() => {
        if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
        if (socket.readyState === WebSocket.OPEN) return;
        logger.warn(`WebSocket open 타임아웃 — 중단: ${sessionId}`);
        intentionalCloseRef.current = true; // onclose 가 또 다른 재연결 루프 안 타게
        try { socket.close(); } catch { /* noop */ }
        if (autoRecover && scheduleReconnect(createIfMissing, t('networkReconnect') || 'Network connection changed. Reconnecting...')) {
          return;
        }
        markEnded(t('reconnectTimedOut') || '연결이 지연되고 있습니다. 다시 시도해 주세요.');
      }, CONNECT_OPEN_TIMEOUT_MS);
      const clearOpenTimer = () => { if (openTimer) { clearTimeout(openTimer); openTimer = null; } };

      socket.onopen = () => {
        clearOpenTimer();
        if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
        logger.info(`WebSocket 연결 성공: ${sessionId}`);
        if (stableReconnectTimerRef.current) {
          clearTimeout(stableReconnectTimerRef.current);
          stableReconnectTimerRef.current = null;
        }
        setConnectionNotice('');
        ignoreDetachUntil = Date.now() + 1500; // tmux 버퍼 리플레이 윈도우
        setIsReady(true);
        // 재연결 성공 — 오버레이 해제
        if (reconnectingRef.current) {
          reconnectingRef.current = false;
          setReconnecting(false);
          clearEndedForReconnect();
          evictedRef.current = false;
          setEvicted(false);
        }
        stableReconnectTimerRef.current = setTimeout(() => {
          stableReconnectTimerRef.current = null;
          if (cancelled || wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
          if (socket.readyState === WebSocket.OPEN) reconnectAttemptsRef.current = 0;
        }, RECONNECT_STABLE_RESET_MS);

        // 재연결로 다시 열렸을 때, 끊겨있는 동안 큐에 쌓인 입력을 즉시 흘려보낸다.
        if (inputQueueRef.current.length > 0) scheduleInputFlush(0);

        // 하트비트 시작 — half-open 소켓 감지. onopen 직후 lastRecv 초기화.
        lastRecvRef.current = Date.now();
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        // 각 interval 은 자기 id 만 정리 — 재연결로 새 interval 이 떠도 stale tick 이 그걸 끄지 않게.
        const hbId = setInterval(() => {
          if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) {
            clearInterval(hbId);
            if (heartbeatTimerRef.current === hbId) heartbeatTimerRef.current = null;
            return;
          }
          // 백그라운드 탭은 grace-close 가 따로 처리하고, 타이머가 throttle 되어 오탐 위험.
          // 인증 prompt 중에는 사용자가 응답 중이라 끊지 않는다.
          if (document.hidden || authPromptRef.current) return;
          if (socket.readyState !== WebSocket.OPEN) return;
          // 서버 응답(pong 등)이 임계 시간 넘게 없으면 half-open 으로 보고 강제 close → onclose 가 재연결.
          if (Date.now() - lastRecvRef.current > HEARTBEAT_DEAD_MS) {
            logger.warn(`WS 하트비트 타임아웃 — 죽은 소켓 감지, 재연결: ${sessionId}`);
            try { socket.close(); } catch { /* noop */ }
            return;
          }
          try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* noop */ }
        }, HEARTBEAT_INTERVAL_MS);
        heartbeatTimerRef.current = hbId;

        // 서버에 현재 크기 무조건 한번 더 전송 — tmux 가 이전 클라이언트 차원으로 잠긴 케이스 강제 갱신.
        const sendResize = () => {
          if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
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
            if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
            if (socket.readyState === WebSocket.OPEN) {
              const dims = fitAddon.proposeDimensions();
              const c = dims?.cols || term.cols || 80;
              const r = dims?.rows || term.rows || 24;
              // 1px 줄였다가 즉시 복원 → SIGWINCH 가 확실히 두 번 전파
              socket.send(JSON.stringify({ type: 'resize', cols: Math.max(20, c - 1), rows: Math.max(5, r - 1) }));
              setTimeout(() => {
                if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
                }
              }, 60);
            }
          }, 150);
        }
      };

    // 비활성 탭에서 누적된 raw bytes 가 일정 이상 쌓이면 가장 오래된 것부터 폐기 (메모리 방어).
    // 활성 복귀 시 tmux 가 화면을 다시 그려주므로 일부 scrollback 손실은 허용 가능.
    const INACTIVE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
    const dropOldestIfOverCap = () => {
      let total = 0;
      for (const b of wsBufferRef.current) total += b.byteLength;
      while (total > INACTIVE_BUFFER_MAX_BYTES && wsBufferRef.current.length > 1) {
        total -= wsBufferRef.current.shift().byteLength;
      }
    };

    const flushBufferedOutput = () => {
      wsFlushTimeoutRef.current = null;

      if (wsBufferRef.current.length === 0) return;

      // 비활성 탭은 parse/render 비용을 미룬다 — wsBufferRef 에 누적된 채로 두고,
      // isActive 가 true 가 되는 effect 에서 다시 flush. xterm parser CPU + cell buffer
      // 갱신 + setState 트리거 다 절약. tmux 가 활성 시 화면 redraw 도 같이 보내옴.
      if (!isActiveRef.current) {
        dropOldestIfOverCap();
        return;
      }

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

      const onWriteDone = () => {
        handleNewDataRef.current();
        setHasContent(true);
        hasContentRef.current = true;
        if (!contentReadyRef.current) {
          contentReadyRef.current = true;
          onReadyChangeRef.current?.(true);
        }
      };

      // 비활성 탭 누적분(최대 INACTIVE_BUFFER_MAX_BYTES)을 한 번에 write 하면 xterm 파서가
      // 메인 스레드를 길게 점유해 재활성 순간 UI 가 멈춘다. 청크로 쪼개 xterm WriteBuffer 가
      // 프레임 사이사이 렌더를 끼워넣게 한다. subarray 는 복사 없이 뷰만 공유.
      const WRITE_CHUNK_BYTES = 256 * 1024;
      if (mergedBuffer.byteLength <= WRITE_CHUNK_BYTES) {
        term.write(mergedBuffer, onWriteDone);
      } else {
        for (let off = 0; off < mergedBuffer.byteLength; off += WRITE_CHUNK_BYTES) {
          const end = Math.min(off + WRITE_CHUNK_BYTES, mergedBuffer.byteLength);
          const isLast = end >= mergedBuffer.byteLength;
          term.write(mergedBuffer.subarray(off, end), isLast ? onWriteDone : undefined);
        }
      }
    };
    // 외부 effect 에서 활성 복귀 시 호출할 수 있게 ref 노출.
    flushBufferedOutputRef.current = flushBufferedOutput;

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
      if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
      // 어떤 메시지든 수신 = 연결 살아있음. 하트비트 워치독 기준 갱신.
      lastRecvRef.current = Date.now();
      // binary array buffer data
      if (event.data instanceof ArrayBuffer) {
        // Fast heuristic check for detached token without decoding large buffers
        if (event.data.byteLength < 500) {
          try {
            const text = _textDecoder.decode(event.data);
            if (text.includes('[detached (from session') && Date.now() > ignoreDetachUntil) {
              handleEviction();
              return; // don't write detach text to terminal
            }
          } catch {}
        }

        wsBufferRef.current.push(event.data);
        dispatchActivity();
        if (wsFlushTimeoutRef.current) return;
        wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, isActiveRef.current ? 16 : 50);
        return;
      }

      /* JSON 프로토콜 메시지 — 인증 prompt (TOTP/2FA) 등. 터미널 출력으로 가지 않게 일찍 분기. */
      if (typeof event.data === 'string' && event.data.length > 1 && event.data[0] === '{' && event.data[event.data.length - 1] === '}') {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.type === 'pong') {
            // 하트비트 응답 — lastRecv 는 위에서 이미 갱신됨. 터미널로 흘리지 않는다.
            return;
          }
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
        wsBufferRef.current.push(_textEncoder.encode(event.data).buffer);
        dispatchActivity();
        if (wsFlushTimeoutRef.current) return;
        wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, isActiveRef.current ? 16 : 50);
      }
    };

    socket.onclose = (event) => {
      clearOpenTimer();
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (wsGeneration !== wsGenerationRef.current || wsRef.current !== socket) return;
      if (intentionalCloseRef.current) return;
      logger.warn(`WebSocket 연결 끊김: ${sessionId} (code: ${event.code})`);
      setConnectionNotice(t('networkReconnect') || 'Network connection changed. Reconnecting...');
      setIsReady(false);
      // 재연결 시도 중 실패 — 스피너 해제 (오버레이는 유지)
      if (reconnectingRef.current) {
        reconnectingRef.current = false;
        setReconnecting(false);
      }
      if (!autoRecover) {
        markEnded(t('reconnectExistingShellFailed') || 'No existing shell was found. Start a new shell to continue.');
        return;
      }
      if (evictedRef.current) {
        /* takeover 당함 — 자동 재접속 금지. 사용자가 "내가 가져오기" 버튼으로만 재attach. */
        setEvicted(true);
        return;
      }
      // detach token 못 봤어도 server-initiated close 면 takeover 또는 셸 종료 가능성.
      // preflight: attached 면 takeover 오버레이. exists=false 는 전환 레이스일 수 있어
      // 충분히 기다린 뒤에도 재연결을 먼저 시도한다.
      const checkAndRecover = async () => {
        const isStaleSocket = () => cancelled || wsGeneration !== wsGenerationRef.current || wsRef.current !== socket;
        const getPf = async () => {
          try {
            return await (runPreflightRef.current?.() || Promise.resolve({ attached: false, exists: true }));
          } catch {
            return { attached: false, exists: true };
          }
        };
        const confirmTakeover = async () => {
          const deadline = Date.now() + TAKEOVER_CONFIRM_MS;
          let latest = { attached: true, exists: true };
          while (Date.now() < deadline) {
            await sleep(TAKEOVER_CONFIRM_POLL_MS);
            if (isStaleSocket()) return 'stale';
            latest = await getPf();
            if (isStaleSocket()) return 'stale';
            if (latest.same_client_active && !latest.other_client_active) {
              if (latest.network_changed) {
                const net = getNetworkSummary();
                setConnectionNotice(
                  net
                    ? `${t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...'} (${net})`
                    : (t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...')
                );
              }
              return false;
            }
            if (!latest.attached) return false;
          }
          return !!latest.attached;
        };

        const pf = await getPf();
        if (cancelled) return;

        if (pf.attached) {
          if (pf.same_client_active && !pf.other_client_active) {
            const sameDeviceNotice = (() => {
              if (!pf.network_changed) return undefined;
              const net = getNetworkSummary();
              return net
                ? `${t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...'} (${net})`
                : (t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...');
            })();
            if (sameDeviceNotice) setConnectionNotice(sameDeviceNotice);
            scheduleExistingReconnect(sameDeviceNotice);
            return;
          }
          const confirmed = await confirmTakeover();
          if (confirmed === 'stale') return;
          if (!confirmed) {
            scheduleExistingReconnect();
            return;
          }
          evictedRef.current = true;
          setEvicted(true);
          return;
        }

        if (pf.exists === false) {
          // exists=false 직후는 attach 전환, tmux 재기동, 다른 클라이언트 detach 타이밍과
          // 겹칠 수 있다. 여기서 바로 "셸 종료"로 확정하지 않고 grace window 동안
          // attached/exists 회복을 본 다음, 그래도 없으면 재연결로 세션 재생성을 시도한다.
          const deadline = Date.now() + RECOVERY_GRACE_MS;
          let recovered = false;
          while (Date.now() < deadline) {
            await sleep(RECOVERY_POLL_MS);
            if (isStaleSocket()) return;
            const nextPf = await getPf();
            if (isStaleSocket()) return;
            if (nextPf.attached) {
              const confirmed = await confirmTakeover();
              if (confirmed === 'stale') return;
              if (!confirmed) {
                recovered = true;
                break;
              }
              evictedRef.current = true;
              setEvicted(true);
              return;
            }
            if (nextPf.exists !== false) {
              recovered = true;
              break;
            }
          }
          if (!recovered) {
            // grace window 내내 세션이 없었음 → exit 등으로 셸이 깨끗이 종료된 것.
            // 재연결/오버레이 대신 짧은 취소 카운트다운 후 pane 을 자동으로 닫는다.
            if (isStaleSocket()) return;
            beginAutoClose();
            return;
          }
          // 열린 터미널의 재연결은 기존 세션만 찾는다. 새 셸 생성은 새 탭/새 세션 흐름에서만 한다.
        }

        if (isStaleSocket()) return;
        // 호스트 네트워크 불안정 (RPi5 wifi 등) 케이스 대응 — 시도 횟수 늘리고 cap 도 큼.
        // 1→2→4→8→8→8…s, 최대 12회 ≈ 1분 30초. 그 후 ended 화면.
        if (!scheduleReconnect(false, t('networkReconnect') || 'Network connection changed. Reconnecting...')) {
          // 끝까지 실패 — ended 오버레이로 사용자 명시 액션 유도.
          markEnded(t('reconnectExistingShellFailed') || 'No existing shell was found.');
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
    const isLatencySensitiveInput = (data) => (
      typeof data === 'string'
      && (data.length === 1 || (data.charCodeAt(0) === 0x1b && data.length <= 16))
    );

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

    const enqueueInput = (data, { broadcast = false, delay = 0, priority = false, dropQueuedWheel = false } = {}) => {
      if (typeof data !== 'string' || data.length === 0) return false;
      if (dropQueuedWheel) {
        inputQueueRef.current = inputQueueRef.current.filter((item) => !TMUX_WHEEL_INPUT_RE.test(item));
      }
      const MAX_QUEUE_BYTES = 1024 * 1024;
      let totalBytes = data.length;
      for (const item of inputQueueRef.current) totalBytes += item.length;
      while (totalBytes > MAX_QUEUE_BYTES && inputQueueRef.current.length > 1) {
        totalBytes -= inputQueueRef.current.shift().length;
      }
      if (priority) inputQueueRef.current.unshift(data);
      else inputQueueRef.current.push(data);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN && Date.now() - lastRecvRef.current > 3000) {
        probeLivenessRef.current?.();
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setConnectionNotice(t('networkReconnect') || 'Network connection changed. Reconnecting...');
        scheduleInputFlush(Math.max(delay, 50));
      } else {
        scheduleInputFlush(delay);
      }
      if (broadcast) onBroadcastRef.current?.(data);
      return true;
    };
    enqueueInputRef.current = enqueueInput;

    // 입력 시점 빠른 생존 확인 — 사용자가 타이핑하는데 서버로부터 한동안 아무 것도 못 받았으면
    // half-open 의심. ping 을 즉시 쏘고 짧게 기다려 pong(또는 그 외 메시지) 이 안 오면 죽은 소켓으로
    // 보고 재연결. pong 은 셸 상태와 무관하게 브리지가 응답하므로, 비밀번호 입력/장기 실행 명령처럼
    // 에코가 없는 상황에서도 오탐하지 않는다. (35s 하트비트보다 훨씬 빠른 ~3s 복구)
    let lastProbeAt = 0;
    const probeLiveness = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastProbeAt < 2500) return; // 키 입력마다 쏘지 않게 throttle
      lastProbeAt = now;
      const recvBeforeProbe = lastRecvRef.current;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { return; }
      if (livenessProbeTimerRef.current) clearTimeout(livenessProbeTimerRef.current);
      livenessProbeTimerRef.current = setTimeout(() => {
        livenessProbeTimerRef.current = null;
        if (wsRef.current === ws && ws.readyState === WebSocket.OPEN
            && lastRecvRef.current <= recvBeforeProbe) {
          logger.warn(`입력 시점 생존 확인 실패 — 죽은 소켓, 재연결: ${sessionId}`);
          try { ws.close(); } catch { /* noop */ }
        }
      }, 3000);
    };
    probeLivenessRef.current = probeLiveness;

    term.onData((data) => {
      if (isTerminalAutoResponse(data)) {
        if (localStorage.getItem('debug_terminal') === '1') {
          console.debug('[xterm] dropped terminal auto-response from input stream', JSON.stringify(data));
        }
        return;
      }
      // term.onData 는 IME 합성 중 매 음절마다 (backspace+새글자) length>=2 청크가 들어와
      // 히스토리가 한 글자씩 쪼개져 저장되는 노이즈가 심하다. 이 경로에서는 더 이상 캡처하지 않고,
      // 서버 히스토리는 sendData() 명시적 호출 경로 (Quick Input / 음성 / MobileToolbar 등) 만 캡처한다.
      // 단 대용량 paste/장문 bulk 입력은 네트워크 절체 때 복구할 수 있게 로컬 최근 5개에만 남긴다.
      if (looksLikeRecoverableBulkInput(data)) {
        try { pushLocalCommandHistory(sessionId, data); } catch { /* noop */ }
      }
      // 서버가 한동안 조용했는데 사용자가 타이핑하면, 입력이 실제로 닿는지 빠르게 검증.
      if (Date.now() - lastRecvRef.current > 3000) probeLiveness();
      const ws = wsRef.current;
      // WS 가 아직 OPEN 이 아니거나(reconnect 직후·언마운트 사이 깜빡임) CLOSING 상태여도
      // 입력을 버리지 않고 큐에 적재해 다음 OPEN 또는 flush 틱에 전송. drop 으로 인한
      // "키 씹힘" 의 주요 원인 차단. 단 너무 오래 쌓이지 않게 큐 사이즈 보호.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        enqueueInput(data, { broadcast: false, delay: 50 });
        return;
      }
      if (isLatencySensitiveInput(data) && inputQueueRef.current.length === 0 && ws.bufferedAmount < WS_BUFFER_HIGH_WATER) {
        ws.send(data);
        onBroadcastRef.current?.(data);
        return;
      }
      enqueueInput(data, { broadcast: true, delay: 0 });
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
      // 비활성 탭에서는 ResizeObserver 콜백 무시 — 활성화될 때 layoutSignal 효과로 fit 됨.
      if (!isActiveRef.current) return;
      scheduleFit(isMobileRef.current ? 160 : 32, 'observer');
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      resizeTrailingTimeoutRef.current = setTimeout(() => doFit('observer-trailing'), isMobileRef.current ? 360 : 140);
    };

    const handleGlobalFit = () => {
      if (window.__paneResizingActive) return;
      if (!isActiveRef.current) return;
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
        overlay.removeEventListener('contextmenu', handleTouchContextMenu);
        overlay.removeEventListener('touchstart', handleTouchStart);
        overlay.removeEventListener('touchmove', handleTouchMove);
        overlay.removeEventListener('touchend', handleTouchEnd);
      }
      if (container) {
        container.removeEventListener('mousedown', handleRightMouseDown, true);
        container.removeEventListener('contextmenu', handleContextMenu, true);
        container.removeEventListener('keydown', handleKeyDown);
        container.removeEventListener('paste', handlePaste, true);
        container.removeEventListener('mousedown', handleNaturalMouseDown, true);
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchend', handleTouchEnd);
      }
      document.removeEventListener('mousemove', handleNaturalMouseMove, true);
      document.removeEventListener('mouseup', handleNaturalMouseUp, true);
      try { wsRef.current?.close(); } catch {}
      connectRef.current = null;
      runPreflightRef.current = null;
      wsBufferRef.current = [];
      try { webglAddonRef.current?.dispose(); } catch { /* noop */ }
      webglAddonRef.current = null;
      flushBufferedOutputRef.current = null;
      if (graceCloseTimerRef.current) clearTimeout(graceCloseTimerRef.current);
      graceCloseTimerRef.current = null;
      wasClosedForInactivityRef.current = false;
      try { term.dispose(); } catch {}
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (resizeTrailingTimeoutRef.current) clearTimeout(resizeTrailingTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (stableReconnectTimerRef.current) {
        clearTimeout(stableReconnectTimerRef.current);
        stableReconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
      if (livenessProbeTimerRef.current) { clearTimeout(livenessProbeTimerRef.current); livenessProbeTimerRef.current = null; }
      if (resumeProbeTimerRef.current) { clearTimeout(resumeProbeTimerRef.current); resumeProbeTimerRef.current = null; }
      if (wsFlushTimeoutRef.current) clearTimeout(wsFlushTimeoutRef.current);
      if (inputFlushTimeoutRef.current) clearTimeout(inputFlushTimeoutRef.current);
      if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
      if (selectionTimer) clearTimeout(selectionTimer);
      inputQueueRef.current = [];
      enqueueInputRef.current = null;
      probeLivenessRef.current = null;
      fitNowRef.current = null;
    };
  }, [connectionKey, updateEdgeGutter]);

  /* evicted 동안 백엔드 폴링 — 다른 기기가 떨어지면(`count == 0`) 사용자 클릭 없이도 자동 재attach.
     "내가 모바일 닫고나서도 여기 사이즈가 작은 상태로 남아있다" 상황을 방지.
     핑퐁 방지: count=0 을 2회 연속 확인한 뒤에만 재attach (단발 0 = 일시적 blip 무시).
     비활성 탭 / 페이지 hidden 일 땐 폴링 중단 — 사용자가 그 탭을 보지 않는데 미리 재attach 할 이유 없음. */
  useEffect(() => {
    if (!evicted || !isActive) return undefined;
    const sessionToCheck = hostId ? effectiveTmuxSession : sessionId;
    if (!sessionToCheck) return undefined;
    const clientQS = `client_id=${encodeURIComponent(terminalClientIdRef.current)}`;
    const url = hostId
      ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(sessionToCheck)}&${clientQS}`
      : `/api/sessions/${sessionToCheck}/clients?${clientQS}`;
    let cancelled = false;
    let zeroStreak = 0;
    const ZERO_THRESHOLD = 2; // 2회 연속 count=0 이어야 재attach
    const tick = async () => {
      if (document.hidden) return; // 페이지 hidden 이면 폴링 스킵 — 사용자 보이면 visibilitychange 가 다시 tick
      try {
        const res = await fetch(url, { headers: authHeaders() });
        if (cancelled) return;
        if (!res.ok) { zeroStreak = 0; return; }
        const data = await res.json();
        if (data.same_client_active && !data.other_client_active) {
          evictedRef.current = false;
          setEvicted(false);
          setConnectionNotice(t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...');
          if (connectRef.current) connectRef.current({ create: false });
          return;
        }
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
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [evicted, isActive, hostId, effectiveTmuxSession, sessionId]);

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

    /* 활성 탭이 되는 순간 = 가시 영역이 처음 생기는 순간. rAF 한 프레임 뒤 레이아웃 확정 후 fit.
       단, proposed 치수가 현재 term.cols/rows 와 같으면 fit() 자체를 호출하지 않음 — term.resize 가
       호출되면 같은 dims 라도 xterm 이 refresh 를 돌려 "미세한 확대축소" 처럼 보이는 잔상을 만든다.
       탭 전환 시 dims 가 안 바뀌는 게 절대다수라 이 가드로 시각 변화 0. */
    let rafId = requestAnimationFrame(() => {
      const term = xtermRef.current;
      const fit = fitAddonRef.current;
      if (!term || !fit) return;
      const proposed = fit.proposeDimensions();
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return;
      if (proposed.cols === term.cols && proposed.rows === term.rows) {
        return;
      }
      fit.fit();
      const dims = fit.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [layoutSignal, isActive]);

  // 외부 전송용 핸들러 (MobileToolbar / Quick Input 등에서 사용)
  const sendData = useCallback((data) => {
    if (looksLikeBulkCommand(data)) {
      try { pushCommandHistory(sessionId, data); } catch { /* noop */ }
    }
    if (enqueueInputRef.current?.(data, { delay: 0 })) {
      return true;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN && typeof data === 'string') {
      wsRef.current.send(data);
      return true;
    }
    return false;
  }, [sessionId]);

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
  }, [sessionId]);

  // Broadcast: onBroadcast prop 은 broadcastActive 변화마다 교체되므로 ref 로 최신 유지
  const onBroadcastRef = useRef(onBroadcast);
  useEffect(() => { onBroadcastRef.current = onBroadcast; }, [onBroadcast]);

  // 부모(PaneGrid)가 ref 를 통해 sendData 를 호출 — broadcast fan-out 에서 사용.
  useImperativeHandle(ref, () => ({ sendData, sendCommand }), [sendData, sendCommand]);

  const getSelection = useCallback(() => {
    return xtermRef.current?.getSelection() || '';
  }, []);

  const scrollToBottom = useCallback(() => {
    forceScrollToBottomRef.current?.();
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

  // 키보드 포커스는 visible 한 pane 들 중 "focused" 한 1개에만 줘야 한다.
  // 분할(grid) 레이아웃에서 4 pane 모두 isActive=true 이지만 isFocused 는 1개뿐.
  useEffect(() => {
    if (isActive && isFocused && xtermRef.current && isReady) {
      const timer = setTimeout(() => {
        xtermRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, isFocused, isReady]);

  // 활성 복귀 시 비활성 동안 쌓인 출력을 즉시 flush. tmux 도 별도로 화면 redraw 를 보내옴.
  useEffect(() => {
    if (!isActive) return;
    if (flushBufferedOutputRef.current) flushBufferedOutputRef.current();
  }, [isActive]);

  // Phase 3b — 비활성 탭의 WS 를 grace period 후 close, 활성 복귀 시 즉시 재접속.
  //   - tmux 세션은 백엔드에서 그대로 유지되므로 데이터 손실 없음.
  //   - xterm 버퍼/스크롤백은 dispose 하지 않으므로 사용자에게 보이는 마지막 화면 유지.
  //   - 재접속 시 tmux attach 가 현재 화면을 다시 그려서 자연스럽게 동기화.
  // grace = 60s — 사용자가 잠깐 다른 탭 들렀다 돌아오는 경우엔 close 안 됨 (재접속 비용 0).
  useEffect(() => {
    const GRACE_MS = 60_000;
    if (isActive) {
      if (graceCloseTimerRef.current) {
        clearTimeout(graceCloseTimerRef.current);
        graceCloseTimerRef.current = null;
      }
      // 백그라운드 동안 타이머 throttle 로 ping 을 못 보냈을 수 있으니, 복귀 시 워치독 기준을 리셋.
      lastRecvRef.current = Date.now();
      if (wasClosedForInactivityRef.current && connectRef.current) {
        wasClosedForInactivityRef.current = false;
        // 다음 unexpected close 는 다시 auto-reconnect 흐름 타게 reset.
        intentionalCloseRef.current = false;
        connectRef.current({ create: false });
      }
      return undefined;
    }
    if (graceCloseTimerRef.current) clearTimeout(graceCloseTimerRef.current);
    graceCloseTimerRef.current = setTimeout(() => {
      graceCloseTimerRef.current = null;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // evicted/ended overlay 가 떠있으면 사용자 액션 대기 중이므로 건드리지 않음.
      if (evictedRef.current || endedRef.current) return;
      intentionalCloseRef.current = true;
      wasClosedForInactivityRef.current = true;
      try { ws.close(); } catch { /* noop */ }
    }, GRACE_MS);
    return () => {
      if (graceCloseTimerRef.current) {
        clearTimeout(graceCloseTimerRef.current);
        graceCloseTimerRef.current = null;
      }
    };
  }, [isActive]);

  // 모바일/백그라운드 복귀 대응.
  // iOS/Android 브라우저는 백그라운드에서 WS 를 OPEN 상태 그대로 얼려두는 경우가 있어,
  // 화면이 다시 보이면 ping 으로 실제 생존을 확인하고 답이 없으면 close 해서 기존 재연결 경로를 태운다.
  useEffect(() => {
    let fitRaf = null;

    const clearResumeProbe = () => {
      if (resumeProbeTimerRef.current) {
        clearTimeout(resumeProbeTimerRef.current);
        resumeProbeTimerRef.current = null;
      }
    };

    const scheduleFitAfterResume = () => {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(() => {
        fitRaf = null;
        flushBufferedOutputRef.current?.();
        fitNowRef.current?.('resume');
      });
    };

    const handleResume = (reason = 'resume') => {
      if (!isActiveRef.current) return;
      if (document.hidden) return;
      if (navigator.onLine === false) return;
      if (authPromptRef.current || evictedRef.current || endedRef.current) return;

      if (graceCloseTimerRef.current) {
        clearTimeout(graceCloseTimerRef.current);
        graceCloseTimerRef.current = null;
      }

      scheduleFitAfterResume();

      const ws = wsRef.current;
      if (wasClosedForInactivityRef.current
          || !ws
          || ws.readyState === WebSocket.CLOSED
          || ws.readyState === WebSocket.CLOSING) {
        wasClosedForInactivityRef.current = false;
        intentionalCloseRef.current = false;
        reconnectAttemptsRef.current = 0;
        connectRef.current?.({ create: false });
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      if (now - lastResumeProbeAtRef.current < RESUME_PROBE_THROTTLE_MS) return;
      lastResumeProbeAtRef.current = now;

      const recvBeforeProbe = lastRecvRef.current;
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        intentionalCloseRef.current = false;
        try { ws.close(); } catch { /* noop */ }
        return;
      }

      clearResumeProbe();
      resumeProbeTimerRef.current = setTimeout(() => {
        resumeProbeTimerRef.current = null;
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (authPromptRef.current || evictedRef.current || endedRef.current) return;
        if (lastRecvRef.current > recvBeforeProbe) return;
        logger.warn(`복귀 후 WS 생존 확인 실패(${reason}) — 재연결: ${sessionId}`);
        setConnectionNotice(t('sameDeviceNetworkReconnect') || 'Network changed on this device. Reconnecting...');
        intentionalCloseRef.current = false;
        try { ws.close(); } catch { /* noop */ }
      }, RESUME_PROBE_TIMEOUT_MS);
    };

    const onVisibility = () => {
      if (!document.hidden) handleResume('visible');
    };
    const onPageShow = () => handleResume('pageshow');
    const onFocus = () => handleResume('focus');
    const onOnline = () => handleResume('online');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      clearResumeProbe();
      if (fitRaf) cancelAnimationFrame(fitRaf);
    };
  }, [sessionId]);

  // 과거에는 isActive 토글마다 WebglAddon 을 detach/reattach 해 비활성 GPU 비용을 줄였지만,
  // 재부착 시 캔버스 재생성 + 버퍼 전체 repaint 가 탭 전환 때 가시 깜빡임을 만들었다.
  // 이제는 마운트 시 1회 부착하고 라이프타임 동안 유지 — 비활성 탭은 어차피 deferred xterm.write 가
  // 새 데이터를 안 흘리므로 paint 거의 일어나지 않음.

  // 전역 세션 관리자에 현재 활성 함수 등록
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
  }, [sessionId, sendData, sendCommand, getSelection, getBufferText, copyAll, scrollToBottom, scrollToTop, scrollPages, scrollLines, focus, clear, searchNext, searchPrevious, closeSearch, isReady]);

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
        /* Keep xterm sizing tied to the wrapper. Fractional cell remainders are
           rendered as a themed edge gutter below instead of stretching cells. */
        .xterm {
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
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

      {/* 로딩이 오래 멈춰 있을 때 — 스켈레톤 위에 다시 시도 / 닫기 탈출구 노출. */}
      {loadStuck && !hasContent && !ended && !evicted && !closing && (
        <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
          <div style={styles.glassIconTile(themeUi, themeUi.warning || themeUi.subtext)}>
            <AlertTriangle size={18} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
              {t('loadStuckTitle') || '응답이 없습니다'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
              {t('loadStuckDesc') || '연결이 오래 걸리고 있습니다. 다시 시도하거나 이 탭을 닫을 수 있습니다.'}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
            {onClosePane && (
              <button
                type="button"
                onClick={() => { onClosePane(); }}
                style={{ ...styles.glassActionBtn(themeUi, themeUi.subtext), flex: '1 1 92px', minWidth: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 35%, transparent)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 22%, transparent)`; }}
              >
                <X size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: '5px' }} />
                {t('close') || '닫기'}
              </button>
            )}
            <button
              type="button"
              disabled={reconnecting}
              onClick={() => {
                if (reconnectingRef.current) return;
                reconnectingRef.current = true;
                setReconnecting(true);
                setLoadStuck(false);
                reconnectAttemptsRef.current = 0;
                if (connectRef.current) connectRef.current({ create: false, autoRecover: false });
                else window.location.reload();
              }}
              style={{ ...styles.glassActionBtn(themeUi, themeUi.accent), flex: '1 1 112px', minWidth: 0, opacity: reconnecting ? 0.7 : 1 }}
              onMouseEnter={(e) => { if (!reconnecting) e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
            >
              {reconnecting
                ? <Loader2 size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: '5px', animation: 'tl-spin 0.8s linear infinite' }} />
                : <RotateCcw size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: '5px' }} />}
              {reconnecting ? (t('reconnecting') || '연결 중...') : (t('retry') || '다시 시도')}
            </button>
          </div>
        </GlassOverlayCard>
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

      <TerminalEdgeGutter
        right={edgeGutter.right}
        bottom={edgeGutter.bottom}
        themeUi={themeUi}
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
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            cursor: 'default',
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
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

      {imagePasteState && (
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
            color: imagePasteState === 'error' ? (themeUi.danger || themeUi.text) : themeUi.text,
            border: `1px solid ${themeUi.border}`,
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 15,
            opacity: 0.95,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          {imagePasteState === 'uploading' && (
            <>
              <Loader2 size={11} strokeWidth={2} style={{ color: themeUi.accent, animation: 'tl-spin 0.8s linear infinite' }} />
              {t('imagePasteUploading') || '이미지 업로드 중...'}
            </>
          )}
          {imagePasteState === 'done' && (
            <>
              <ArrowDownToLine size={11} strokeWidth={2} style={{ color: themeUi.accent }} />
              {t('imagePasteDone') || '이미지 경로 입력됨'}
            </>
          )}
          {imagePasteState === 'error' && (
            <>
              <AlertTriangle size={11} strokeWidth={2} style={{ color: themeUi.danger || themeUi.text }} />
              {t('imagePasteError') || '이미지 업로드 실패'}
            </>
          )}
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

      {connectionNotice && !ended && !evicted && !closing && (
        <div style={styles.inlineBanner(themeUi)}>
          <Loader2 size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: themeUi.accent, animation: 'tl-spin 0.8s linear infinite' }} />
          <span style={styles.bannerText(themeUi)}>
            {connectionNotice}
          </span>
          <button
            type="button"
            onClick={() => setConnectionNotice('')}
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
            disabled={reconnecting}
            onClick={() => {
              if (reconnectingRef.current) return;
              reconnectingRef.current = true;
              setReconnecting(true);
              if (connectRef.current) connectRef.current();
              else if (onTakeOver) onTakeOver();
              else window.location.reload();
            }}
            style={{ ...styles.glassActionBtn(themeUi, themeUi.accent), opacity: reconnecting ? 0.7 : 1 }}
            onMouseEnter={(e) => { if (!reconnecting) e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
          >
            {reconnecting
              ? <Loader2 size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: '5px', animation: 'tl-spin 0.8s linear infinite' }} />
              : null}
            {reconnecting ? (t('reconnecting') || '연결 중...') : (t('takeOver') || '내가 가져오기')}
          </button>
        </GlassOverlayCard>
      )}

      {closing && !evicted && (
        <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
          <div style={styles.glassIconTile(themeUi, themeUi.subtext)}>
            <PowerOff size={18} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
              {t('shellEndedTitle') || '셸이 종료되었습니다'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
              {t('autoClosingDesc') || '잠시 후 이 탭이 닫힙니다.'}
            </div>
          </div>
          <button
            type="button"
            onClick={cancelAutoClose}
            style={{ ...styles.glassActionBtn(themeUi, themeUi.subtext), width: '100%' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 22%, transparent)`; }}
          >
            <RotateCcw size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: '5px' }} />
            {t('undoClose') || '되돌리기'}
          </button>
        </GlassOverlayCard>
      )}

      {ended && !evicted && !closing && (
        <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
          <div style={styles.glassIconTile(themeUi, themeUi.subtext)}>
            <PowerOff size={18} strokeWidth={1.8} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
              {t('shellEndedTitle') || '셸이 종료되었습니다'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
              {t('shellEndedDesc') || '기존 셸에 다시 연결할 수 있습니다.'}
            </div>
            {endedNotice && (
              <div style={{ marginTop: '6px', fontSize: fontSize['11'], color: themeUi.warning || themeUi.subtext, lineHeight: 1.45 }}>
                {endedNotice}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
            {onClosePane && (
              <button
                type="button"
                onClick={() => { onClosePane(); }}
                style={{ ...styles.glassActionBtn(themeUi, themeUi.subtext), flex: '1 1 0', minWidth: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 35%, transparent)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.subtext} 22%, transparent)`; }}
              >
                <X size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
                <span style={styles.glassActionLabel}>{t('close') || '닫기'}</span>
              </button>
            )}
            <button
              type="button"
              disabled={reconnecting}
              onClick={() => {
                if (reconnectingRef.current) return;
                reconnectingRef.current = true;
                setReconnecting(true);
                clearEndedForReconnect();
                reconnectAttemptsRef.current = 0;
                if (connectRef.current) connectRef.current({ create: false });
                else window.location.reload();
              }}
              style={{ ...styles.glassActionBtn(themeUi, themeUi.accent), flex: '1 1 0', minWidth: 0, opacity: reconnecting ? 0.7 : 1 }}
              onMouseEnter={(e) => { if (!reconnecting) e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
            >
              {reconnecting
                ? <Loader2 size={12} strokeWidth={2} style={{ flexShrink: 0, animation: 'tl-spin 0.8s linear infinite' }} />
                : <RotateCcw size={12} strokeWidth={2} style={{ flexShrink: 0 }} />}
              <span style={styles.glassActionLabel}>
                {reconnecting ? (t('reconnecting') || '연결 중...') : (t('reconnectExistingShell') || '다시 연결')}
              </span>
            </button>
            <button
              type="button"
              disabled={reconnecting}
              onClick={() => {
                if (reconnectingRef.current) return;
                reconnectingRef.current = true;
                setReconnecting(true);
                clearEndedForReconnect();
                reconnectAttemptsRef.current = 0;
                if (connectRef.current) connectRef.current({ create: true });
                else window.location.reload();
              }}
              style={{ ...styles.glassActionBtn(themeUi, themeUi.warning || themeUi.accent), flex: '1 1 0', minWidth: 0, opacity: reconnecting ? 0.7 : 1 }}
              onMouseEnter={(e) => { if (!reconnecting) e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.warning || themeUi.accent} 35%, transparent)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.warning || themeUi.accent} 22%, transparent)`; }}
            >
              <PowerOff size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={styles.glassActionLabel}>{t('restartShell') || '새 셸 시작'}</span>
            </button>
          </div>
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
});

const GlassOverlayCard = ({ themeUi, zIndex = 10040, children }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.38)',
    backdropFilter: 'blur(var(--glass-blur-overlay, 5px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-overlay, 5px))',
    zIndex,
    fontFamily: 'inherit',
  }}>
    <div style={{
      background: `color-mix(in srgb, ${themeUi.surface0 || themeUi.base} 82%, transparent)`,
      backdropFilter: 'blur(var(--glass-blur-panel, 20px))',
      WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 20px))',
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

const TerminalEdgeGutter = ({ right = 0, bottom = 0, themeUi }) => {
  const showRight = right >= 1;
  const showBottom = bottom >= 1;
  if (!showRight && !showBottom) return null;
  const base = themeUi.base || '#11111b';
  return (
    <>
      {showRight && (
        <div
          aria-hidden="true"
          data-testid="terminal-edge-gutter-right"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: `${Math.ceil(right)}px`,
            pointerEvents: 'none',
            zIndex: 1,
            background: `linear-gradient(90deg, color-mix(in srgb, ${base} 0%, transparent), ${base} 72%)`,
          }}
        />
      )}
      {showBottom && (
        <div
          aria-hidden="true"
          data-testid="terminal-edge-gutter-bottom"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${Math.ceil(bottom)}px`,
            pointerEvents: 'none',
            zIndex: 1,
            background: `linear-gradient(180deg, color-mix(in srgb, ${base} 0%, transparent), ${base} 72%)`,
          }}
        />
      )}
    </>
  );
};

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
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleClick = (e) => {
      if (e.button === 2) return;
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      // touchstart 도 함께 — 모바일에서 터미널이 touchstart 를 preventDefault 하면 합성 mousedown 이
      // 억제돼 바깥 탭으로 안 닫히던 문제 우회. (롱프레스로 열리는 컨텍스트 메뉴라 모바일이 주 사용처)
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('touchstart', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    setMeasured(false);
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nx = x, ny = y;
      if (nx + rect.width > window.innerWidth - margin) nx = window.innerWidth - rect.width - margin;
      if (nx < margin) nx = margin;
      if (ny + rect.height > window.innerHeight - margin) ny = window.innerHeight - rect.height - margin;
      if (ny < margin) ny = margin;
      setPos({ x: nx, y: ny });
      setMeasured(true);
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
        ...glassMenuStyle(themeUi, { padding: '4px 0', borderRadius: '8px' }),
        minWidth: '160px',
        fontFamily: tokens.font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
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
          onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(themeUi); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <item.icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.7 }} />
          {item.label}
        </button>
      ))}
      <div style={glassDividerStyle(themeUi, { margin: '3px 0' })} />
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
    minWidth: 0,
    borderRadius: '7px',
    border: `1px solid color-mix(in srgb, ${btnColor} 60%, transparent)`,
    background: `color-mix(in srgb, ${btnColor} 22%, transparent)`,
    color: btnColor,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    padding: '0 8px',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'background 120ms',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  glassActionLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
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
    width: '22px',
    minWidth: '22px',
    padding: 0,
    borderRadius: '5px',
    border: `1px solid color-mix(in srgb, ${themeUi.accent} 60%, transparent)`,
    background: `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`,
    color: themeUi.accent,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxSizing: 'border-box',
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
