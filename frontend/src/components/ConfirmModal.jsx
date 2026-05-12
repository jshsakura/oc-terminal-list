import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow } = tokens;

// CommandInput 과 동일한 패널 구조 (header/body/footer) 를 공유하는 표준 확인 패널.
// 오버레이는 항상 viewport 중앙 고정 — pane bounds 추종 제거(탭 이동 시 따라오던 버그 차단).
// 모바일 키보드 케이스도 visualViewport 좌표로 클램프.

const VV_TOP_GAP = 12;
const VV_BOTTOM_GAP = 12;

const ConfirmModal = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  titleIcon: TitleIcon = null,
  message,
  confirmText,
  cancelText,
  tertiaryText,
  onTertiary,
  language = 'en',
  danger = false,
}) => {
  const { t } = useTranslation(language);

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

  if (!isOpen) return null;

  const overlayStyle = {
    ...styles.overlay,
    top: `${vv.offsetTop}px`,
    height: `${vv.height}px`,
    paddingTop: `${VV_TOP_GAP}px`,
    paddingBottom: `${VV_BOTTOM_GAP}px`,
  };

  const headerLabel = title || t('confirm');

  return (
    <div style={overlayStyle} onClick={onCancel} role="presentation">
      <div
        role="dialog"
        aria-label={typeof headerLabel === 'string' ? headerLabel : t('confirm')}
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <div style={{ ...styles.title, color: danger ? color.danger : color.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {TitleIcon && <TitleIcon size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
            {headerLabel}
          </div>
          <button
            onClick={onCancel}
            style={styles.closeBtn}
            aria-label={t('cancel')}
            title={t('cancel')}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.message}>{message}</div>
        </div>

        <footer style={styles.footer}>
          {onTertiary && (
            <Button variant="ghost" onClick={onTertiary} style={{ marginRight: 'auto' }}>
              {tertiaryText || ''}
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel}>
            {cancelText || t('cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText || t('confirm')}
          </Button>
        </footer>
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
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  panel: {
    width: '90%',
    maxWidth: '420px',
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
  title: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
  },
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
    padding: `${space['3']} ${space['3']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
  },
  message: {
    fontSize: fontSize['13'],
    color: color.subtext,
    lineHeight: 1.5,
    whiteSpace: 'pre-line',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    padding: `${space['1.5']} ${space['3']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
    justifyContent: 'flex-end',
  },
};

export default ConfirmModal;
