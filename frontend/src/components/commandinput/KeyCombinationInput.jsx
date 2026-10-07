import { useId, useLayoutEffect, useRef, useState } from 'react';
import { tokens } from '../../styles/tokens';
import terminalKeyCombination from '../../utils/terminalKeyCombination';

const { color, fontSize, radius, space } = tokens;

export default function KeyCombinationInput({ t, onSend }) {
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, shift: false });
  const [key, setKey] = useState('');
  const [composing, setComposing] = useState(false);
  const inputRef = useRef(null);
  const inputId = useId();
  const previewId = useId();
  const combination = terminalKeyCombination(key, modifiers);
  const canSend = combination.payload !== null && !composing;
  useLayoutEffect(() => { inputRef.current?.focus(); }, []);
  const send = () => {
    if (canSend) { onSend(combination.payload); }
  };

  return <section style={styles.panel} aria-label={t('keyCombination')}>
    <div style={styles.modifiers}>
      {['ctrl', 'alt', 'shift'].map((modifier) => <button key={modifier} type="button"
        aria-pressed={modifiers[modifier]}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setModifiers((previous) => ({ ...previous, [modifier]: !previous[modifier] }))}
        style={{ ...styles.button, background: modifiers[modifier] ? color.accentSubtle : color.surface0,
          color: modifiers[modifier] ? color.accent : color.text,
          borderColor: modifiers[modifier] ? color.accent : color.border }}>
        {{ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }[modifier]}
      </button>)}
    </div>
    <label htmlFor={inputId} style={styles.label}>{t('keyCombinationKey')}</label>
    <input ref={inputRef} id={inputId} value={key} aria-describedby={previewId}
      placeholder={t('keyCombinationPlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      onChange={(event) => setKey(event.target.value)}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          if (!composing && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
        }
      }} style={styles.input} />
    <output id={previewId} aria-live="polite" style={styles.preview}>
      {combination.error === 'empty' ? t('keyCombinationHint') : combination.error
        ? t('keyCombinationUnsupported') : combination.label}
    </output>
    <button type="button" disabled={!canSend} onClick={send}
      onMouseDown={(event) => event.preventDefault()}
      style={{ ...styles.button, alignSelf: 'flex-end', background: color.accent, color: color.crust,
        borderColor: color.accent, opacity: canSend ? 1 : 0.45 }}>
      {t('keyCombinationSend')}
    </button>
  </section>;
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column', gap: space['2'], padding: space['3'], minWidth: 0 },
  modifiers: { display: 'flex', gap: space['2'] },
  button: { minHeight: 32, padding: `0 ${space['3']}`, border: '1px solid', borderRadius: radius.sm,
    fontFamily: 'inherit', fontSize: fontSize['13'], cursor: 'pointer' },
  label: { fontSize: fontSize['12'], color: color.subtext },
  input: { minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 36,
    padding: space['2'], border: `1px solid ${color.border}`, borderRadius: radius.sm,
    background: color.base, color: color.text, fontSize: fontSize['16'], fontFamily: 'inherit' },
  preview: { minHeight: 24, color: color.text, fontSize: fontSize['13'], overflowWrap: 'anywhere' },
};
