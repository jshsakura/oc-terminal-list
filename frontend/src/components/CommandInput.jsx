/**
 * CommandInput 컴포넌트
 * 모바일에서 한글 입력을 위한 별도 입력창
 * 자소 분리 문제 해결을 위해 일반 textarea 사용
 */
import { useState, useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';

const CommandInput = ({ isOpen, onClose, onSend, theme, t }) => {
  const [command, setCommand] = useState('');
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
            color: currentTheme.ui.fg,
          }}>
            {t?.('commandInput') || '명령어 입력'}
          </h3>
          <button
            onClick={onClose}
            style={{
              ...styles.closeButton,
              color: currentTheme.ui.fgMuted,
            }}
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
            style={{
              ...styles.textarea,
              backgroundColor: currentTheme.ui.bgSecondary,
              color: currentTheme.ui.fg,
              borderColor: currentTheme.ui.border,
            }}
            autoFocus
          />
          <div style={{
            ...styles.hint,
            color: currentTheme.ui.fgMuted,
          }}>
            {t?.('commandInputHint') || '💡 Enter로 줄바꿈, Ctrl+Enter로 전송'}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          ...styles.footer,
          borderTopColor: currentTheme.ui.border,
        }}>
          <button
            onClick={onClose}
            style={{
              ...styles.button,
              ...styles.cancelButton,
              backgroundColor: currentTheme.ui.bgSecondary,
              color: currentTheme.ui.fg,
            }}
          >
            {t?.('cancel') || '취소'}
          </button>
          <button
            onClick={handleSend}
            disabled={!command.trim()}
            style={{
              ...styles.button,
              ...styles.sendButton,
              backgroundColor: command.trim() ? currentTheme.ui.accent : currentTheme.ui.bgTertiary,
              color: command.trim() ? currentTheme.ui.bg : currentTheme.ui.fgMuted,
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
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
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
  },
  body: {
    flex: 1,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
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
  hint: {
    fontSize: '12px',
    fontStyle: 'italic',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    padding: '16px',
    borderTop: '1px solid',
  },
  button: {
    flex: 1,
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'opacity 0.2s',
  },
  cancelButton: {
    flex: '0 0 auto',
    minWidth: '80px',
  },
  sendButton: {
    flex: 1,
  },
};

export default CommandInput;
