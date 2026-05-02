import { useEffect } from 'react';
import { Check, X, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow } = tokens;

const ICON_BY_TONE = {
  success: { icon: Check, hue: color.success },
  info: { icon: Info, hue: color.info },
  warning: { icon: AlertTriangle, hue: color.warning },
  danger: { icon: AlertCircle, hue: color.danger },
};

const NotificationModal = ({ isOpen, message, onClose, duration = 3000, tone = 'success' }) => {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const t = setTimeout(onClose, duration);
      return () => clearTimeout(t);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  const { icon: Icon, hue } = ICON_BY_TONE[tone] || ICON_BY_TONE.success;

  return (
    <>
      <style>{`
        @keyframes toast-in {
          from { transform: translate(-50%, 14px); opacity: 0; }
          to   { transform: translate(-50%, 0);     opacity: 1; }
        }
      `}</style>
      <div style={styles.toast}>
        <div style={{ ...styles.iconWrap, color: hue, background: `${hue}1F`, borderColor: `${hue}40` }}>
          <Icon size={13} strokeWidth={2.5} />
        </div>
        <span style={styles.message}>{message}</span>
        <button onClick={onClose} style={styles.closeBtn}>
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </>
  );
};

const styles = {
  toast: {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10001,
    padding: `${space['2']} ${space['3']}`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.lg,
    fontFamily: font.sans,
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    minWidth: '260px',
    maxWidth: '90vw',
    animation: 'toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  iconWrap: {
    width: '22px',
    height: '22px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: radius.full,
  },
  message: {
    flex: 1,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.regular,
    color: color.text,
    lineHeight: 1.4,
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
    flexShrink: 0,
  },
};

export default NotificationModal;
