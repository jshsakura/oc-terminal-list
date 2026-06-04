/**
 * Terminal 위에 뜨는 오버레이/메뉴 서브컴포넌트 모음.
 * - GlassOverlayCard: 종료/인계 등 글래스 카드 컨테이너
 * - TerminalEdgeGutter: 분수 셀 잔여를 테마색 가장자리로 마감
 * - AuthPromptOverlay: SSH 키보드-인터랙티브(MFA/TOTP) 입력 모달
 * - TerminalContextMenu: 우클릭/롱프레스 컨텍스트 메뉴
 * Terminal.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useEffect, useRef } from 'react';
import { Copy, ClipboardPaste, Scissors, ArrowDownToLine, RotateCcw, KeyRound } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassDividerStyle, glassMenuItemHover, glassMenuStyle } from '../../styles/glass';
import { styles } from './terminalStyles';

export const GlassOverlayCard = ({ themeUi, zIndex = 10040, children }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.38)',
    backdropFilter: 'blur(var(--glass-blur-overlay, 5px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-overlay, 5px))',
    zIndex,
    fontFamily: 'inherit',
  }}>
    <div style={{
      background: `color-mix(in srgb, ${themeUi.surface0 || themeUi.base} 82%, transparent)`,
      backdropFilter: 'blur(var(--glass-blur-panel, 20px))',
      WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 20px))',
      border: `1px solid ${themeUi.borderStrong || themeUi.border}`,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
      padding: '20px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      minWidth: '220px', maxWidth: '280px',
    }}>
      {children}
    </div>
  </div>
);

export const TerminalEdgeGutter = ({ right = 0, bottom = 0, themeUi }) => {
  const showRight = right >= 1;
  const showBottom = bottom >= 1;
  if (!showRight && !showBottom) return null;
  const base = themeUi.base || '#11111b';
  return (
    <>
      {showRight && (
        <div
          aria-hidden="true"
          data-testid="terminal-edge-gutter-right"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: `${Math.ceil(right)}px`,
            pointerEvents: 'none',
            zIndex: 1,
            background: `linear-gradient(90deg, color-mix(in srgb, ${base} 0%, transparent), ${base} 72%)`,
          }}
        />
      )}
      {showBottom && (
        <div
          aria-hidden="true"
          data-testid="terminal-edge-gutter-bottom"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${Math.ceil(bottom)}px`,
            pointerEvents: 'none',
            zIndex: 1,
            background: `linear-gradient(180deg, color-mix(in srgb, ${base} 0%, transparent), ${base} 72%)`,
          }}
        />
      )}
    </>
  );
};

export const AuthPromptOverlay = ({ prompt, themeUi, t, onSubmit, onCancel }) => {
  const initial = (prompt.prompts || []).map(() => '');
  const [values, setValues] = useState(initial);
  const pasteFirst = async () => {
    try {
      const text = (await navigator.clipboard.readText() || '').trim();
      if (text) setValues((v) => [text, ...v.slice(1)]);
    } catch { /* clipboard 권한 없음 — 사용자 수동 paste */ }
  };
  /* 현재 터미널 테마에서 직접 도출한 UI 팔레트 사용.
     MFA 입력 후 취소/끊김 화면까지 같은 색 체계로 유지한다. */
  return (
    <div
      onClick={onCancel}
      style={{
        ...styles.fixedModalOverlay(themeUi, 10050),
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
        style={{
          ...styles.modalCard(themeUi),
        }}
      >
        <header style={styles.modalHeader(themeUi)}>
          <div style={styles.iconTile(themeUi)}>
            <KeyRound size={16} strokeWidth={2} />
          </div>
          <div style={styles.modalTitle(themeUi)}>
            {prompt.name || (t('authPromptTitle') || 'Additional verification')}
          </div>
        </header>
        <div style={styles.modalBody(themeUi, 'left')}>
          {prompt.instructions && (
            <div style={{ whiteSpace: 'pre-line' }}>
              {prompt.instructions}
            </div>
          )}
          {(prompt.prompts || []).map((p, i) => (
            <label key={i} style={styles.promptField}>
              <span style={styles.promptLabel(themeUi)}>
                {p.prompt || (t('authPromptCode') || 'Code')}
              </span>
              <div style={styles.promptInputRow}>
                <input
                  type={p.echo ? 'text' : 'password'}
                  inputMode="text"
                  autoFocus={i === 0}
                  autoComplete="one-time-code"
                  value={values[i] || ''}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  style={styles.promptInput(themeUi)}
                />
                {i === 0 && (
                  <button
                    type="button"
                    onClick={pasteFirst}
                    title={t('paste') || 'Paste'}
                    style={styles.promptPasteButton(themeUi)}
                  >
                    {t('paste') || 'Paste'}
                  </button>
                )}
              </div>
            </label>
          ))}
        </div>
        <footer style={styles.modalFooter(themeUi)}>
          <button
            type="button"
            onClick={onCancel}
            style={styles.secondaryModalButton(themeUi)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${themeUi.surface1 || themeUi.surface0}`; e.currentTarget.style.color = themeUi.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.surface1 || themeUi.surface0} 70%, transparent)`; e.currentTarget.style.color = themeUi.subtext; }}
          >
            {t('cancel') || 'Cancel'}
          </button>
          <button
            type="submit"
            style={styles.primaryModalButton(themeUi)}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 35%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${themeUi.accent} 22%, transparent)`; }}
          >
            {t('authPromptSubmit') || 'Continue'}
          </button>
        </footer>
      </form>
    </div>
  );
};

export const TerminalContextMenu = ({ x, y, hasSelection, themeUi, t, onCopy, onCopyAll, onPaste, onClear, onScrollToBottom, onClose }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleClick = (e) => {
      if (e.button === 2) return;
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      // touchstart 도 함께 — 모바일에서 터미널이 touchstart 를 preventDefault 하면 합성 mousedown 이
      // 억제돼 바깥 탭으로 안 닫히던 문제 우회. (롱프레스로 열리는 컨텍스트 메뉴라 모바일이 주 사용처)
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('touchstart', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    setMeasured(false);
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nx = x, ny = y;
      if (nx + rect.width > window.innerWidth - margin) nx = window.innerWidth - rect.width - margin;
      if (nx < margin) nx = margin;
      if (ny + rect.height > window.innerHeight - margin) ny = window.innerHeight - rect.height - margin;
      if (ny < margin) ny = margin;
      setPos({ x: nx, y: ny });
      setMeasured(true);
    }
  }, [x, y]);

  const items = [];
  if (hasSelection) {
    items.push({ icon: Copy, label: t('copy') || 'Copy', action: onCopy });
  }
  items.push({ icon: Scissors, label: t('copyAll') || 'Copy all', action: onCopyAll });
  items.push({ icon: ClipboardPaste, label: t('paste') || 'Paste', action: onPaste });
  items.push({ icon: RotateCcw, label: t('clear') || 'Clear', action: onClear });
  items.push({ icon: ArrowDownToLine, label: t('scrollToBottom') || 'Scroll to bottom', action: onScrollToBottom });

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const selectHint = isMac ? 'Option+drag to select' : 'Shift+drag to select';

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200000,
        ...glassMenuStyle(themeUi, { padding: '4px 0', borderRadius: '8px' }),
        minWidth: '160px',
        fontFamily: tokens.font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '6px 12px',
            border: 'none',
            background: 'transparent',
            color: themeUi.text,
            fontSize: tokens.fontSize['12'],
            fontFamily: tokens.font.sans,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(themeUi); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <item.icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.7 }} />
          {item.label}
        </button>
      ))}
      <div style={glassDividerStyle(themeUi, { margin: '3px 0' })} />
      <div style={{
        padding: '4px 12px',
        fontSize: tokens.fontSize['11'],
        color: themeUi.subtext,
        opacity: 0.7,
        fontFamily: tokens.font.sans,
        letterSpacing: '0.01em',
      }}>
        {selectHint}
      </div>
    </div>
  );
};
