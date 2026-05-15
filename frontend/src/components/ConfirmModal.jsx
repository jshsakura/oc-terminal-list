import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import GlassModal from './common/GlassModal';
import { tokens } from '../styles/tokens';

const { color, fontSize, space } = tokens;

// CommandInput 과 동일한 패널 구조 (header/body/footer) 를 공유하는 표준 확인 패널.
// 오버레이는 항상 viewport 중앙 고정 — pane bounds 추종 제거(탭 이동 시 따라오던 버그 차단).
// 모바일 키보드 케이스도 visualViewport 좌표로 클램프.

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

  if (!isOpen) return null;

  const headerLabel = title || t('confirm');

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onCancel}
      title={headerLabel}
      titleIcon={TitleIcon}
      ariaLabel={typeof headerLabel === 'string' ? headerLabel : t('confirm')}
      closeTitle={t('cancel')}
      maxWidth="420px"
      titleStyle={{ color: danger ? color.danger : `var(--ui-text, ${color.text})` }}
      bodyStyle={styles.body}
      footer={(
        <>
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
        </>
      )}
      footerStyle={styles.footer}
    >
      <div style={styles.message}>{message}</div>
    </GlassModal>
  );
};

const styles = {
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
    justifyContent: 'flex-end',
  },
};

export default ConfirmModal;
