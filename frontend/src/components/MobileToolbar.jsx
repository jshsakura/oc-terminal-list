import { useRef, useState } from 'react';
import { Command, ClipboardPaste } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { DEFAULT_MOBILE_KEYS, sanitizeMobileKeys } from '../utils/mobileKeys';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * 모바일 (iOS) 전용 고밀도 키 툴바.
 *
 * 키 셋은 settings.mobileKeys 에서 동적으로 읽음 — 사용자가 Settings 에서
 * 자유롭게 추가/삭제/순서 변경. 디폴트는 DEFAULT_MOBILE_KEYS.
 *
 * 위치 전략: App.jsx wrapper 의 flex flow 마지막 child. 키보드 올라오면
 * wrapper 가 줄고 toolbar 도 자연스럽게 따라 올라감.
 */
const MobileToolbar = ({ onSendKey, onOpenCommandInput, language = 'en', keys = null }) => {
  const { t } = useTranslation(language);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const scrollRef = useRef(null);

  const list = sanitizeMobileKeys(keys ?? DEFAULT_MOBILE_KEYS);

  const sendWithModifiers = (key) => {
    let finalKey = key;
    if (ctrlActive) {
      // Ctrl+letter — control char 매핑
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      } else if (key === '[' || key === ']' || key === '\\') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      }
      setCtrlActive(false);
    }
    if (altActive) {
      finalKey = '\x1b' + finalKey;
      setAltActive(false);
    }
    onSendKey?.(finalKey);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onSendKey?.(text);
    } catch {
      const text = prompt(t('paste') || 'Paste:');
      if (text) onSendKey?.(text);
    }
  };

  const renderItem = (k, idx) => {
    if (k.kind === 'sep') return <Divider key={k.id || `sep-${idx}`} />;

    if (k.kind === 'cmdInput') {
      return (
        <Key
          key={k.id}
          tone="accent"
          title={t('commandInput')}
          onClick={() => onOpenCommandInput?.()}
        >
          <Command size={13} strokeWidth={2.2} />
        </Key>
      );
    }

    if (k.kind === 'paste') {
      return (
        <Key key={k.id} title={t('paste')} onClick={handlePaste}>
          <ClipboardPaste size={13} strokeWidth={2.2} />
        </Key>
      );
    }

    if (k.kind === 'mod') {
      const isActive = (k.modifier === 'ctrl' && ctrlActive) || (k.modifier === 'alt' && altActive);
      const toggle = () => {
        if (k.modifier === 'ctrl') setCtrlActive((v) => !v);
        else if (k.modifier === 'alt') setAltActive((v) => !v);
      };
      return (
        <Key key={k.id} active={isActive} onClick={toggle}>
          {k.label || k.modifier?.toUpperCase()}
        </Key>
      );
    }

    // kind === 'send'
    return (
      <Key
        key={k.id}
        tone={k.tone}
        onMouseDown={(e) => { e.preventDefault(); sendWithModifiers(k.payload || ''); }}
      >
        {k.label || '?'}
      </Key>
    );
  };

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll {
          scrollbar-width: none;        /* 사용자 요청 — 단축키 영역 스크롤바 숨김 */
          -ms-overflow-style: none;
        }
        .mobile-toolbar-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
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
            {list.map(renderItem)}
          </div>
        </div>
      </div>
    </>
  );
};

const Key = ({ children, onClick, onMouseDown, active, tone, title }) => {
  const palette =
    tone === 'danger'
      ? { background: 'transparent', col: color.danger, border: `${color.danger}33` }
      : tone === 'accent'
        ? { background: color.accentSubtle, col: color.accent, border: color.accentBorder }
        : { background: color.surface0, col: color.text, border: color.border };

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={`mt-key ${active ? 'is-toggle-active' : ''}`}
      style={{
        ...styles.key,
        background: palette.background,
        color: palette.col,
        borderColor: palette.border,
        opacity: tone === 'muted' ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
};

const Divider = () => <div style={styles.divider} />;

const styles = {
  toolbar: {
    flexShrink: 0,
    width: '100%',
    height: 'calc(34px + env(safe-area-inset-bottom, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 2px)',
    display: 'flex',
    alignItems: 'center',
    background: color.mantle,
    borderTop: `1px solid ${color.border}`,
    fontFamily: font.sans,
    zIndex: 10,
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
    minWidth: '32px',
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
    whiteSpace: 'nowrap',
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
