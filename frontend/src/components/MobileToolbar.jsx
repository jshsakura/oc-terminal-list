/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS)에서 ESC, Tab, 방향키 등 특수키 입력 지원
 */
import { useRef, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste, Eraser, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import useVisualViewport from '../hooks/useVisualViewport';
import useTranslation from '../hooks/useTranslation';

const MobileToolbar = ({ onSendKey, isVisible, onClose, activeSessionId, onOpenCommandInput, language = 'en' }) => {
  const { t } = useTranslation(language);
  const toolbarRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [activeButton, setActiveButton] = useState(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Ctrl, Alt 토글 상태 관리
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Visual Viewport로 키보드 위에 툴바 고정
  useVisualViewport(toolbarRef);

  // 키 전송 로직 개선 (Ctrl/Alt 조합 지원)
  const handleKeyWithModifiers = (key) => {
    let finalKey = key;

    // Ctrl 조합 처리
    if (ctrlActive) {
      // 대문자 A-Z 대응 (ASCII 1-26)
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      }
      setCtrlActive(false); // 전송 후 해제 (Sticky)
    }

    // Alt 조합 처리 (ESC + key)
    if (altActive) {
      finalKey = '\x1b' + finalKey;
      setAltActive(false); // 전송 후 해제 (Sticky)
    }

    onSendKey(finalKey);
  };

  // 스크롤 위치 체크
  const checkScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setShowLeftScroll(scrollLeft > 10);
    setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, []);

  useEffect(() => {
    // 화면 크기 변경 시 스크롤 체크
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 좌우 스크롤
  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -150, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 150, behavior: 'smooth' });
    }
  };

  // 클립보드 붙여넣기
  const handlePaste = () => {
    // iOS에서는 prompt로 입력받기 (clipboard API가 제한적)
    const text = prompt('Paste text here:');
    if (text && onSendKey) {
      onSendKey(text);
    }
  };

  // 현재 라인 클리어
  const handleClear = () => {
    if (onSendKey) {
      onSendKey('\x15'); // Ctrl+U: 현재 라인 클리어
    }
  };

  // 버튼 클릭 효과
  const handleButtonPress = (key, action) => {
    setActiveButton(key);
    action();
    setTimeout(() => setActiveButton(null), 150);
  };

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div
        ref={toolbarRef}
        style={{
          ...styles.toolbar,
          transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
          opacity: isVisible ? 1 : 0,
        }}
      >
        {/* 왼쪽 스크롤 버튼 */}
        {showLeftScroll && (
          <button
            onClick={handleScrollLeft}
            style={styles.scrollButton}
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
        )}

        <div
          ref={scrollContainerRef}
          className="mobile-toolbar-scroll"
          style={styles.scrollContainer}
          onScroll={checkScroll}
        >
          <div style={styles.buttonGroup}>
            {/* Ctrl (Sticky Toggle) */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                setCtrlActive(!ctrlActive);
              }}
              style={{
                ...styles.button,
                ...(ctrlActive ? styles.active : styles.secondary),
              }}
              title="CTRL (Sticky)"
            >
              CTRL
            </button>

            {/* Alt (Sticky Toggle) */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                setAltActive(!altActive);
              }}
              style={{
                ...styles.button,
                ...(altActive ? styles.active : styles.secondary),
              }}
              title="ALT (Sticky)"
            >
              ALT
            </button>

            {/* Command Input (한글 입력) */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('cmd', () => onOpenCommandInput?.());
              }}
              style={{
                ...styles.button,
                ...styles.primary,
                transform: activeButton === 'cmd' ? 'scale(0.9)' : 'scale(1)',
              }}
              title={t('commandInput')}
            >
              <MessageSquare size={13} strokeWidth={2} />
            </button>

            {/* ESC */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('esc', () => handleKeyWithModifiers('\x1b'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'esc' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              ESC
            </button>

            {/* TAB */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('tab', () => handleKeyWithModifiers('\t'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'tab' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              TAB
            </button>

            {/* Ctrl+C (직통) */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('ctrlc', () => onSendKey('\x03'));
              }}
              style={{
                ...styles.button,
                ...styles.warning,
                transform: activeButton === 'ctrlc' ? 'scale(0.9)' : 'scale(1)',
              }}
              title="Ctrl+C (Stop)"
            >
              ^C
            </button>

            {/* Arrow Keys */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('up', () => handleKeyWithModifiers('\x1b[A'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'up' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              <ArrowUp size={13} strokeWidth={2} />
            </button>

            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('down', () => handleKeyWithModifiers('\x1b[B'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'down' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              <ArrowDown size={13} strokeWidth={2} />
            </button>

            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('left', () => handleKeyWithModifiers('\x1b[D'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'left' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              <ArrowLeft size={13} strokeWidth={2} />
            </button>

            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('right', () => handleKeyWithModifiers('\x1b[C'));
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'right' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              <ArrowRight size={13} strokeWidth={2} />
            </button>

            {/* Paste */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('paste', handlePaste);
              }}
              style={{
                ...styles.button,
                ...styles.secondary,
                transform: activeButton === 'paste' ? 'scale(0.9)' : 'scale(1)',
              }}
            >
              <ClipboardPaste size={13} strokeWidth={2} />
            </button>

            {/* Clear */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                handleButtonPress('clear', handleClear);
              }}
              style={{
                ...styles.button,
                ...styles.clear,
                transform: activeButton === 'clear' ? 'scale(0.9)' : 'scale(1)',
              }}
              title={t('clearInput')}
            >
              <Eraser size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 오른쪽 스크롤 버튼 */}
        {showRightScroll && (
          <button
            onClick={handleScrollRight}
            style={styles.scrollButton}
            aria-label="Scroll right"
          >
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </>
  );
};

const styles = {
  toolbar: {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: '12px',
    backgroundColor: 'rgba(24, 24, 37, 0.6)',
    backdropFilter: 'blur(20px) saturate(160%)',
    padding: '6px',
    zIndex: 9999,
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    borderRadius: '20px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  },
  scrollContainer: {
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    display: 'flex',
    justifyContent: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'nowrap',
    padding: '0 4px',
  },
  scrollButton: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: 'none',
    borderRadius: '14px',
    color: '#cdd6f4',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  button: {
    flex: '0 0 auto',
    padding: '0 10px',
    fontSize: '11px',
    fontWeight: '700',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    minWidth: '34px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    willChange: 'transform, opacity',
  },
  primary: {
    backgroundColor: '#89b4fa',
    color: '#1e1e2e',
  },
  secondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#cdd6f4',
  },
  active: {
    backgroundColor: '#f9e2af',
    color: '#1e1e2e',
    boxShadow: '0 0 15px rgba(249, 226, 175, 0.4)',
  },
  danger: {
    backgroundColor: 'rgba(243, 139, 168, 0.2)',
    color: '#f38ba8',
    border: '1px solid rgba(243, 139, 168, 0.3)',
  },
  warning: {
    backgroundColor: 'rgba(250, 179, 135, 0.2)',
    color: '#fab387',
    border: '1px solid rgba(250, 179, 135, 0.3)',
  },
  clear: {
    backgroundColor: 'rgba(148, 226, 213, 0.2)',
    color: '#94e2d5',
    border: '1px solid rgba(148, 226, 213, 0.3)',
  },
};

export default MobileToolbar;
