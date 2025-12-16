/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS)에서 ESC, Tab, 방향키 등 특수키 입력 지원
 */
import { useRef, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste, Eraser, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import useVisualViewport from '../hooks/useVisualViewport';

const MobileToolbar = ({ onSendKey, isVisible, onClose, activeSessionId, onOpenCommandInput }) => {
  const toolbarRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [activeButton, setActiveButton] = useState(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Visual Viewport로 키보드 위에 툴바 고정
  useVisualViewport(toolbarRef);

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
        {/* Command Input (한글 입력) */}
        <button
          onTouchStart={() => setActiveButton('cmd')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('cmd', () => onOpenCommandInput?.());
          }}
          style={{
            ...styles.button,
            ...styles.primary,
            transform: activeButton === 'cmd' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'cmd' ? 0.7 : 1,
          }}
          title="명령어 입력 (한글 지원)"
        >
          <MessageSquare size={13} strokeWidth={2} />
        </button>

        {/* ESC */}
        <button
          onTouchStart={() => setActiveButton('esc')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('esc', () => onSendKey('\x1b'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'esc' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'esc' ? 0.7 : 1,
          }}
        >
          ESC
        </button>

        {/* TAB */}
        <button
          onTouchStart={() => setActiveButton('tab')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('tab', () => onSendKey('\t'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'tab' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'tab' ? 0.7 : 1,
          }}
        >
          TAB
        </button>

        {/* Ctrl+C */}
        <button
          onTouchStart={() => setActiveButton('ctrlc')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('ctrlc', () => onSendKey('\x03'));
          }}
          style={{
            ...styles.button,
            ...styles.warning,
            transform: activeButton === 'ctrlc' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'ctrlc' ? 0.7 : 1,
          }}
          title="Ctrl+C (Stop)"
        >
          ^C
        </button>

        {/* Arrow Keys (상하좌우 순) */}
        {/* Arrow Up */}
        <button
          onTouchStart={() => setActiveButton('up')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('up', () => onSendKey('\x1b[A'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'up' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'up' ? 0.7 : 1,
          }}
        >
          <ArrowUp size={13} strokeWidth={2} />
        </button>

        {/* Arrow Down */}
        <button
          onTouchStart={() => setActiveButton('down')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('down', () => onSendKey('\x1b[B'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'down' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'down' ? 0.7 : 1,
          }}
        >
          <ArrowDown size={13} strokeWidth={2} />
        </button>

        {/* Arrow Left */}
        <button
          onTouchStart={() => setActiveButton('left')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('left', () => onSendKey('\x1b[D'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'left' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'left' ? 0.7 : 1,
          }}
        >
          <ArrowLeft size={13} strokeWidth={2} />
        </button>

        {/* Arrow Right */}
        <button
          onTouchStart={() => setActiveButton('right')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('right', () => onSendKey('\x1b[C'));
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'right' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'right' ? 0.7 : 1,
          }}
        >
          <ArrowRight size={13} strokeWidth={2} />
        </button>

        {/* Paste */}
        <button
          onTouchStart={() => setActiveButton('paste')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('paste', handlePaste);
          }}
          style={{
            ...styles.button,
            ...styles.secondary,
            transform: activeButton === 'paste' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'paste' ? 0.7 : 1,
          }}
        >
          <ClipboardPaste size={13} strokeWidth={2} />
        </button>

        {/* Clear (맨 우측) */}
        <button
          onTouchStart={() => setActiveButton('clear')}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleButtonPress('clear', handleClear);
          }}
          style={{
            ...styles.button,
            ...styles.clear,
            transform: activeButton === 'clear' ? 'scale(0.9)' : 'scale(1)',
            opacity: activeButton === 'clear' ? 0.7 : 1,
          }}
          title="Clear current line (Ctrl+U)"
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
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    padding: '4px',
    zIndex: 9999,
    transition: 'transform 0.2s ease, opacity 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  scrollContainer: {
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    scrollSnapType: 'x proximity',
    display: 'flex',
    justifyContent: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: 'clamp(3px, 1vw, 6px)',
    alignItems: 'center',
    flexWrap: 'nowrap',
    padding: '0 4px',
  },
  scrollButton: {
    flexShrink: 0,
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(24, 24, 37, 0.95)',
    backdropFilter: 'blur(8px)',
    border: 'none',
    borderRadius: '6px',
    color: '#cdd6f4',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
    transition: 'all 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  button: {
    flex: '0 0 auto',
    padding: 'clamp(4px, 1.5vw, 6px) clamp(6px, 2vw, 10px)',
    fontSize: 'clamp(9px, 2.5vw, 11px)',
    fontWeight: '500',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
    minWidth: 'clamp(26px, 8vw, 32px)',
    minHeight: 'clamp(26px, 8vw, 32px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
    willChange: 'transform, opacity',
    scrollSnapAlign: 'start',
  },
  primary: {
    backgroundColor: '#89b4fa',
    color: '#1e1e2e',
  },
  secondary: {
    backgroundColor: '#313244',
    color: '#cdd6f4',
  },
  danger: {
    backgroundColor: '#f38ba8',
    color: '#1e1e2e',
  },
  warning: {
    backgroundColor: '#fab387',
    color: '#1e1e2e',
  },
  clear: {
    backgroundColor: '#94e2d5',
    color: '#1e1e2e',
  },
};

export default MobileToolbar;
