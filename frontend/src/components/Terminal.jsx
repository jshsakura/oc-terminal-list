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
import { Loader2, MonitorSmartphone, PowerOff } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { tokens } from '../styles/tokens';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';

const { fontSize, fontWeight, lineHeight, radius, shadow, space } = tokens;

const TerminalComponent = ({ sessionId, hostId, tmuxSuffix = null, tmuxSessionName = null, effectiveTmuxSession = null, settings, onSendData, isActive = true, layoutSignal = '', cwd = null, paneIndex = 0, paneId = null, tabId = null, onTakeOver = null }) => {
  const { t } = useTranslation(settings.language);
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  const wsRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const wsFlushTimeoutRef = useRef(null);
  const wsBufferRef = useRef([]);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const lastDimsRef = useRef({ cols: 0, rows: 0 });
  /* 다른 클라이언트가 takeover (tmux attach -d) 했을 때 PTY 출력에 들어오는
     `[detached (from session ...)]` 토큰을 감지해 evictedRef 를 세움. WS close 시 이 ref 가
     true 면 자동 재접속 로직을 모두 skip — 사용자가 직접 "내가 가져오기" 버튼을 눌러야만 재attach. */
  const evictedRef = useRef(false);
  /* useEffect 내부의 connect()/runPreflight() 를 takeover 버튼/자동 재attach 폴링/탭 활성 변경에서
     호출할 수 있게 ref 로 공개. */
  const connectRef = useRef(null);
  const runPreflightRef = useRef(null);
  // 휠로 copy-mode 진입한 상태 트래킹 — 사용자가 셸 입력 키를 누르면 자동으로 'q' 먼저 보내
  // copy-mode 빠져나오게 한다. wheel up 시 set, 일정 시간 idle 후 자동 reset.
  const wheelStateRef = useRef({ inCopyMode: false, lastWheelTs: 0 });
  const [isReady, setIsReady] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [evicted, setEvicted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(null);
  // authPrompt 열고 닫을 때 전역 이벤트 — App.jsx 가 모바일 단축키바를 그동안 숨김.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('iterm:auth-prompt', { detail: { open: !!authPrompt } }));
  }, [authPrompt]);

  // 스마트 스크롤 훅
  const { handleUserScroll, handleNewData } = useSmartScroll(terminalRef, {
    autoScroll: settings.autoScroll,
    sensitivity: settings.scrollSensitivity,
    smoothScroll: settings.smoothScroll,
  });

  // 테마 가져오기
  const currentTheme = themes[settings.theme] || themes.catppuccin;
  const themeUi = buildThemeUI(currentTheme);

  // 터미널 생성 및 WebSocket 연결
  useEffect(() => {
    if (!terminalRef.current) return;

    setIsReady(false);
    setHasContent(false);

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
      altClickMovesCursor: true,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

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

    // FitAddon은 기본적으로 overview ruler용 14px를 빼고 cols를 계산함 (overviewRuler?.width || 14).
    // 스크롤바를 CSS로 숨기므로 이 공간이 필요 없음. proposeDimensions를 재정의해서 전체 폭을 활용.
    fitAddon.proposeDimensions = () => {
      const d = term._core?._renderService?.dimensions;
      if (!d?.css?.cell?.width || !d?.css?.cell?.height) return undefined;
      const p = term.element?.parentElement;
      if (!p) return undefined;
      const ps = window.getComputedStyle(p);
      const ts = window.getComputedStyle(term.element);
      const w = Math.max(0, parseInt(ps.getPropertyValue('width')));
      const h = parseInt(ps.getPropertyValue('height'));
      const ph = (parseInt(ts.paddingLeft) || 0) + (parseInt(ts.paddingRight) || 0);
      const pv = (parseInt(ts.paddingTop) || 0) + (parseInt(ts.paddingBottom) || 0);
      return {
        cols: Math.max(2, Math.floor((w - ph) / d.css.cell.width)),
        rows: Math.max(1, Math.floor((h - pv) / d.css.cell.height)),
      };
    };

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

    /* xterm 키 가로채기 — Ctrl+V → paste, Ctrl+Shift+C → copy, F12 → DevTools.
       추가: 휠로 copy-mode 진입한 상태에서 셸 입력 키 누르면 자동 'q' 먼저 보내 copy-mode 종료. */
    const COPY_MODE_GRACE_MS = 8000; // wheel 후 8초 내 셸 입력 = copy-mode 활성으로 간주

    // 대용량 붙여넣기: 3000자 단위로 나눠서 16ms 간격 전송 → 브라우저 이벤트루프 블로킹 방지.
    const PASTE_CHUNK = 3000;
    const sendPasteChunked = (text) => {
      if (!text) return;
      if (text.length <= PASTE_CHUNK) { term.paste(text); return; }
      let i = 0;
      const next = () => {
        if (!xtermRef.current) return;
        xtermRef.current.paste(text.slice(i, i + PASTE_CHUNK));
        i += PASTE_CHUNK;
        if (i < text.length) setTimeout(next, 16);
      };
      next();
    };

    // paste 이벤트: ClipboardEvent.clipboardData → clipboard-read 권한 불필요.
    // capture 단계(true)에서 먼저 가로채 xterm 자체 paste 핸들러 실행 전에 청크 전송.
    const handlePaste = (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      sendPasteChunked(text);
    };
    container.addEventListener('paste', handlePaste, true);
    const isShellInputKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key.length === 1) return true; // 인쇄 가능 문자
      return e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab';
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.key === 'F12') return false;
      // Ctrl+V / Cmd+V: return false(xterm 처리 중단) but e.preventDefault() 호출 안 함 →
      // 브라우저가 paste 이벤트를 발화 → handlePaste 가 clipboardData 로 권한 없이 읽음.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
        wheelStateRef.current.inCopyMode = false;
        return false;
      }
      // Ctrl+Shift+C (Linux/Win) 또는 Cmd+C (Mac, 선택 있을 때) → copy
      if ((e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) ||
          (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C'))) {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel).catch(() => {});
          return false;
        }
      }
      // copy-mode 자동 종료 — 휠로 진입했고 grace period 안에 셸 입력 키면 'q' 먼저.
      if (wheelStateRef.current.inCopyMode && isShellInputKey(e)) {
        const grace = Date.now() - wheelStateRef.current.lastWheelTs < COPY_MODE_GRACE_MS;
        if (grace) {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) ws.send('q');
        }
        wheelStateRef.current.inCopyMode = false;
      }
      return true;
    });

    // 우클릭: 네이티브 컨텍스트 메뉴를 막아 tmux 가 마우스 이벤트를 처리할 수 있게 함.
    // 붙여넣기는 Cmd+V / Ctrl+V 가 paste 이벤트로 항상 작동하므로 별도 처리 불필요.
    const handleContextMenu = (e) => e.preventDefault();

    /* 드래그 중 mousemove 마다 onSelectionChange fire — 정착(80ms idle) 후 한 번만 클립보드 write.
       race / 이중 발화 방지. */
    let selectionTimer = null;
    term.onSelectionChange(() => {
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const selection = term.getSelection();
        if (selection) navigator.clipboard.writeText(selection).catch(() => {});
      }, 80);
    });

    const container = terminalRef.current;
    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('keydown', handleKeyDown);

    /* 휠 → PgUp/PgDn. xterm v6 의 attachCustomWheelEventHandler 사용 — xterm 내장 wheel 처리 직전에
       호출되며, return false → xterm 의 default 처리 skip. capture/bubble race 없음. tmux mouse off
       이라 native 드래그 선택은 그대로 살아있고, 휠만 PgUp 으로 변환해 PTY 송신 → tmux root binding
       이 normal/alternate 자동 분기 (normal=copy-mode 진입). */
    if (typeof term.attachCustomWheelEventHandler === 'function') {
      term.attachCustomWheelEventHandler((e) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return true;
        ws.send(e.deltaY > 0 ? '\x1b[6~' : '\x1b[5~');
        // wheel up = copy-mode 진입(또는 더 위로). 사용자가 그 후 셸 입력하면 자동 'q' 보내야.
        if (e.deltaY < 0) wheelStateRef.current.inCopyMode = true;
        wheelStateRef.current.lastWheelTs = Date.now();
        return false;
      });
    }



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
      wsRef.current = socket;

      socket.onopen = () => {
      logger.info(`WebSocket 연결 성공: ${sessionId}`);
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
      setTimeout(sendResize, 200);

      // WebGL renderer 가 첫 paint 이후 변경 감지 못하는 케이스 — attach 직후 prompt 가
      // 이미 그려져 있는데 화면이 비어보이는 증상. 강제로 viewport 전체를 refresh 해 화면 동기화.
      const forceRedraw = () => {
        try { term.refresh(0, term.rows - 1); } catch {}
      };
      setTimeout(forceRedraw, 100);
      setTimeout(forceRedraw, 400);
      // 호스트 세션은 attach 후 SIGWINCH 한 번 더 흔들어서 tmux→shell 재그리기 유도.
      // (Ctrl+L 은 zsh 키바인딩이 없는 환경에선 ^L 로 노출되므로 사용 안 함)
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
        }, 350);
      }
    };

    const flushBufferedOutput = () => {
      wsFlushTimeoutRef.current = null;

      if (wsBufferRef.current.length === 0) return;

      const mergedOutput = wsBufferRef.current.join('');
      wsBufferRef.current = [];

      term.write(mergedOutput, () => {
        handleNewData();
        // WebGL renderer 가 일부 update 를 누락하는 케이스 방어 — 매 flush 끝에 viewport 전체 강제 refresh.
        try { term.refresh(0, term.rows - 1); } catch {}
        setHasContent(true);
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

    socket.onmessage = (event) => {
      /* JSON 프로토콜 메시지 — 인증 prompt (TOTP/2FA) 등. 터미널 출력으로 가지 않게 일찍 분기. */
      if (typeof event.data === 'string' && event.data.length > 1 && event.data[0] === '{' && event.data[event.data.length - 1] === '}') {
        try {
          const msg = JSON.parse(event.data);
          if (msg && msg.type === 'auth-prompt') {
            setAuthPrompt(msg);
            return;
          }
        } catch { /* JSON 아님, 일반 출력으로 통과 */ }
      }
      /* tmux 가 다른 클라이언트에게 takeover 당해 우리를 detach 시킬 때, 마지막에 보내는
         `[detached (from session ...)]` 한 줄로 의도적 detach 임을 식별 — 네트워크 끊김과 분리. */
      if (typeof event.data === 'string' && event.data.includes('[detached (from session')) {
        evictedRef.current = true;
      }
      wsBufferRef.current.push(event.data);
      dispatchActivity();
      if (wsFlushTimeoutRef.current) return;
      wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, 16);
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
        try {
          const pf = await (runPreflightRef.current?.() || Promise.resolve({ attached: false, exists: true }));
          if (cancelled) return;
          if (pf.attached) {
            evictedRef.current = true;
            setEvicted(true);
            return;
          }
          if (pf.exists === false) {
            // 셸이 exit 으로 tmux 세션이 죽음. 자동 재생성 X — 사용자가 명시적으로 Restart 누르게.
            setEnded(true);
            return;
          }
        } catch {}
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

    /* mount: preflight → 결과에 따라 connect() 또는 evicted 오버레이.
       WS 는 mount 동안 *계속* 열려 있음 — 탭 전환마다 끊었다 다시 붙으면 사용자가 "완전 재연결"
       느낌을 받고, tmux 가 매번 redraw/clear 보내 jitter 발생. 멀티 디바이스 충돌은 *같은 세션*
       의 문제이고 한 디바이스 안 여러 탭(=다른 세션) 동시 attach 는 무해하므로 isActive 와
       WS 는 디커플. isActive 는 focus/visibility 만 담당. */
    runPreflight().then(({ attached }) => {
      if (cancelled) return;
      if (attached) {
        evictedRef.current = true;
        setEvicted(true);
      } else {
        connect();
      }
    });

    // 4. 사용자 입력 처리 — connect() 가 여러 번 호출돼도 (takeover/auto-resume) 항상 최신 ws 를 잡게 ref 사용.
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // 스크롤 이벤트 연결
    term.onScroll(() => {
      handleUserScroll();
    });

    // 윈도우 리사이즈 대응 — debounce 350ms.
    // 모바일 키보드 애니메이션 (~250-300ms) 중간에 fit() 가 여러 번 호출되면
    // xterm grid + tmux 가 매번 다시 그려서 화면이 "득득" 떨림. 한 박자 늦춰서
    // 애니메이션 끝난 후 한 번만 fit → 최종 사이즈 확정 → 한 번만 reflow.
    const handleResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        if (!fitAddonRef.current) return;
        /* 비활성 탭은 컨테이너가 display:none → 0×0. fit() 호출하면 cols=0, rows=0 이 되고
           tmux 에 그 사이즈로 resize 메시지가 가서 세션이 망가짐. 가시 영역 있을 때만 fit. */
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
      }, 350);
    };

    // [중요] ResizeObserver를 통한 컨테이너 크기 변화 감지 (에디터 열고 닫기 등 레이아웃 변화 대응)
    const observer = new ResizeObserver(() => handleResize());
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      cancelled = true;
      intentionalCloseRef.current = true;
      if (observer) observer.disconnect();
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
        container.removeEventListener('keydown', handleKeyDown);
        container.removeEventListener('paste', handlePaste, true);
      }
      try { wsRef.current?.close(); } catch {}
      connectRef.current = null;
      runPreflightRef.current = null;
      wsBufferRef.current = [];
      term.dispose();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsFlushTimeoutRef.current) clearTimeout(wsFlushTimeoutRef.current);
    };
  }, [sessionId]);

  /* evicted 동안 백엔드 폴링 — 다른 기기가 떨어지면(`count == 0`) 사용자 클릭 없이도 자동 재attach.
     "내가 모바일 닫고나서도 여기 사이즈가 작은 상태로 남아있다" 상황을 방지. */
  useEffect(() => {
    if (!evicted) return undefined;
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth_token') : null;
    const sessionToCheck = hostId ? effectiveTmuxSession : sessionId;
    if (!sessionToCheck) return undefined;
    const url = hostId
      ? `/api/hosts/${hostId}/tmux-clients?session=${encodeURIComponent(sessionToCheck)}`
      : `/api/sessions/${sessionToCheck}/clients`;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        if (!data.attached) {
          /* 다른 기기 다 떨어짐 → 자동 재attach. connectRef 직접 호출해 remount 없이 WS 만 다시 열음.
             새 attach 가 PC 의 PTY 사이즈로 spawn 되니 tmux 가 자동으로 PC 사이즈로 resize 됨. */
          evictedRef.current = false;
          setEvicted(false);
          if (connectRef.current) connectRef.current();
        }
      } catch { /* 네트워크 일시 실패 — 다음 tick 에서 다시 */ }
    };
    /* 처음에 한 번 빠르게, 이후 4초 간격. */
    const initial = setTimeout(tick, 1500);
    const id = setInterval(tick, 4000);
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
      
      // 폰트 변경 후 리사이즈 필요 (폰트 로드 대기를 위해 200ms 지연).
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
      }, 200);
    }
  }, [currentTheme, settings.fontSize, settings.fontFamily, settings.smoothScroll]);

  useEffect(() => {
    if (!isActive) return;

    /* 활성 탭이 되는 순간 = 가시 영역이 처음 생기는 순간. 이전엔 display:none 이라
       fit 을 스킵했으므로 여기서 한 번 정확히 맞춰서 tmux 에 알림. */
    const timer = setTimeout(() => {
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
    }, 120);

    return () => clearTimeout(timer);
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

  // 페이지/라인 단위 스크롤 — 두 가지 경로를 동시에 trigger 해 한쪽이 동작하면 OK.
  //  1) xterm.js 자체 client-side scrollback (normal buffer + 충분한 history 일 때)
  //  2) PgUp/PgDn 키 시퀀스 PTY 송신 (tmux 가 #{alternate_on} root binding 으로
  //     자동 분기 — alt-buffer 면 응용 프로그램으로 통과, normal 이면 copy-mode 진입)
  // 둘 다 trigger 해도 normal+xterm 케이스는 시각 변화 한 번만 일어남.
  const scrollPages = useCallback((pages) => {
    const term = xtermRef.current;
    if (!term || pages === 0) return;
    // 1. xterm 자체 scrollback — normal buffer 면 즉시 화면 위로 이동
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollPages(pages); } catch { /* noop */ }
    }
    // 2. PTY 로 키 시퀀스 송신 — tmux/vim/less 가 처리
    const seq = pages > 0 ? '\x1b[6~' : '\x1b[5~';
    const n = Math.max(1, Math.abs(pages));
    for (let i = 0; i < n; i++) sendData(seq);
  }, [sendData]);

  const scrollLines = useCallback((lines) => {
    const term = xtermRef.current;
    if (!term || lines === 0) return;
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollLines(lines); } catch { /* noop */ }
    }
    // alternate buffer 일 때만 화살표 송신 (normal 셸에선 prompt 흔들림 방지)
    if (term.buffer?.active?.type === 'alternate') {
      const seq = lines > 0 ? '\x1b[B' : '\x1b[A';
      const n = Math.max(1, Math.abs(lines));
      for (let i = 0; i < n; i++) sendData(seq);
    }
  }, [sendData]);

  const scrollToTop = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (term.buffer?.active?.type === 'normal') {
      try { term.scrollToTop(); } catch { /* noop */ }
    }
    if (term.buffer?.active?.type === 'alternate') {
      sendData('\x1b[1~'); // Home
    }
  }, [sendData]);

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
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // execCommand fallback (구형/HTTP 환경)
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch { return false; }
    }
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
      searchNext,
      searchPrevious,
      closeSearch,
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
    };

    return () => {
      if (window.terminalSessions) {
        delete window.terminalSessions[sessionId];
      }
    };
  }, [sessionId, sendData, getSelection, getBufferText, copyAll, scrollToBottom, scrollToTop, scrollPages, scrollLines, focus, clear, searchNext, searchPrevious, closeSearch]);

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
          opacity: hasContent ? 1 : 0,
          transition: 'opacity 0.18s ease',
          caretColor: 'transparent',
          outline: 'none',
        }}
      />

      {/* takeover 배너 — 패널 하단 인라인, 여러 패널에 동시 노출 가능 */}
      {evicted && (
        <div style={styles.inlineBanner(themeUi)}>
          <MonitorSmartphone size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
          <span style={styles.bannerText(themeUi)}>
            {t('takenOverTitle') || '다른 기기에서 이 세션을 사용 중입니다'}
          </span>
          <button
            type="button"
            onClick={() => {
              evictedRef.current = false;
              setEvicted(false);
              if (connectRef.current) {
                connectRef.current();
              } else if (onTakeOver) {
                onTakeOver();
              } else {
                window.location.reload();
              }
            }}
            style={styles.bannerButton(themeUi)}
          >
            {t('takeOver') || '내가 가져오기'}
          </button>
        </div>
      )}

      {/* shell 종료 배너 — 패널 하단 인라인 */}
      {ended && !evicted && (
        <div style={styles.inlineBanner(themeUi)}>
          <PowerOff size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
          <span style={styles.bannerText(themeUi)}>
            {t('shellEndedTitle') || '셸이 종료되었습니다'}
          </span>
          <button
            type="button"
            onClick={() => {
              setEnded(false);
              reconnectAttemptsRef.current = 0;
              if (connectRef.current) {
                connectRef.current();
              } else {
                window.location.reload();
              }
            }}
            style={styles.bannerButton(themeUi)}
          >
            {t('restartShell') || '새 셸 시작'}
          </button>
        </div>
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
            setEnded(true);
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
          <div style={styles.iconTile(themeUi)}>2FA</div>
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
            style={{
              ...styles.secondaryModalButton(themeUi),
            }}
          >
            {t('cancel') || 'Cancel'}
          </button>
          <button
            type="submit"
            style={{
              ...styles.primaryModalButton(themeUi),
              background: themeUi.accent,
              color: themeUi.crust,
            }}
          >
            {t('authPromptSubmit') || 'Continue'}
          </button>
        </footer>
      </form>
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
    position: 'fixed',
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
  modalCard: (themeUi) => ({
    width: '90%',
    maxWidth: '420px',
    maxHeight: '80dvh',
    background: themeUi.base,
    color: themeUi.text,
    border: `1px solid ${themeUi.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
  }),
  modalHeader: (themeUi) => ({
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['1.5']} ${space['3']}`,
    borderBottom: `1px solid ${themeUi.border}`,
  }),
  iconTile: (themeUi) => ({
    width: '24px',
    height: '24px',
    borderRadius: radius.sm,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: themeUi.surface1,
    border: `1px solid ${themeUi.border}`,
    color: themeUi.text,
    fontSize: '11px',
    fontWeight: 600,
    flexShrink: 0,
  }),
  modalTitle: (themeUi) => ({
    color: themeUi.text,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    letterSpacing: '0.01em',
  }),
  modalBody: (themeUi, textAlign = 'center') => ({
    flex: 1,
    padding: `${space['2']} ${space['3']}`,
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
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid ${themeUi.border}`,
    background: themeUi.mantle,
  }),
  primaryModalButton: (themeUi) => ({
    flex: 1,
    height: '36px',
    borderRadius: radius.sm,
    border: `1px solid ${themeUi.accent}`,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }),
  secondaryModalButton: (themeUi) => ({
    flex: 1,
    height: '36px',
    borderRadius: radius.sm,
    border: `1px solid ${themeUi.border}`,
    background: 'transparent',
    color: themeUi.text,
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
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
    height: '40px',
    padding: `0 ${space['3']}`,
    background: themeUi.mantle,
    color: themeUi.text,
    border: `1px solid ${themeUi.border}`,
    borderRadius: radius.sm,
    outline: 'none',
    fontSize: fontSize['14'],
    fontFamily: 'inherit',
  }),
  inlineBanner: (themeUi) => ({
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['1']} ${space['3']}`,
    background: themeUi.surface1,
    borderTop: `1px solid ${themeUi.border}`,
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
    height: '24px',
    padding: `0 ${space['2']}`,
    borderRadius: radius.sm,
    border: `1px solid ${themeUi.border}`,
    background: themeUi.accent,
    color: themeUi.crust,
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
