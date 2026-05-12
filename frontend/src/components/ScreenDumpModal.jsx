import { useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow } = tokens;

/**
 * 터미널 스크롤백 전체 텍스트 덤프 — 모바일/데스크톱 모두 자유 선택 + 복사 가능.
 * `text` 가 falsy 면 모달 닫힘.
 */
const ScreenDumpModal = ({ text, onClose, t }) => {
  const taRef = useRef(null);

  useEffect(() => {
    if (!text) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text, onClose]);

  // auto-select 제거 — 사용자가 원하는 부분만 직접 선택해 복사하도록 함.
  // (전체 복사가 필요하면 footer 의 "Copy all" 버튼.)

  if (!text) return null;

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      taRef.current?.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
    }
  };

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div className="iterm-modal-card" style={styles.modal} role="dialog" aria-modal="true">
        <header style={styles.header}>
          <div style={styles.title}>{t?.('screenDump') || 'Terminal text'}</div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          <textarea
            ref={taRef}
            readOnly
            value={text}
            style={styles.textarea}
          />
          <div style={styles.hint}>
            {t?.('screenDumpHint') || 'Free select & copy any portion. ESC to close.'}
          </div>
        </div>

        <footer style={styles.footer}>
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={handleCopyAll} icon={Copy}>
            {t?.('copyAll') || 'Copy all'}
          </Button>
        </footer>
      </div>
    </>
  );
};

const styles = {
  backdrop: {
    position: 'absolute', inset: 0, background: color.scrim, zIndex: 10000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '98%', maxWidth: '1100px',
    height: '96%',
    maxHeight: '96%',
    zIndex: 10001,
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    fontFamily: font.sans,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: color.muted, border: 'none',
    borderRadius: radius.xs, cursor: 'pointer',
  },
  body: {
    flex: 1, padding: `${space['3']} ${space['4']}`,
    display: 'flex', flexDirection: 'column', gap: space['2'],
    minHeight: 0,
  },
  textarea: {
    flex: 1,
    minHeight: '420px',  /* 작은 화면 보호용 — 모달 height 90vh 라 보통 더 큼 */
    padding: `${space['3']}`,
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    lineHeight: 1.5,
    outline: 'none',
    resize: 'none',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    overflow: 'auto',
  },
  hint: {
    fontSize: fontSize['11'],
    color: color.muted,
    textAlign: 'center',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: space['2'],
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default ScreenDumpModal;
