import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, X, Eraser, ClipboardPaste, Copy } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// 키보드 위에 살짝 띄우는 여백 — 입력창이 키보드 / suggestion bar 와 딱 붙지 않게.
const MOBILE_BOTTOM_GAP = 8;
// 모달과 가시 영역 상단 사이 최소 간격 — 키보드 + 모달이 화면을 다 차지해도 위로 빈틈이 보이게.
const MOBILE_TOP_GAP = 12;

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
  const modalRef = useRef(null);
  // 가시 영역 (visualViewport) 추적 — 키보드가 올라올 때 모달 상하 위치/높이를 그 안으로 클램프.
  // iOS Safari 는 layout viewport 가 키보드를 무시하기 때문에 absolute/fixed inset:0 만으로는
  // 가운데 정렬이 키보드 밑까지 내려가 입력창 일부가 가려진다.
  const [vv, setVv] = useState(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return { height: typeof window !== 'undefined' ? window.innerHeight : 0, offsetTop: 0 };
    }
    return { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop };
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    const target = window.visualViewport;
    if (!target) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      setVv({ height: target.height, offsetTop: target.offsetTop });
    };
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    target.addEventListener('resize', onChange);
    target.addEventListener('scroll', onChange);
    return () => {
      target.removeEventListener('resize', onChange);
      target.removeEventListener('scroll', onChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isOpen]);

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

  // 모달이 떠있는 동안 포커스가 뒤쪽 xterm/input 으로 빠지면 즉시 되돌린다.
  // xterm 이 상태 변경/클릭 잔상으로 focus() 를 다시 호출하는 타이밍이 있어
  // document focusin + textarea blur 양쪽에서 방어한다.
  useEffect(() => {
    if (!isOpen) return undefined;
    let raf = 0;
    const refocus = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const modal = modalRef.current;
        const active = document.activeElement;
        if (!modal || modal.contains(active)) return;
        focusToEnd(textareaRef.current);
      });
    };
    const handleFocusIn = (e) => {
      if (modalRef.current?.contains(e.target)) return;
      refocus();
    };
    document.addEventListener('focusin', handleFocusIn, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      if (raf) cancelAnimationFrame(raf);
    };
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

  // 가시 영역 안에서만 모달이 보이도록 overlay 를 visualViewport 좌표로 클램프.
  // 키보드가 올라오면 vv.height 가 줄고 vv.offsetTop 이 양수가 될 수 있다.
  // 모달은 가시 영역 *하단* (키보드 suggestion bar 바로 위) 에 붙임 — 사용자 의도는
  // "단축키 바 위에 떠있는 입력 도크" 라 상단에 띄우면 어색하다.
  const keyboardUp = vv.height < window.innerHeight - 60;

  const overlayStyle = {
    ...styles.overlay,
    top: `${vv.offsetTop}px`,
    height: `${vv.height}px`,
    alignItems: keyboardUp ? 'flex-end' : 'center',
    paddingTop: `${MOBILE_TOP_GAP}px`,
    paddingBottom: keyboardUp ? `${MOBILE_BOTTOM_GAP}px` : '0',
    touchAction: 'none',
  };
  const modalStyle = {
    ...styles.modal,
    // 가시 영역 내 위/아래 여백을 빼고 남은 높이만 차지 — 키보드 떠있어도 푸터 버튼 안 잘림.
    maxHeight: `calc(${vv.height}px - ${MOBILE_TOP_GAP + MOBILE_BOTTOM_GAP}px)`,
  };

  return (
    <div
      data-testid="command-input-overlay"
      style={overlayStyle}
      onClick={onClose}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => { e.stopPropagation(); }}
      onTouchMove={blockTouch}
    >
      <style>{`.command-input-textarea::placeholder { color: ${color.muted}; }`}</style>

      <div
        ref={modalRef}
        role="dialog"
        aria-label={t?.('commandInput') || 'Send command'}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={styles.title}>
            <Send size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
            {t?.('commandInput') || 'Send command'}
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          <textarea
            ref={textareaRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              requestAnimationFrame(() => {
                const active = document.activeElement;
                if (!isOpen || modalRef.current?.contains(active)) return;
                focusToEnd(textareaRef.current);
              });
            }}
            placeholder={t?.('commandInputHint') || 'Shift+Enter for new line, Ctrl+Enter to send'}
            className="command-input-textarea"
            style={styles.textarea}
            autoFocus
          />
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
    // position:fixed + visualViewport 좌표 — 키보드가 올라와도 가시 영역 안에서만 그려진다.
    position: 'fixed',
    left: 0,
    right: 0,
    padding: space['3'],
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '90%',
    maxWidth: '420px',
    maxHeight: '80%',
    background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 80%, transparent)`,
    border: `1px solid var(--ui-borderStrong, ${color.borderStrong})`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: `1px solid var(--ui-border, ${color.border})`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 66%, transparent)`,
  },
  title: { fontSize: fontSize['12'], fontWeight: fontWeight.semibold, color: `var(--ui-text, ${color.text})`, display: 'flex', alignItems: 'center', gap: '6px' },
  closeBtn: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 70%, transparent)`,
    color: `var(--ui-subtext, ${color.subtext})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: '7px',
    cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}`,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
  body: {
    flex: 1,
    padding: `${space['2']} ${space['3']}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    background: 'transparent',
  },
  textarea: {
    width: '100%',
    minHeight: '72px',
    maxHeight: '160px',
    padding: `${space['2']} ${space['2']}`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 76%, rgba(0,0,0,0.18))`,
    color: `var(--ui-text, ${color.text})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: font.mono,
    lineHeight: 1.5,
    outline: 'none',
    resize: 'vertical',
    transition: `border-color ${motion.fast}`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid var(--ui-border, ${color.border})`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 66%, transparent)`,
  },
};

export default CommandInput;
