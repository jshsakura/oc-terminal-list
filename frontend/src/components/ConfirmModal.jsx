/**
 * ConfirmModal 컴포넌트
 * 공통 확인 모달 (터미널 닫기, 세션 삭제 등)
 */
import useTranslation from '../hooks/useTranslation';

const ConfirmModal = ({ isOpen, onConfirm, onCancel, title, message, confirmText, cancelText, language = 'en', danger = false, theme }) => {
  const { t } = useTranslation(language);

  if (!isOpen) return null;

  const currentTheme = theme;

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={{ 
        ...styles.modal, 
        backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bg,
        backdropFilter: 'blur(20px) saturate(180%)',
        borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
        borderRadius: currentTheme.ui.radius,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        border: `1px solid ${currentTheme.ui.borderLight || 'rgba(255,255,255,0.1)'}`,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.header, borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
          <h3 style={{ ...styles.title, color: danger ? currentTheme.red : currentTheme.ui.accent }}>{title || t('confirm')}</h3>
        </div>

        <div style={styles.content}>
          <p style={{ ...styles.message, color: currentTheme.ui.text }}>{message}</p>
        </div>

        <div style={{ ...styles.footer, borderTopColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
          <button onClick={onCancel} style={{ 
            ...styles.cancelBtn, 
            backgroundColor: currentTheme.ui.bgTertiary, 
            color: currentTheme.ui.text,
            borderRadius: currentTheme.ui.radiusSmall
          }}>
            {cancelText || t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{ 
              ...(danger ? styles.dangerBtn : styles.confirmBtn), 
              backgroundColor: danger ? currentTheme.red : currentTheme.ui.accent, 
              color: currentTheme.ui.bg,
              borderRadius: currentTheme.ui.radiusSmall,
              boxShadow: danger ? `0 4px 15px ${currentTheme.red}44` : `0 4px 15px ${currentTheme.ui.accent}44`
            }}
          >
            {confirmText || t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(8px)',
    display: 'flex',
  },
  modal: {
    width: '90%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  content: {
    padding: '20px',
  },
  message: {
    margin: 0,
    fontSize: '14px',
    lineHeight: '1.6',
    fontWeight: '500',
  },
  footer: {
    display: 'flex',
    gap: '10px',
    padding: '16px 20px',
    borderTop: '1px solid',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '10px 20px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  confirmBtn: {
    padding: '10px 20px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  dangerBtn: {
    padding: '10px 20px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default ConfirmModal;
