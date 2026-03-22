/**
 * ConfirmModal 컴포넌트
 * 공통 확인 모달 (터미널 닫기, 세션 삭제 등)
 */
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';

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
        borderRadius: currentTheme.ui.radius || '8px',
        boxShadow: currentTheme.ui.shadow,
        border: `1px solid ${currentTheme.ui.border}`,
        position: 'relative',
        overflow: 'hidden'
      }} onClick={(e) => e.stopPropagation()}>
        {/* Inner Highlight for Skeuomorphism */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.05)',
          pointerEvents: 'none',
          zIndex: 10
        }} />
        <div style={{ 
          ...styles.header, 
          borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border,
          backgroundColor: currentTheme.ui.bgSecondary 
        }}>
          <h3 style={{ ...styles.title, color: danger ? currentTheme.red : currentTheme.ui.accent }}>{title || t('confirm')}</h3>
        </div>

        <div style={styles.content}>
          <p style={{ ...styles.message, color: currentTheme.ui.text }}>{message}</p>
        </div>

        <div style={{ ...styles.footer, borderTopColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
          <Button 
            onClick={onCancel} 
            theme={currentTheme}
          >
            {cancelText || t('cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            theme={currentTheme}
          >
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
    padding: '12px 20px',
    borderTop: '1px solid',
    justifyContent: 'flex-end',
  },
};

export default ConfirmModal;
