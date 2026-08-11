import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import Button from './common/Button';
import GlassModal from './common/GlassModal';
import { copyToClipboard } from '../utils/clipboard';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, radius, space } = tokens;

/**
 * 터미널 스크롤백 전체 텍스트 덤프 — 모바일/데스크톱 모두 자유 선택 + 복사 가능.
 * `text` 가 falsy 면 모달 닫힘.
 */
const ScreenDumpModal = ({ text, onClose, t }) => {
  const taRef = useRef(null);
  // 'idle' | 'copied' | 'failed' — 눌렀는데 아무 표시가 없으면 안 된 것과 구별되지 않는다.
  const [copyState, setCopyState] = useState('idle');

  useEffect(() => {
    if (!text) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text, onClose]);

  if (!text) return null;

  const handleCopyAll = async () => {
    const ok = await copyToClipboard(text);
    setCopyState(ok ? 'copied' : 'failed');
    if (!ok) {
      // 마지막 수단: 전체를 선택해 둔다 — iOS 는 여기서 길게 눌러 "복사" 를 쓸 수 있다.
      taRef.current?.focus();
      taRef.current?.setSelectionRange?.(0, (text || '').length);
    }
    setTimeout(() => setCopyState('idle'), 1600);
  };

  return (
    <GlassModal
      isOpen={!!text}
      onClose={onClose}
      title={t?.('screenDump') || 'Terminal text'}
      titleIcon={FileText}
      closeTitle={t?.('close') || 'Close'}
      width="92%"
      maxWidth="780px"
      height="88vh"
      maxHeight="900px"
      bodyStyle={styles.body}
      footer={(
        <>
          <div style={{ flex: 1 }} />
          <Button
            variant="primary"
            onClick={handleCopyAll}
            icon={copyState === 'copied' ? Check : Copy}
          >
            {copyState === 'copied'
              ? (t?.('copied') || 'Copied')
              : copyState === 'failed'
                ? (t?.('clipboardManualHint') || 'Select & long-press to copy')
                : (t?.('copyAll') || 'Copy all')}
          </Button>
        </>
      )}
      footerStyle={styles.footer}
    >
      <textarea
        ref={taRef}
        readOnly
        value={text}
        style={styles.textarea}
      />
      <div style={styles.hint}>
        {t?.('screenDumpHint') || 'Free select & copy any portion. ESC to close.'}
      </div>
    </GlassModal>
  );
};

const styles = {
  body: {
    padding: `${space['3']} ${space['4']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    minHeight: 0,
  },
  textarea: {
    flex: 1,
    minHeight: 0,
    padding: `${space['3']}`,
    background: `color-mix(in srgb, var(--ui-crust, ${color.crust}) 58%, transparent)`,
    color: `var(--ui-text, ${color.text})`,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    lineHeight: 1.5,
    outline: 'none',
    resize: 'none',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    overflow: 'auto',
  },
  hint: {
    fontSize: fontSize['11'],
    color: `var(--ui-subtext, ${color.muted})`,
    textAlign: 'center',
  },
  footer: {
    justifyContent: 'flex-end',
  },
};

export default ScreenDumpModal;
