import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste, MessageSquare, Eraser } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * 모바일 (iOS) 전용 고밀도 키 툴바.
 * Zed 톤에 맞춰 헤어라인 보더 카드, 토글 키는 액센트 활성 상태로 표시.
 */
const MobileToolbar = ({ onSendKey, onOpenCommandInput, language = 'en' }) => {
  const { t } = useTranslation(language);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const scrollRef = useRef(null);

  const sendWithModifiers = (key) => {
    let finalKey = key;
    if (ctrlActive) {
      if (key >= 'a' && key <= 'z') finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      else if (key === '[' || key === ']') finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      setCtrlActive(false);
    }
    if (altActive) {
      finalKey = '\x1b' + finalKey;
      setAltActive(false);
    }
    onSendKey(finalKey);
  };

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll::-webkit-scrollbar { display: none; }
        .mt-key:active {
          background: ${color.surface1} !important;
          transform: translateY(0.5px);
        }
        .mt-key.is-toggle-active {
          background: ${color.accentSubtle} !important;
          color: ${color.accent} !important;
          border-color: ${color.accentBorder} !important;
        }
      `}</style>

      <div style={styles.toolbar}>
        <div ref={scrollRef} className="mobile-toolbar-scroll" style={styles.scroll}>
          <div style={styles.row}>
            <Key onClick={() => onOpenCommandInput?.()} accent title={t('commandInput')}>
              <MessageSquare size={13} strokeWidth={2} />
            </Key>

            <Divider />

            <Key onMouseDown={(e) => { e.preventDefault(); onSendKey('\x1b[D'); }}><ArrowLeft size={13} strokeWidth={2} /></Key>
            <Key onMouseDown={(e) => { e.preventDefault(); onSendKey('\x1b[A'); }}><ArrowUp size={13} strokeWidth={2} /></Key>
            <Key onMouseDown={(e) => { e.preventDefault(); onSendKey('\x1b[B'); }}><ArrowDown size={13} strokeWidth={2} /></Key>
            <Key onMouseDown={(e) => { e.preventDefault(); onSendKey('\x1b[C'); }}><ArrowRight size={13} strokeWidth={2} /></Key>

            <Divider />

            <Key onClick={() => sendWithModifiers('\x1b')}>ESC</Key>
            <Key onClick={() => sendWithModifiers('\t')}>TAB</Key>
            <Key onClick={() => onSendKey('\x03')} danger>^C</Key>

            <Divider />

            <Key onClick={() => setCtrlActive(!ctrlActive)} active={ctrlActive}>CTRL</Key>
            <Key onClick={() => setAltActive(!altActive)} active={altActive}>ALT</Key>

            <Divider />

            <Key onClick={() => { const t = prompt('Paste:'); if (t) onSendKey(t); }}>
              <ClipboardPaste size={13} strokeWidth={2} />
            </Key>
            <Key onClick={() => onSendKey('\x15')} muted>
              <Eraser size={13} strokeWidth={2} />
            </Key>
          </div>
        </div>
      </div>
    </>
  );
};

const Key = ({ children, onClick, onMouseDown, active, accent, danger, muted, title }) => {
  const tone = danger
    ? { background: 'transparent', color: color.danger, borderColor: `${color.danger}33` }
    : accent
      ? { background: color.accentSubtle, color: color.accent, borderColor: color.accentBorder }
      : { background: color.surface0, color: color.text, borderColor: color.border };

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={`mt-key ${active ? 'is-toggle-active' : ''}`}
      style={{
        ...styles.key,
        ...tone,
        opacity: muted ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
};

const Divider = () => <div style={styles.divider} />;

const styles = {
  toolbar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    height: 'calc(34px + env(safe-area-inset-bottom, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 2px)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    background: color.mantle,
    borderTop: `1px solid ${color.border}`,
    fontFamily: font.sans,
  },
  scroll: {
    flex: 1,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    padding: `0 ${space['2']}`,
    display: 'flex',
    alignItems: 'center',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    paddingRight: space['5'],
  },
  key: {
    flexShrink: 0,
    height: '24px',
    padding: `0 ${space['2']}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: radius.xs,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  divider: {
    width: '1px',
    height: '14px',
    background: color.border,
    margin: `0 ${space['1']}`,
    flexShrink: 0,
  },
};

export default MobileToolbar;
