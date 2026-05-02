import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow } = tokens;

const ConfirmModal = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText,
  cancelText,
  language = 'en',
  danger = false,
}) => {
  const { t } = useTranslation(language);
  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.body}>
          <div style={{ ...styles.title, color: danger ? color.danger : color.text }}>
            {title || t('confirm')}
          </div>
          <div style={styles.message}>{message}</div>
        </div>
        <div style={styles.footer}>
          <Button variant="secondary" onClick={onCancel}>
            {cancelText || t('cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText || t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '90%',
    maxWidth: '380px',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  body: {
    padding: `${space['5']} ${space['5']} ${space['4']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
  },
  title: {
    fontSize: fontSize['14'],
    fontWeight: fontWeight.semibold,
  },
  message: {
    fontSize: fontSize['13'],
    color: color.subtext,
    lineHeight: 1.5,
  },
  footer: {
    display: 'flex',
    gap: space['1.5'],
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
    justifyContent: 'flex-end',
  },
};

export default ConfirmModal;
