import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const VIEWPORT_GAP = 12;
// 모바일 ghost-click 방어 — 상단의 메뉴 항목을 탭해서 모달을 열면, 그 탭의 touchend 뒤에
// 브라우저가 합성하는 click 이 방금 뜬 전체화면 오버레이(backdrop=onClose) 위로 떨어져
// 모달이 같은 제스처에 즉시 닫히던 버그. 열린 직후 짧은 유예 동안 backdrop 닫힘을 무시한다.
const OVERLAY_DISMISS_GRACE_MS = 400;

const GlassModal = ({
  isOpen,
  onClose,
  title,
  titleIcon: TitleIcon = null,
  ariaLabel,
  children,
  afterHeader = null,
  footer = null,
  width = '90%',
  maxWidth = '420px',
  height = null,
  maxHeight = '80%',
  zIndex = 200001,
  panelStyle = null,
  titleStyle = null,
  bodyStyle = null,
  footerStyle = null,
  closeTitle = 'Close',
}) => {
  const [vv, setVv] = useState(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return { height: typeof window !== 'undefined' ? window.innerHeight : 0, offsetTop: 0 };
    }
    return { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop };
  });

  // 오버레이가 열린 시각 — backdrop 클릭이 진짜 사용자 의도인지(유예 이후) ghost-click 인지 구분.
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now();
  }, [isOpen]);
  const handleOverlayClick = () => {
    if (Date.now() - openedAtRef.current < OVERLAY_DISMISS_GRACE_MS) return;
    onClose?.();
  };

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

  if (!isOpen) return null;

  const overlayStyle = {
    ...styles.overlay,
    top: `${vv.offsetTop}px`,
    height: `${vv.height}px`,
    zIndex,
  };

  return (
    <div data-testid="glass-modal-overlay" style={overlayStyle} onClick={handleOverlayClick} role="presentation">
      <div
        className="iterm-glass-modal"
        role="dialog"
        aria-label={ariaLabel || (typeof title === 'string' ? title : 'Dialog')}
        style={{
          ...styles.panel,
          width,
          maxWidth,
          height: height || undefined,
          maxHeight: `min(${maxHeight}, calc(${vv.height}px - ${VIEWPORT_GAP * 2}px))`,
          ...panelStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={{ ...styles.title, ...titleStyle }}>
            {TitleIcon && <TitleIcon size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
            {title}
          </div>
          <button onClick={onClose} title={closeTitle} aria-label={closeTitle} style={styles.closeBtn}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>
        {afterHeader}
        <div style={{ ...styles.body, ...bodyStyle }}>{children}</div>
        {footer && <footer style={{ ...styles.footer, ...footerStyle }}>{footer}</footer>}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    left: 0,
    right: 0,
    padding: space['3'],
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
    fontFamily: font.sans,
    boxSizing: 'border-box',
  },
  panel: {
    background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 58%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 62%, transparent)`,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
    backdropFilter: 'blur(var(--glass-blur-panel, 20px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 20px))',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 44%, transparent)`,
    flexShrink: 0,
  },
  title: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: `var(--ui-text, ${color.text})`,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
  },
  closeBtn: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 54%, transparent)`,
    color: `var(--ui-subtext, ${color.subtext})`,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
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
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 44%, transparent)`,
    flexShrink: 0,
  },
};

export default GlassModal;
