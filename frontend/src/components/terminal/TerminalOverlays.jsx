/**
 * Terminal 위에 뜨는 오버레이/메뉴 서브컴포넌트 모음.
 * - GlassOverlayCard: 종료/인계 등 글래스 카드 컨테이너
 * - TerminalEdgeGutter: 분수 셀 잔여를 테마색 가장자리로 마감
 * - AuthPromptOverlay: SSH 키보드-인터랙티브(MFA/TOTP) 입력 모달
 * - TerminalContextMenu: 우클릭/롱프레스 컨텍스트 메뉴
 * Terminal.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useLayoutEffect, useRef } from 'react';
import { Copy, ClipboardPaste, Scissors, ArrowDownToLine, RefreshCw, KeyRound, Upload, Link as LinkIcon, FileText } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { MOBILE_CONTROL } from '../../styles/mobileControl';
import { glassDividerStyle, glassMenuStyle } from '../../styles/glass';
import { styles } from './terminalStyles';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';

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
      background: `color-mix(in srgb, ${themeUi.surface0 || themeUi.base} var(--glass-fill, 82%), transparent)`,
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

export const TerminalContextMenu = ({ x, y, hasSelection, linkUrl, themeUi, t, onCopy, onUseSelection, onCopyLink, onCopyAll, onPaste, onPasteToInput, onRefresh, onScrollToBottom, onUploadFile, onScreenDump, onClose, readOnly = false, isMobile = false }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 롱프레스로 여는 메뉴라 모바일이 주 사용처 — pointerdown 캡처가 아니면 터미널 위 탭이
  // 이 리스너에 닿지 않아 메뉴가 안 닫혔다. 우클릭 press 는 이 메뉴를 여는 동작이라 제외.
  useDismissOnOutside(ref, onClose, { ignoreRightButton: true });

  useLayoutEffect(() => {
    setMeasured(false);
    const viewport = window.visualViewport;
    const place = () => {
      const menu = ref.current;
      if (!menu) return;
      const margin = Number.parseFloat(tokens.space['2']);
      const left = (viewport?.offsetLeft || 0) + margin;
      const top = (viewport?.offsetTop || 0) + margin;
      const maxWidth = Math.max(0, (viewport?.width ?? window.innerWidth) - margin * 2);
      const maxHeight = Math.max(0, (viewport?.height ?? window.innerHeight) - margin * 2);
      const rect = menu.getBoundingClientRect();
      const width = Math.min(rect.width, maxWidth);
      const height = Math.min(Math.max(rect.height, menu.scrollHeight + 2), maxHeight);
      const nx = Math.max(left, Math.min(x, left + maxWidth - width));
      const ny = Math.max(top, Math.min(y, top + maxHeight - height));
      setPos(previous => previous.x === nx && previous.y === ny && previous.maxWidth === maxWidth && previous.maxHeight === maxHeight
        ? previous : { x: nx, y: ny, maxWidth, maxHeight });
      setMeasured(true);
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', place);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
    };
  }, [x, y]);

  const items = [];
  if (linkUrl && onCopyLink) {
    items.push({ icon: LinkIcon, label: t('copyLink') || 'Copy link', action: onCopyLink });
  }
  items.push({ icon: Scissors, label: t('copyAll') || 'Copy all', action: onCopyAll });
  items.push({ icon: Copy, label: t('mobileCopySelection') || 'Copy selection', action: onCopy, disabled: !hasSelection });
  if (hasSelection && readOnly && onUseSelection) {
    items.push({ icon: ClipboardPaste, label: t('selectionToInput') || 'Use in quick input', action: onUseSelection });
  }
  if (isMobile || !readOnly) {
    items.push({ icon: ClipboardPaste, label: t('paste') || 'Paste', action: onPaste });
  }
  if (onPasteToInput) {
    items.push({ icon: ClipboardPaste, label: t('pasteToInput') || 'Paste into Quick Input', action: onPasteToInput });
  }
  if (!readOnly && onUploadFile) {
    items.push({ icon: Upload, label: t('sendFile') || 'Send file', action: onUploadFile });
  }
  if (onRefresh) {
    items.push({ icon: RefreshCw, label: t('refresh') || 'Refresh', action: onRefresh });
  }
  items.push({ icon: ArrowDownToLine, label: t('scrollToBottom') || 'Scroll to bottom', action: onScrollToBottom });
  if (onScreenDump) {
    items.push({ icon: FileText, label: t('viewAsText') || 'View as text', action: onScreenDump });
  }

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const selectHint = readOnly ? t('mobileSelectGesture') : (isMac ? 'Option+drag to select' : 'Shift+drag to select');

  return (
    <div
      ref={ref}
      data-terminal-context-menu
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200000,
        ...glassMenuStyle(themeUi, { padding: '4px 0', borderRadius: '8px' }),
        width: MOBILE_CONTROL.setMenuWidth,
        maxWidth: pos.maxWidth,
        maxHeight: pos.maxHeight,
        boxSizing: 'border-box',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
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
          disabled={item.disabled}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space['2'],
            width: '100%',
            boxSizing: 'border-box',
            padding: `${tokens.space['0.5']} ${tokens.space['2']}`,
            minHeight: MOBILE_CONTROL.size,
            lineHeight: tokens.space['4'],
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: item.disabled ? themeUi.subtext : themeUi.text,
            fontSize: tokens.fontSize['12'],
            fontFamily: tokens.font.sans,
            cursor: item.disabled ? 'default' : 'pointer',
            textAlign: 'left',
          }}
          className={item.disabled ? undefined : 'iterm-menu-item'}
        >
          <item.icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        </button>
      ))}
      <div style={glassDividerStyle(themeUi, { margin: '3px 0' })} />
      <div style={{
        padding: `${tokens.space['0.5']} ${tokens.space['2']}`,
        lineHeight: tokens.fontSize['14'],
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
