/**
 * Terminal 컴포넌트
 * xterm.js 기반 터미널 에뮬레이터 (테마 및 스마트 스크롤 지원)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
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

    // 로딩 상태로 설정
    setIsReady(false);

    // xterm.js 인스턴스 생성
    const term = new Terminal({
      theme: currentTheme,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true,
      screenReaderMode: false,
      smoothScrollDuration: settings.smoothScroll ? 50 : 0,
      disableStdin: false, // 키보드 입력 활성화
      windowOptions: {
        setWinLines: true,
      },
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

    // WebSocket 연결 (터미널 크기를 쿼리 파라미터로 전달)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host || 'localhost:8000';
    const wsUrl = `${protocol}//${wsHost}/ws/${sessionId}?cols=${term.cols}&rows=${term.rows}`;

    console.log('WebSocket 연결 시도:', wsUrl, `(${term.cols}x${term.rows})`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket 연결됨:', sessionId);

      // 메시지 출력 전에 터미널 크기 재조정
      try {
        fitAddon.fit();
      } catch (err) {
        console.error('Fit error on connect:', err);
      }

      // 터미널 준비 완료
      setIsReady(true);

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
      // 서버로부터 데이터 수신 → 터미널에 출력
      term.write(event.data);

      // 스마트 스크롤 처리
      handleNewData();
    };

    ws.onerror = (error) => {
      console.error('WebSocket 에러:', error);
      term.writeln(`\x1b[1;31m✗ ${t('connectionError')}\x1b[0m`);
    };

    ws.onclose = () => {
      console.log('WebSocket 연결 종료');
      term.writeln(`\x1b[1;33m⚠ ${t('disconnected')}\x1b[0m`);
    };

    // 사용자 입력 → WebSocket으로 전송
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
      if (onSendData) {
        onSendData(data);
      }
    });

    // window resize는 제거 (ResizeObserver로 통일)

    // 사용자 스크롤 감지 (스마트 스크롤용)
    const container = terminalRef.current;
    if (container) {
      container.addEventListener('scroll', handleUserScroll);
    }

    // 정리
    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (container) {
        container.removeEventListener('scroll', handleUserScroll);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
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

  // 활성 상태 변경 시 커서 깜빡임 제어
  useEffect(() => {
    if (!xtermRef.current) return;

    const term = xtermRef.current;
    term.options.cursorBlink = isActive;
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
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}>
          <div style={{
            fontSize: '14px',
            color: currentTheme.ui?.textSecondary || '#6c7086',
          }}>
            {t('connecting')}
          </div>
        </div>
      )}

      <div
        ref={terminalRef}
        onClick={handleTerminalClick}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: currentTheme.background,
          cursor: 'text',
          boxSizing: 'border-box',
          opacity: isReady ? 1 : 0,
          transition: 'opacity 0.2s ease',
          caretColor: 'transparent', // iOS 네이티브 커서 숨김
        }}
      />
    </>
  );
};

export default TerminalComponent;
