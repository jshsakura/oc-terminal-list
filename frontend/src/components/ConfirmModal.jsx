/**
 * ConfirmModal 컴포넌트
 * 공통 확인 모달 (터미널 닫기, 세션 삭제 등)
 */
import useTranslation from '../hooks/useTranslation';

const ConfirmModal = ({ isOpen, onConfirm, onCancel, title, message, confirmText, cancelText, language = 'en', danger = false, theme }) => {
  const { t } = useTranslation(language);

  if (!isOpen) return null;

  // 기본 테마 (theme prop이 없을 경우 Catppuccin 사용)
  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      bgTertiary: '#313244',
      border: '#313244',
      text: '#cdd6f4',
      textSecondary: '#6c7086',
      accent: '#89b4fa',
    },
    green: '#a6e3a1',
    red: '#f38ba8',
    brightBlack: '#585b70',
  };

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div style={styles.overlay} onClick={handleCancel}>
      <div style={{ ...styles.modal, backgroundColor: currentTheme.ui.bg, borderColor: currentTheme.ui.border }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.header, borderBottomColor: currentTheme.ui.border }}>
          <h3 style={{ ...styles.title, color: currentTheme.ui.text }}>{title || t('confirm')}</h3>
        </div>

        <div style={styles.content}>
          <p style={{ ...styles.message, color: currentTheme.ui.text }}>{message}</p>
        </div>

        <div style={{ ...styles.footer, borderTopColor: currentTheme.ui.border }}>
          <button onClick={handleCancel} style={{ ...styles.cancelBtn, backgroundColor: currentTheme.brightBlack, color: currentTheme.ui.text }}>
            {cancelText || t('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            style={danger ? { ...styles.dangerBtn, backgroundColor: currentTheme.red, color: currentTheme.ui.bg } : { ...styles.confirmBtn, backgroundColor: currentTheme.green, color: currentTheme.ui.bg }}
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
  },
  modal: {
    backgroundColor: '#1e1e2e',
    borderRadius: '2px',
    width: '90%',
    maxWidth: '450px',
    border: '1px solid #313244',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #313244',
  },
  title: {
    margin: 0,
    color: '#cdd6f4',
    fontSize: '16px',
    fontWeight: '600',
  },
  content: {
    padding: '20px',
  },
  message: {
    margin: 0,
    color: '#cdd6f4',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    padding: '16px 20px',
    borderTop: '1px solid #313244',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '12px 24px',
    backgroundColor: '#585b70',
    color: '#cdd6f4',
    border: 'none',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  confirmBtn: {
    padding: '12px 24px',
    backgroundColor: '#a6e3a1',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  dangerBtn: {
    padding: '12px 24px',
    backgroundColor: '#f38ba8',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
};

export default ConfirmModal;
