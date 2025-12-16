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

const TerminalComponent = ({ sessionId, settings, onSendData, isActive = true }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  const { t } = useTranslation(settings.language);

  // 스마트 스크롤 훅
  const { handleUserScroll, handleNewData } = useSmartScroll(terminalRef, {
    autoScroll: settings.autoScroll,
    sensitivity: settings.scrollSensitivity,
    smoothScroll: settings.smoothScroll,
  });

  // 테마 가져오기
  const currentTheme = themes[settings.theme] || themes.catppuccin;

  // 터미널 생성 및 WebSocket 연결 (sessionId가 변경될 때만)
  useEffect(() => {
    if (!terminalRef.current) return;

    // 플래그 초기화
    intentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;

    // 로딩 상태로 설정
    setIsReady(false);

    // xterm.js 인스턴스 생성 (성능 최적화)
    const term = new Terminal({
      theme: currentTheme,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 1000, // 메모리 및 성능 최적화
      convertEol: true,
      screenReaderMode: false,
      smoothScrollDuration: settings.smoothScroll ? 50 : 0,
      disableStdin: false,
      windowOptions: {
        setWinLines: true,
      },
      // 성능 최적화 옵션
      fastScrollModifier: 'shift',
      fastScrollSensitivity: 5,
      scrollSensitivity: 3,
      rendererType: 'canvas', // canvas가 WebGL보다 안정적
      drawBoldTextInBrightColors: false, // 렌더링 부하 감소
    });

    // Fit 애드온
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // 터미널 마운트
    term.open(terminalRef.current);

    // 터미널 초기화 (이전 내용 제거 및 스크롤 리셋)
    term.reset();

    // 참조 저장 (fit 전에 먼저 저장)
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 즉시 fit 실행 (동기적으로)
    try {
      fitAddon.fit();
      term.focus();
    } catch (err) {
      console.error('Initial fit error:', err);
    }

    // 추가로 약간의 딜레이 후 한 번 더 (레이아웃이 완전히 잡힌 후)
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (err) {
        console.error('Fit error:', err);
      }
    }, 50);

    // ResizeObserver로 컨테이너 크기 변화 감지 (debounce 적용)
    const resizeObserver = new ResizeObserver(() => {
      // 즉시 fit 실행 (시각적 반영)
      try {
        fitAddon.fit();
        console.log(`Terminal resized: ${term.cols}x${term.rows}`);
      } catch (err) {
        console.error('Immediate fit error:', err);
      }

      // 서버 알림만 debounce (API 호출 최적화)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const token = localStorage.getItem('auth_token');
          fetch(`/api/sessions/${sessionId}/resize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify({
              cols: term.cols,
              rows: term.rows,
            }),
          }).catch((err) => console.error('크기 변경 실패:', err));
        }
      }, 200);
    });
    resizeObserver.observe(terminalRef.current);

    // 초고속 배치 처리 (더 공격적)
    let messageBuffer = [];
    let timerId = null;

    const flushBuffer = () => {
      if (messageBuffer.length > 0) {
        // 버퍼 크기가 크면 잘라서 처리 (메모리 절약)
        const batch = messageBuffer.splice(0, 100).join('');
        term.write(batch);

        // 남은 데이터가 있으면 다음 프레임에 처리
        if (messageBuffer.length > 0) {
          timerId = setTimeout(flushBuffer, 0);
        } else {
          handleNewData();
          timerId = null;
        }
      }
    };

    // WebSocket 연결 함수 (재연결 가능)
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host || 'localhost:8000';
      const wsUrl = `${protocol}//${wsHost}/ws/${sessionId}?cols=${term.cols}&rows=${term.rows}`;

      console.log('WebSocket 연결 시도:', wsUrl, `(${term.cols}x${term.rows})`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket 연결됨:', sessionId);
        reconnectAttemptsRef.current = 0; // 재연결 카운터 리셋

        // 메시지 출력 전에 터미널 크기 재조정
        try {
          fitAddon.fit();
        } catch (err) {
          console.error('Fit error on connect:', err);
        }

        // 터미널 준비 완료
        setIsReady(true);

        // 터미널 포커스 (키 입력 받기 위해 필수)
        term.focus();

        // 연결 후 즉시 터미널 크기 서버에 전송
        const token = localStorage.getItem('auth_token');
        fetch(`/api/sessions/${sessionId}/resize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            cols: term.cols,
            rows: term.rows,
          }),
        }).catch((err) => console.error('초기 크기 설정 실패:', err));
      };

      ws.onmessage = (event) => {
        messageBuffer.push(event.data);

        // 32ms마다 배치 처리 (부드러운 30fps)
        if (!timerId) {
          timerId = setTimeout(flushBuffer, 32);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket 에러:', error);
      };

      ws.onclose = (event) => {
        console.log('WebSocket 연결 종료:', event.code, event.reason);

        // 의도적인 종료가 아니면 재연결 시도
        if (!intentionalCloseRef.current) {
          setIsReady(false);

          const maxAttempts = 10;
          if (reconnectAttemptsRef.current < maxAttempts) {
            reconnectAttemptsRef.current += 1;
            // 지수 백오프: 1초, 2초, 4초, 8초... (최대 30초)
            const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);

            term.writeln(`\x1b[1;33m⚠ ${t('disconnected')} - 재연결 시도 ${reconnectAttemptsRef.current}/${maxAttempts} (${delay/1000}초 후)\x1b[0m`);

            reconnectTimeoutRef.current = setTimeout(() => {
              console.log(`재연결 시도 ${reconnectAttemptsRef.current}/${maxAttempts}`);
              connectWebSocket();
            }, delay);
          } else {
            term.writeln(`\x1b[1;31m✗ 재연결 실패: 최대 시도 횟수 초과\x1b[0m`);
          }
        }
      };

      return ws;
    };

    // 초기 WebSocket 연결
    const ws = connectWebSocket();

    // 한글 IME 조합 처리
    let isComposing = false;

    // IME 조합 중 키 이벤트 필터링 (keyCode 229 = IME 조합 중)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown') {
        if (event.isComposing || event.keyCode === 229) {
          isComposing = true;
          return false; // xterm이 이 키 이벤트를 처리하지 않도록
        }
        isComposing = false;
      }
      return true;
    });

    // 사용자 입력 → WebSocket으로 전송
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
      if (onSendData) {
        onSendData(data);
      }
    });

    // IME 조합 완료 시 완성된 문자 전송
    const handleCompositionEnd = (e) => {
      isComposing = false;
      const text = e.data;
      if (text && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(text);
        // 터미널에도 표시
        term.write(text);
      }
    };

    // xterm 내부 textarea에 이벤트 리스너 추가
    setTimeout(() => {
      const textarea = terminalRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.addEventListener('compositionend', handleCompositionEnd);
        textarea._compositionEndHandler = handleCompositionEnd;
      }
    }, 100);

    // window resize는 제거 (ResizeObserver로 통일)

    // 사용자 스크롤 감지 (스마트 스크롤용)
    const container = terminalRef.current;
    if (container) {
      container.addEventListener('scroll', handleUserScroll);
    }

    // 정리
    return () => {
      // 의도적인 종료 플래그 설정 (재연결 방지)
      intentionalCloseRef.current = true;

      // 타이머 취소
      if (timerId) {
        clearTimeout(timerId);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (container) {
        container.removeEventListener('scroll', handleUserScroll);
        // IME 이벤트 리스너 제거
        const textarea = container.querySelector('textarea');
        if (textarea && textarea._compositionEndHandler) {
          textarea.removeEventListener('compositionend', textarea._compositionEndHandler);
        }
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      term.dispose();
    };
  }, [sessionId, handleUserScroll, handleNewData, t]);

  // 설정 변경 시 터미널 옵션 업데이트
  useEffect(() => {
    if (!xtermRef.current) return;

    const term = xtermRef.current;

    // 테마 업데이트
    term.options.theme = currentTheme;

    // 폰트 업데이트
    term.options.fontFamily = '"JetBrains Mono", monospace';
    term.options.fontSize = settings.fontSize;

    // 스크롤 설정 업데이트
    term.options.smoothScrollDuration = settings.smoothScroll ? 50 : 0;

    // 터미널 새로고침
    term.refresh(0, term.rows - 1);
  }, [settings.theme, settings.fontFamily, settings.fontSize, settings.smoothScroll, currentTheme]);

  // 활성 상태 변경 시 커서 깜빡임 제어 및 포커스
  useEffect(() => {
    if (!xtermRef.current) return;

    const term = xtermRef.current;
    term.options.cursorBlink = isActive;

    // 활성 세션이 되면 포커스 (키 입력 받기 위해)
    if (isActive) {
      term.focus();
    }
  }, [isActive]);

  // 외부에서 데이터 전송 (MobileToolbar용)
  const sendData = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  // 터미널에서 선택된 텍스트 가져오기
  const getSelection = useCallback(() => {
    if (xtermRef.current) {
      return xtermRef.current.getSelection();
    }
    return '';
  }, []);

  // 맨 아래로 스크롤
  const scrollToBottom = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.scrollToBottom();
    }
  }, []);

  // 외부 노출용 (세션별로 관리)
  useEffect(() => {
    if (!window.terminalSessions) {
      window.terminalSessions = {};
    }
    window.terminalSessions[sessionId] = {
      sendData,
      getSelection,
      scrollToBottom,
    };

    return () => {
      // 정리 시 세션 제거
      if (window.terminalSessions) {
        delete window.terminalSessions[sessionId];
      }
    };
  }, [sessionId, sendData, getSelection, scrollToBottom]);

  // 터미널 클릭 시 포커스
  const handleTerminalClick = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  return (
    <>
      {/* 로딩 오버레이 */}
      {!isReady && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: currentTheme.background,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          zIndex: 10,
        }}>
          <Loader2
            size={32}
            strokeWidth={2}
            style={{
              color: currentTheme.ui?.accent || '#89b4fa',
              animation: 'spin 1s linear infinite',
            }}
          />
          <div style={{
            fontSize: '14px',
            color: currentTheme.ui?.textSecondary || '#6c7086',
          }}>
            {t('connecting')}
          </div>
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      <div
        ref={terminalRef}
        onClick={handleTerminalClick}
        tabIndex={-1}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'auto',
          backgroundColor: currentTheme.background,
          cursor: 'text',
          boxSizing: 'border-box',
          opacity: isReady ? 1 : 0,
          transition: 'opacity 0.2s ease',
          caretColor: 'transparent', // iOS 네이티브 커서 숨김
          outline: 'none', // 포커스 아웃라인 숨김
        }}
      />
    </>
  );
};

export default memo(TerminalComponent);
