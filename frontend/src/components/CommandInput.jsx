/**
 * CommandInput 컴포넌트
 * 모바일에서 한글 입력을 위한 별도 입력창
 * 자소 분리 문제 해결을 위해 일반 textarea 사용
 */
import { useEffect, useRef } from 'react';
import { Send, X, Eraser, ClipboardPaste } from 'lucide-react';

const CommandInput = ({ isOpen, onClose, onSend, command, setCommand, theme, t }) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      // 모달이 열리면 입력창에 포커스
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleSend = () => {
    if (command.trim()) {
      onSend(command);
      setCommand('');
      onClose();
    }
  };

  const handleClear = () => {
    const confirmMessage = t?.('confirmClearInput') || '입력한 내용을 모두 지우시겠습니까?';
    if (command.trim() && !confirm(confirmMessage)) {
      return;
    }
    setCommand('');
    textareaRef.current?.focus();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCommand(command + text);
      textareaRef.current?.focus();
    } catch (err) {
      // Clipboard API 실패 시 prompt 사용
      const text = prompt(t?.('paste') || '붙여넣을 텍스트:');
      if (text) {
        setCommand(command + text);
        textareaRef.current?.focus();
      }
    }
  };

  const handleKeyDown = (e) => {
    // Ctrl+Enter 또는 Cmd+Enter로 전송
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
    // ESC로 닫기
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const currentTheme = theme;

  return (
    <>
      {/* Backdrop */}
      <div
        style={styles.backdrop}
        onClick={onClose}
      />

      {/* Placeholder 스타일 */}
      <style>{`
        .command-input-textarea::placeholder {
          color: ${currentTheme.foreground || currentTheme.white || '#a6adc8'};
          opacity: 0.5;
        }
      `}</style>

      {/* Modal */}
      <div style={{
        ...styles.modal,
        backgroundColor: currentTheme.ui.bg,
        borderColor: currentTheme.ui.border,
      }}>
        {/* Header */}
        <div style={{
          ...styles.header,
          borderBottomColor: currentTheme.ui.border,
        }}>
          <h3 style={{
            ...styles.title,
            color: currentTheme.foreground || currentTheme.ui.fg || '#cdd6f4',
          }}>
            {t?.('commandInput') || '명령어 입력'}
          </h3>
          <button
            onClick={onClose}
            style={{
              ...styles.closeButton,
              color: currentTheme.foreground || currentTheme.white || '#bac2de',
            }}
            title={t?.('close') || '닫기'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Input Area */}
        <div style={styles.body}>
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t?.('commandInputPlaceholder') || '명령어를 입력하세요... (Ctrl+Enter로 전송)'}
            className="command-input-textarea"
            style={{
              ...styles.textarea,
              backgroundColor: currentTheme.ui.bgSecondary,
              color: currentTheme.foreground || currentTheme.white || '#cdd6f4',
              borderColor: currentTheme.ui.border,
            }}
            autoFocus
          />
        </div>

        {/* Footer */}
        <div style={{
          ...styles.footer,
          borderTopColor: currentTheme.ui.border,
        }}>
          <button
            onClick={handlePaste}
            style={{
              ...styles.clearButton,
              backgroundColor: currentTheme.ui.bgTertiary,
              color: currentTheme.foreground || currentTheme.white || '#cdd6f4',
              opacity: 1,
            }}
            title={t?.('paste') || '붙여넣기'}
          >
            <ClipboardPaste size={16} />
          </button>
          <button
            onClick={handleClear}
            disabled={!command.trim()}
            style={{
              ...styles.clearButton,
              backgroundColor: command.trim() ? (currentTheme.cyan || currentTheme.teal || '#94e2d5') : currentTheme.ui.bgSecondary,
              color: command.trim() ? '#1e1e2e' : (currentTheme.brightBlack || '#6c7086'),
              opacity: command.trim() ? 1 : 0.5,
            }}
            title={t?.('clearInput') || '내용 지우기'}
          >
            <Eraser size={16} />
          </button>
          <button
            onClick={handleSend}
            disabled={!command.trim()}
            style={{
              ...styles.sendButton,
              backgroundColor: command.trim() ? currentTheme.ui.accent : currentTheme.ui.bgSecondary,
              color: command.trim() ? '#ffffff' : (currentTheme.brightBlack || '#6c7086'),
              opacity: command.trim() ? 1 : 0.5,
            }}
          >
            <Send size={14} />
            <span>{t?.('send') || '전송'}</span>
          </button>
        </div>
      </div>
    </>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 10000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '80vh',
    borderRadius: '8px',
    border: '1px solid',
    zIndex: 10001,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.2s',
  },
  body: {
    flex: 1,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  textarea: {
    width: '100%',
    minHeight: '150px',
    maxHeight: '300px',
    padding: '12px',
    fontSize: '14px',
    fontFamily: 'monospace',
    border: '1px solid',
    borderRadius: '4px',
    resize: 'vertical',
    outline: 'none',
    lineHeight: '1.5',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    padding: '16px',
    borderTop: '1px solid',
  },
  clearButton: {
    padding: '10px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    minWidth: '44px',
    minHeight: '44px',
  },
  sendButton: {
    flex: 1,
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  },
};

export default CommandInput;
