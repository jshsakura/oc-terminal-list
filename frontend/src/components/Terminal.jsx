/**
 * Terminal 컴포넌트
 * xterm.js 기반 터미널 에뮬레이터 (테마 및 스마트 스크롤 지원)
 */
import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Loader2 } from 'lucide-react';
import 'xterm/css/xterm.css';
import themes from '../styles/themes';
import useSmartScroll from '../hooks/useSmartScroll';
import useTranslation from '../hooks/useTranslation';
import { normalizeTerminalFontFamily } from '../utils/terminalFonts';

const TerminalComponent = ({ sessionId, settings, onSendData, isActive = true, layoutSignal = '' }) => {
  const { t } = useTranslation(settings.language);
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

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

    // 1. xterm.js 인스턴스 생성 (최신 프리미엄 옵션 적용)
    const terminalFont = normalizeTerminalFontFamily(settings.fontFamily);
    const term = new Terminal({
      theme: currentTheme,
      fontFamily: terminalFont,
      fontSize: settings.fontSize,
      lineHeight: 1.1,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      scrollback: 10000,
      tabStopWidth: 4,
      minimumContrastRatio: 7,
      allowProposedApi: true,
      convertEol: false,
      windowsMode: false,
      smoothScrollDuration: settings.smoothScroll ? 100 : 0,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 2. DOM에 연결 및 초기 리사이즈
    term.open(terminalRef.current);
    
    // 약간의 지연 후 핏 맞추기 (DOM 렌더링 시간 확보)
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);

    // 3. WebSocket 연결 (token 포함)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('auth_token');
    
    // 초기 크기 정보 포함
    const { cols, rows } = fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
    const wsUrl = `${protocol}//${host}/ws/${sessionId}?token=${token}&cols=${cols}&rows=${rows}`;
    
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      logger.info(`WebSocket 연결 성공: ${sessionId}`);
      setIsReady(true);
      reconnectAttemptsRef.current = 0;
      
      // 서버에 현재 크기 다시 한번 확실히 전송
      setTimeout(() => {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          socket.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }, 500);
    };

    socket.onmessage = (event) => {
      term.write(event.data);
      handleNewData();
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
            if (dims) {
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
      socket.close();
      term.dispose();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [sessionId]); // sessionId 변경 시에만 재구동 (currentTheme 제거)

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
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
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
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
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

  // 전역 세션 관리자에 현재 활성 함수 등록
  useEffect(() => {
    if (!window.terminalSessions) window.terminalSessions = {};
    window.terminalSessions[sessionId] = {
      sendData,
      getSelection,
      scrollToBottom,
    };

    return () => {
      if (window.terminalSessions) {
        delete window.terminalSessions[sessionId];
      }
    };
  }, [sessionId, sendData, getSelection, scrollToBottom]);

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
      {/* 상태 표시 레이어 */}
      {!isReady && (
        <div style={{
          ...styles.statusOverlay,
          backgroundColor: currentTheme.ui.bg,
          color: currentTheme.ui.text,
        }}>
          <div className="terminal-loader" style={{ borderColor: currentTheme.ui.accent }}></div>
          <div style={{ marginTop: '15px', fontWeight: '600' }}>{t('connecting')}</div>
        </div>
      )}

      {/* xterm.js 컨테이너 */}
      <div
        ref={terminalRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: isReady ? 1 : 0,
          transition: 'opacity 0.2s ease',
          caretColor: 'transparent', // iOS 네이티브 커서 숨김
          outline: 'none', // 포커스 아웃라인 숨김
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
