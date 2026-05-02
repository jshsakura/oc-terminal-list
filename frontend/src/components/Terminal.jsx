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
import { Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import themes from '../styles/themes';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';

const TerminalComponent = ({ sessionId, settings, onSendData, isActive = true, layoutSignal = '' }) => {
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
  const [isReady, setIsReady] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  // 스마트 스크롤 훅
  const { handleUserScroll, handleNewData } = useSmartScroll(terminalRef, {
    autoScroll: settings.autoScroll,
    sensitivity: settings.scrollSensitivity,
    smoothScroll: settings.smoothScroll,
  });

  // 테마 가져오기
  const currentTheme = themes[settings.theme] || themes.catppuccin;

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

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch (e) {
      console.warn("WebGL addon could not be loaded. Falling back to DOM/Canvas renderer.", e);
    }

    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('terminal:open-search', { detail: { sessionId } }));
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(text);
          }
        }).catch(() => {});
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        const selection = term.getSelection();
        if (selection) {
          e.preventDefault();
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      }
    };

    const handleContextMenu = async (e) => {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(text);
        }
      } catch (err) {
      }
    };

    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    });

    const container = terminalRef.current;
    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('keydown', handleKeyDown);

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

    const proposed = fitAddon.proposeDimensions();
    const cols = proposed?.cols || term.cols || 80;
    const rows = proposed?.rows || term.rows || 24;
    lastDimsRef.current = { cols, rows };
    const wsUrl = `${protocol}//${host}/ws/${sessionId}?token=${token}&cols=${cols}&rows=${rows}&shell=${shell}`;
    
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      logger.info(`WebSocket 연결 성공: ${sessionId}`);
      setIsReady(true);
      reconnectAttemptsRef.current = 0;
      
      // 서버에 현재 크기 다시 한번 확실히 전송
      setTimeout(() => {
        const dims = fitAddon.proposeDimensions();
        if (dims && (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows)) {
          lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
          socket.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }, 500);
    };

    const flushBufferedOutput = () => {
      wsFlushTimeoutRef.current = null;

      if (wsBufferRef.current.length === 0) return;

      const mergedOutput = wsBufferRef.current.join('');
      wsBufferRef.current = [];

      term.write(mergedOutput, () => {
        handleNewData();
        // 첫 데이터가 화면에 그려지면 스켈레톤 제거
        setHasContent(true);
      });
    };

    socket.onmessage = (event) => {
      wsBufferRef.current.push(event.data);
      if (wsFlushTimeoutRef.current) return;
      wsFlushTimeoutRef.current = setTimeout(flushBufferedOutput, 16);
    };

    socket.onclose = (event) => {
      if (!intentionalCloseRef.current) {
        logger.warn(`WebSocket 연결 끊김: ${sessionId} (code: ${event.code})`);
        setIsReady(false);
        handleReconnect();
      }
    };

    socket.onerror = (error) => {
      logger.error(`WebSocket 에러: ${sessionId}`, error);
    };

    // 4. 사용자 입력 처리
    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    // 스크롤 이벤트 연결
    term.onScroll(() => {
      handleUserScroll();
    });

    // 윈도우 리사이즈 대응
    const handleResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const dims = fitAddonRef.current.proposeDimensions();
            if (dims && (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows)) {
              lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
              wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
          }
        }
      }, 200);
    };

    // [중요] ResizeObserver를 통한 컨테이너 크기 변화 감지 (에디터 열고 닫기 등 레이아웃 변화 대응)
    const observer = new ResizeObserver(() => handleResize());
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      intentionalCloseRef.current = true;
      if (observer) observer.disconnect();
      if (container) {
        container.removeEventListener('contextmenu', handleContextMenu);
        container.removeEventListener('keydown', handleKeyDown);
      }
      socket.close();
      wsBufferRef.current = [];
      term.dispose();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsFlushTimeoutRef.current) clearTimeout(wsFlushTimeoutRef.current);
    };
  }, [sessionId]);

  // 테마 및 설정(폰트 크기 등) 변경 시 반영
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = currentTheme;
      xtermRef.current.options.fontSize = settings.fontSize;
      xtermRef.current.options.fontFamily = normalizeTerminalFontFamily(settings.fontFamily);
      xtermRef.current.options.smoothScrollDuration = settings.smoothScroll ? 100 : 0;
      
      // 폰트 변경 후 리사이즈 필요 (폰트 로드 대기를 위해 200ms 지연)
      setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            if (dims.cols !== lastDimsRef.current.cols || dims.rows !== lastDimsRef.current.rows) {
              lastDimsRef.current = { cols: dims.cols, rows: dims.rows };
              wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
          }
        }
      }, 200);
    }
  }, [currentTheme, settings.fontSize, settings.fontFamily, settings.smoothScroll]);

  useEffect(() => {
    if (!isActive) return;

    const timer = setTimeout(() => {
      if (!fitAddonRef.current) return;

      fitAddonRef.current.fit();
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
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
      scrollToBottom,
      focus,
      clear,
      searchNext,
      searchPrevious,
      closeSearch,
    };

    return () => {
      if (window.terminalSessions) {
        delete window.terminalSessions[sessionId];
      }
    };
  }, [sessionId, sendData, getSelection, scrollToBottom, focus, clear, searchNext, searchPrevious, closeSearch]);

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
            backgroundColor: currentTheme.ui.bg,
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
                background: currentTheme.ui.bgTertiary || currentTheme.ui.borderLight || '#313244',
                animation: 'term-skeleton-pulse 1.4s ease-in-out infinite',
                animationDelay: `${i * 90}ms`,
              }}
            />
          ))}
        </div>
      )}

      {/* xterm.js 컨테이너 */}
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
          opacity: hasContent ? 1 : 0,
          transition: 'opacity 0.18s ease',
          caretColor: 'transparent',
          outline: 'none',
        }}
      />
    </>
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
};

export default memo(TerminalComponent);
