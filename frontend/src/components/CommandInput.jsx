/**
 * CommandInput 컴포넌트
 * 모바일에서 한글 입력을 위한 별도 입력창
 * 자소 분리 문제 해결을 위해 일반 textarea 사용
 */
import { useEffect, useRef } from 'react';
import { Send, X, Eraser, ClipboardPaste } from 'lucide-react';
import Button from './common/Button';

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
          color: ${currentTheme.ui.textSecondary};
          opacity: 0.5;
        }
      `}</style>

      {/* Modal */}
      <div style={{
        ...styles.modal,
        backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bg,
        backdropFilter: 'blur(20px) saturate(180%)',
        borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
        borderRadius: currentTheme.ui.radius,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          ...styles.header,
          borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border,
        }}>
          <h3 style={{
            ...styles.title,
            color: currentTheme.ui.accent,
          }}>
            {t?.('commandInput') || '명령어 입력'}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose} theme={currentTheme} icon={X} />
        </div>

        {/* Input Area */}
        <div style={styles.body}>
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t?.('commandInputPlaceholder')}
            className="command-input-textarea"
            style={{
              ...styles.textarea,
              backgroundColor: currentTheme.ui.cardBg || currentTheme.ui.bgSecondary,
              color: currentTheme.ui.text,
              borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
              borderRadius: currentTheme.ui.radiusSmall,
            }}
            autoFocus
          />
          <div style={{ marginTop: '8px', fontSize: '11px', color: currentTheme.ui.textSecondary, textAlign: 'center' }}>
            {t?.('commandInputHint')}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          ...styles.footer,
          borderTopColor: currentTheme.ui.borderLight || currentTheme.ui.border,
        }}>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handlePaste} 
            theme={currentTheme} 
            icon={ClipboardPaste} 
            title={t?.('paste')}
          />
          
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleClear} 
            disabled={!command.trim()}
            theme={currentTheme} 
            style={{ color: command.trim() ? currentTheme.red : currentTheme.ui.textSecondary }}
            icon={Eraser} 
            title={t?.('clearInput')}
          />

          <Button 
            variant="primary" 
            fullWidth
            onClick={handleSend} 
            disabled={!command.trim()}
            theme={currentTheme} 
            icon={Send}
          >
            {t?.('send')}
          </Button>
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
    backdropFilter: 'blur(8px)',
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '80vh',
    zIndex: 10001,
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  body: {
    flex: 1,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  textarea: {
    width: '100%',
    minHeight: '150px',
    maxHeight: '300px',
    padding: '14px',
    fontSize: '14px',
    fontFamily: '"JetBrains Mono", monospace',
    border: '1px solid',
    resize: 'vertical',
    outline: 'none',
    lineHeight: '1.6',
  },
  footer: {
    display: 'flex',
    gap: '10px',
    padding: '12px 20px',
    borderTop: '1px solid',
  },
};

export default CommandInput;
