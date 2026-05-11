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
  /* 선택형 3번째 액션 — 예: 닫기에서 "Detach(살림)" 와 "Terminate(죽임)" 둘 다 노출.
     onTertiary 가 주어지면 footer 좌측에 ghost 버튼으로 그려진다. */
  tertiaryText,
  onTertiary,
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
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'absolute',
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
    whiteSpace: 'pre-line', // \n 으로 줄바꿈 — 탭 번호/이름 헤더 라인과 본문 분리용
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
