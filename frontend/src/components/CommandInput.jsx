import { useEffect, useRef } from 'react';
import { Send, X, Eraser, ClipboardPaste } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

/**
 * 모바일에서 한글 IME 자소 분리 문제를 우회하기 위한 별도 입력창.
 * Ctrl+Enter / Cmd+Enter 로 전송, ESC 로 닫기.
 */
const CommandInput = ({ isOpen, onClose, onSend, command, setCommand, t }) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const id = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (command.trim()) {
      onSend(command);
      setCommand('');
      onClose();
    }
  };

  const handleClear = () => {
    if (command.trim() && !confirm(t?.('confirmClearInput') || '입력한 내용을 모두 지우시겠습니까?')) return;
    setCommand('');
    textareaRef.current?.focus();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCommand(command + text);
      textareaRef.current?.focus();
    } catch {
      const text = prompt(t?.('paste') || '붙여넣을 텍스트:');
      if (text) {
        setCommand(command + text);
        textareaRef.current?.focus();
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <style>{`.command-input-textarea::placeholder { color: ${color.muted}; }`}</style>

      <div style={styles.modal}>
        <header style={styles.header}>
          <div style={styles.title}>{t?.('commandInput') || 'Send command'}</div>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} strokeWidth={2} /></button>
        </header>

        <div style={styles.body}>
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t?.('commandInputPlaceholder')}
            className="command-input-textarea"
            style={styles.textarea}
            autoFocus
          />
          <div style={styles.hint}>
            {t?.('commandInputHint') || 'Ctrl+Enter to send · ESC to close'}
          </div>
        </div>

        <footer style={styles.footer}>
          <Button variant="ghost" size="icon" onClick={handlePaste} icon={ClipboardPaste} title={t?.('paste')} />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={!command.trim()}
            icon={Eraser}
            title={t?.('clearInput')}
          />
          <div style={{ flex: 1 }} />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!command.trim()}
            icon={Send}
          >
            {t?.('send') || 'Send'}
          </Button>
        </footer>
      </div>
    </>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: color.scrim,
    zIndex: 10000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '92%',
    maxWidth: '480px',
    maxHeight: '80vh',
    zIndex: 10001,
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    fontFamily: font.sans,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.muted,
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
  },
  body: {
    flex: 1,
    padding: `${space['3']} ${space['4']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    overflow: 'auto',
  },
  textarea: {
    width: '100%',
    minHeight: '140px',
    maxHeight: '320px',
    padding: `${space['3']} ${space['3']}`,
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: font.mono,
    lineHeight: 1.55,
    outline: 'none',
    resize: 'vertical',
    transition: `border-color ${motion.fast}`,
  },
  hint: {
    fontSize: fontSize['11'],
    color: color.muted,
    textAlign: 'center',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default CommandInput;
