import { useEffect, useLayoutEffect, useRef } from 'react';
import { Send, X, Eraser, ClipboardPaste, Copy } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

// textarea 의 caret 을 항상 텍스트 끝으로 — 다시 열 때, 붙여넣기 후, clear 후 등
// 사용자가 이어서 입력하기 좋은 위치에 두기 위함.
const focusToEnd = (ta) => {
  if (!ta) return;
  ta.focus();
  try {
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    // 멀티라인일 때 caret 위치까지 스크롤되게 강제 reflow 트릭
    ta.scrollTop = ta.scrollHeight;
  } catch { /* setSelectionRange 미지원 환경 무시 */ }
};

/**
 * 모바일에서 한글 IME 자소 분리 문제를 우회하기 위한 별도 입력창.
 * Ctrl+Enter / Cmd+Enter 로 전송, ESC 로 닫기.
 *
 * 입력 보존: command/setCommand 가 부모(App.jsx) state 라 X/ESC/backdrop 으로
 * 닫아도 텍스트는 유지된다. 비우는 건 명시적 "Clear" 또는 "Send" 시에만.
 */
const CommandInput = ({ isOpen, onClose, onSend, command, setCommand, t }) => {
  const textareaRef = useRef(null);

  // 모달이 mount 되는 즉시 caret 을 텍스트 끝으로 두고 focus.
  // useLayoutEffect — paint 직전에 실행돼 사용자가 모달을 본 시점에 이미 커서 위치 완료.
  // setTimeout 100ms 같은 지연을 두면 iOS Safari 가 user gesture 컨텍스트를 잃어
  // 키보드가 자동으로 안 올라오는 사고가 난다.
  useLayoutEffect(() => {
    if (!isOpen) return;
    focusToEnd(textareaRef.current);
  }, [isOpen]);

  // 일부 모바일 브라우저는 useLayoutEffect 후에도 keyboard 가 즉시 안 올라오는
  // 케이스가 있어 다음 frame 에 한 번 더 보강. 데스크톱은 이미 끝나서 영향 없음.
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => focusToEnd(textareaRef.current));
    return () => cancelAnimationFrame(raf);
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
    focusToEnd(textareaRef.current);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCommand(command + text);
      // setCommand 후 다음 렌더가 적용되어야 caret 이 새 끝으로 감
      requestAnimationFrame(() => focusToEnd(textareaRef.current));
    } catch {
      const text = prompt(t?.('paste') || '붙여넣을 텍스트:');
      if (text) {
        setCommand(command + text);
        requestAnimationFrame(() => focusToEnd(textareaRef.current));
      }
    }
  };

  const handleCopy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // 권한/브라우저 fallback — 텍스트 선택 후 execCommand
      const ta = textareaRef.current;
      if (ta) {
        ta.select();
        try { document.execCommand('copy'); } catch { /* 무시 */ }
        focusToEnd(ta);
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

  // 모달 뒤 터미널 등으로 touch drag 가 leak 되지 않도록 overlay 에서 명시 차단.
  // (z-index 만으론 일부 모바일 브라우저에서 touchmove 가 underlying 에 forward 될 수 있음.)
  const blockTouch = (e) => { e.preventDefault(); };
  return (
    <div
      data-testid="command-input-overlay"
      style={{ ...styles.overlay, touchAction: 'none' }}
      onClick={onClose}
      onTouchMove={blockTouch}
    >
      <style>{`.command-input-textarea::placeholder { color: ${color.muted}; }`}</style>

      <div
        role="dialog"
        aria-label={t?.('commandInput') || 'Send command'}
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
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
          {/* 좌측 — 복사/붙여넣기/비우기 (보조 액션 그룹) */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            disabled={!command}
            icon={Copy}
            title={t?.('copy') || 'Copy'}
          />
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
          {/* 우측 — 주 액션 */}
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
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    padding: space['3'],
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '90%',
    maxWidth: '420px',
    maxHeight: '80dvh',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['1.5']} ${space['3']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: { fontSize: fontSize['12'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '20px',
    height: '20px',
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
    padding: `${space['2']} ${space['3']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
    overflow: 'auto',
  },
  textarea: {
    width: '100%',
    minHeight: '72px',
    maxHeight: '160px',
    padding: `${space['2']} ${space['2']}`,
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: font.mono,
    lineHeight: 1.5,
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
    gap: space['1'],
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default CommandInput;
