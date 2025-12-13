/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS)에서 ESC, Tab, 방향키 등 특수키 입력 지원
 */
import { useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronsDown, ClipboardPaste, Eraser } from 'lucide-react';
import useVisualViewport from '../hooks/useVisualViewport';

const MobileToolbar = ({ onSendKey, isVisible, onClose, activeSessionId }) => {
  const toolbarRef = useRef(null);

  // Visual Viewport로 키보드 위에 툴바 고정
  useVisualViewport(toolbarRef);

  // 맨 아래로 스크롤
  const handleScrollToBottom = () => {
    if (window.terminalSessions && activeSessionId && window.terminalSessions[activeSessionId]) {
      window.terminalSessions[activeSessionId].scrollToBottom();
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

  return (
    <div
      ref={toolbarRef}
      style={{
        ...styles.toolbar,
        transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div style={styles.buttonGroup}>
        {/* ESC (맨 좌측) */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x1b');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          ESC
        </button>

        {/* TAB */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\t');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          TAB
        </button>

        {/* Ctrl+C */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x03');
          }}
          style={{ ...styles.button, ...styles.warning }}
          title="Ctrl+C (Stop)"
        >
          ^C
        </button>

        {/* Arrow Up */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x1b[A');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          <ArrowUp size={13} strokeWidth={2} />
        </button>

        {/* Arrow Down */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x1b[B');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          <ArrowDown size={13} strokeWidth={2} />
        </button>

        {/* Arrow Left */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x1b[D');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          <ArrowLeft size={13} strokeWidth={2} />
        </button>

        {/* Arrow Right */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            onSendKey('\x1b[C');
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          <ArrowRight size={13} strokeWidth={2} />
        </button>

        {/* Scroll to Bottom */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            handleScrollToBottom();
          }}
          style={{ ...styles.button, ...styles.secondary }}
          title="Scroll to bottom"
        >
          <ChevronsDown size={13} strokeWidth={2} />
        </button>

        {/* Paste */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            handlePaste();
          }}
          style={{ ...styles.button, ...styles.secondary }}
        >
          <ClipboardPaste size={13} strokeWidth={2} />
        </button>

        {/* Clear (맨 우측) */}
        <button
          onTouchEnd={(e) => {
            e.preventDefault();
            handleClear();
          }}
          style={{ ...styles.button, ...styles.clear }}
          title="Clear current line (Ctrl+U)"
        >
          <Eraser size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};

const styles = {
  toolbar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#181825',
    borderTop: '1px solid #313244',
    padding: '6px',
    zIndex: 9999,
    transition: 'transform 0.2s ease, opacity 0.2s ease',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
  },
  buttonGroup: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 'max-content',
    margin: '0 auto',
  },
  button: {
    flex: '0 0 auto',
    padding: '5px 8px',
    fontSize: '10px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'opacity 0.15s ease',
    minWidth: '28px',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
