/**
 * NotificationModal 컴포넌트
 * 토스트 알림 표시
 */
import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

const NotificationModal = ({ isOpen, message, onClose, theme, duration = 3000 }) => {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  const currentTheme = theme;

  return (
    <>
      <style>{`
        @keyframes slideInUp {
          from {
            transform: translate(-50%, 100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `}</style>
      <div
        style={{
          ...styles.toast,
          backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bgTertiary,
          backdropFilter: 'blur(20px)',
          borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
          borderRadius: currentTheme.ui.radiusSmall,
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          animation: 'slideInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={styles.content}>
          <div
            style={{
              ...styles.iconCircle,
              backgroundColor: currentTheme.green + '20',
            }}
          >
            <Check size={18} color={currentTheme.green} strokeWidth={3} />
          </div>
          <span style={{ ...styles.message, color: currentTheme.ui.text }}>
            {message}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            ...styles.closeBtn,
            color: currentTheme.ui.textSecondary,
          }}
        >
          <X size={18} strokeWidth={2.5} />
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
    padding: '12px 16px',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    minWidth: '280px',
    maxWidth: '90vw',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
  },
  iconCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  message: {
    fontSize: '14px',
    fontWeight: '700',
    lineHeight: '1.4',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },
};

export default NotificationModal;
