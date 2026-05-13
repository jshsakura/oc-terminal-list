import { useEffect, useRef, useState } from 'react';
import { MessageSquare, ClipboardPaste, Copy, FileText } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { DEFAULT_MOBILE_KEYS, sanitizeMobileKeys } from '../utils/mobileKeys';
import HostIcon from '../utils/hostIcons';

/* kind 별 기본 아이콘 — 키에 명시적 icon 이 없으면 fallback. */
const DEFAULT_ICON_FOR_KIND = {
  cmdInput: MessageSquare,
  paste: ClipboardPaste,
  copy: Copy,
  copyAll: FileText,
};

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
const MobileToolbar = ({ onSendKey, onOpenCommandInput, onAction, language = 'en', keys = null, terminalSessionId = null }) => {
  const { t } = useTranslation(language);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const scrollRef = useRef(null);
  const [terminalReady, setTerminalReady] = useState(false);

  useEffect(() => {
    if (!terminalSessionId) { setTerminalReady(false); return undefined; }
    const check = () => {
      const session = window.terminalSessions?.[terminalSessionId];
      const status = session?.getSessionStatus?.();
      if (session && (status?.isReady || !session.getSessionStatus)) {
        setTerminalReady(true);
        return true;
      }
      return false;
    };
    if (check()) return undefined;
    setTerminalReady(false);
    const id = setInterval(() => { if (check()) clearInterval(id); }, 200);
    return () => clearInterval(id);
  }, [terminalSessionId]);

  // CommandInput 은 App.jsx 에서 lazy() 로 분리돼 있다. 모바일 진입 시점에 미리 prefetch 해 둬야
  // 사용자가 cmdInput 버튼을 처음 누를 때 Suspense fallback (null) 으로 잠시 비었다가 mount 되는
  // 비동기 갭이 없어진다. 이 갭 동안 user gesture 컨텍스트가 끊겨 iOS 키보드가 안 따라옴.
  useEffect(() => {
    import('./CommandInput').catch(() => { /* offline 등 — 첫 클릭 때 다시 시도 */ });
  }, []);

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

  /* 한 키의 표시 콘텐츠 — icon (k.icon → HostIcon, 없으면 kind 기본 아이콘) + label.
     둘 다 있으면 함께 표시 (icon 좌, label 우, gap 4). 둘 다 없으면 send 는 '?', mod 는 modifier 대문자. */
  const renderKeyContent = (k) => {
    const FallbackIcon = DEFAULT_ICON_FOR_KIND[k.kind] || null;
    const iconEl = k.icon
      ? <HostIcon value={k.icon} size={13} strokeWidth={2.2} />
      : (FallbackIcon ? <FallbackIcon size={13} strokeWidth={2.2} /> : null);
    let labelText = k.label || '';
    if (!iconEl && !labelText) {
      if (k.kind === 'mod') labelText = (k.modifier || 'ctrl').toUpperCase();
      else if (k.kind === 'send') labelText = '?';
    }
    if (iconEl && labelText) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {iconEl}
          <span>{labelText}</span>
        </span>
      );
    }
    return iconEl || (labelText ? <span>{labelText}</span> : null);
  };

  const renderItem = (k, idx) => {
    if (k.kind === 'sep') return <Divider key={k.id || `sep-${idx}`} />;

    if (k.kind === 'copy' || k.kind === 'copyAll') {
      return (
        <Key key={k.id} tone={k.tone} title={t(k.kind)} onClick={() => onAction?.(k.kind)}>
          {renderKeyContent(k)}
        </Key>
      );
    }

    if (k.kind === 'cmdInput') {
      return (
        <Key
          key={k.id}
          tone={k.tone || 'accent'}
          title={t('commandInput')}
          // mousedown 에서 preventDefault — 버튼이 focus 를 뺏지 않게 한다.
          // 안 그러면 xterm hidden textarea 가 blur 되며 iOS 키보드가 내려가고,
          // 그 뒤에 lazy-load 된 CommandInput textarea 의 .focus() 가 user gesture
          // 컨텍스트 밖에서 호출돼 키보드가 다시 안 올라옴.
          // (기존 send 키들도 같은 패턴으로 focus 안 뺏음.)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpenCommandInput?.()}
        >
          {renderKeyContent(k)}
        </Key>
      );
    }

    if (k.kind === 'paste') {
      return (
        <Key
          key={k.id}
          tone={k.tone}
          title={t('paste')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handlePaste}
        >
          {renderKeyContent(k)}
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
        <Key key={k.id} tone={k.tone} active={isActive} onClick={toggle}>
          {renderKeyContent(k)}
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
        {renderKeyContent(k)}
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
        @keyframes skel-pulse {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.9; }
        }
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
            {!terminalReady && terminalSessionId ? (
              list.map((k, i) => (
                <div key={i} style={{
                  ...styles.key,
                  background: color.surface0,
                  borderRadius: radius.xs,
                  minWidth: k.kind === 'sep' ? '1px' : styles.key.minWidth,
                  width: k.kind === 'sep' ? '1px' : undefined,
                  padding: k.kind === 'sep' ? 0 : styles.key.padding,
                  height: styles.key.height,
                  animation: 'skel-pulse 1.4s ease-in-out infinite',
                  animationDelay: `${i * 80}ms`,
                  border: `1px solid ${color.border}`,
                  margin: k.kind === 'sep' ? `0 ${space['1']}` : 0,
                }} />
              ))
            ) : (
              list.map(renderItem)
            )}
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
    minWidth: '26px',
    padding: '0 5px',
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
