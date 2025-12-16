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

  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      bgTertiary: '#313244',
      border: '#2a2b3d',
      text: '#cdd6f4',
      textSecondary: '#6c7086',
      accent: '#89b4fa',
    },
    green: '#a6e3a1',
  };

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
          backgroundColor: currentTheme.ui.bgTertiary,
          borderColor: currentTheme.ui.border,
          animation: 'slideInUp 0.3s ease',
        }}
      >
        <div style={styles.content}>
          <div
            style={{
              ...styles.iconCircle,
              backgroundColor: currentTheme.green + '25',
            }}
          >
            <Check size={18} color={currentTheme.green} strokeWidth={2.5} />
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
          onMouseEnter={(e) => {
            e.currentTarget.style.color = currentTheme.ui.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = currentTheme.ui.textSecondary;
          }}
        >
          <X size={16} />
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
    backgroundColor: '#313244',
    borderRadius: '8px',
    padding: '14px 16px',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    minWidth: '320px',
    maxWidth: '400px',
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
    fontWeight: '500',
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
    borderRadius: '4px',
    transition: 'color 0.15s ease',
    flexShrink: 0,
  },
};

export default NotificationModal;
