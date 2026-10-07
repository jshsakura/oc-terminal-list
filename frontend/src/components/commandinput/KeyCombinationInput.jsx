import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, RotateCcw, Send } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import terminalKeyCombination from '../../utils/terminalKeyCombination';

const { color, fontSize, radius, space } = tokens;
const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const COMMON_KEYS = [['Escape', 'Esc'], ['Tab', 'Tab'], ['Space', 'Space'], ['Enter', 'Enter'], ['Backspace', '⌫']];
const ARROW_KEYS = [['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→']];
const DISPLAY_KEYS = Object.fromEntries([...COMMON_KEYS, ...ARROW_KEYS, ['PageUp', 'PgUp'], ['PageDown', 'PgDn']]);
const readKeyInput = value => {
  let key = value;
  const modifiers = { ctrl: false, alt: false, shift: false };
  let hasModifiers = false;
  let prefix;
  while ((prefix = /^(ctrl|control|alt|option|shift)\s*\+\s*/i.exec(key.trimStart()))) {
    modifiers[{ ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' }[prefix[1].toLowerCase()]] = true;
    key = key.trimStart().slice(prefix[0].length);
    hasModifiers = true;
  }
  return { key, modifiers: hasModifiers ? modifiers : null };
};

const KEY_GROUPS = [
  { title: 'keyCombinationSpecialKeys', keys: [['Escape', 'Esc'], ['Tab', 'Tab'], ['Enter', 'Enter'],
    ['Space', 'Space'], ['Backspace', '⌫']] },
  { title: 'keyCombinationNavigationKeys', keys: [['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→'],
    ['Home', 'Home'], ['End', 'End'], ['PageUp', 'PgUp'], ['PageDown', 'PgDn'], ['Insert', 'Ins'], ['Delete', 'Del']] },
  { title: 'keyCombinationFunctionKeys', keys: Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]) },
];

export default function KeyCombinationInput({ t, onSend, onAddShortcut,
  initialKey = '', initialModifiers, showKeyButtons = false, autoFocus = true, footerTarget = null }) {
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, shift: false, ...initialModifiers });
  const [key, setKey] = useState(initialKey);
  const [directText, setDirectText] = useState(initialKey);
  const [composing, setComposing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keyTab, setKeyTab] = useState('keyboard');
  const [directInputOpen, setDirectInputOpen] = useState(!showKeyButtons);
  const inputRef = useRef(null);
  const inputId = useId();
  const previewId = useId();
  const combination = terminalKeyCombination(key, modifiers);
  const displayLabel = combination.label.split(' + ').map(part => DISPLAY_KEYS[part] || part).join(' + ');
  const pendingModifiers = ['ctrl', 'alt', 'shift'].filter(modifier => modifiers[modifier])
    .map(modifier => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[modifier]).join(' + ');
  const canSend = combination.payload !== null && !composing;
  useLayoutEffect(() => {
    if (directInputOpen && (autoFocus || showKeyButtons)) inputRef.current?.focus();
  }, [autoFocus, directInputOpen, showKeyButtons]);
  const selectKey = value => { setKey(value); setDirectText(value); setSaved(false); };
  const keyButton = (value, label) => {
    const selected = terminalKeyCombination(key).label.toLowerCase() === terminalKeyCombination(value).label.toLowerCase();
    return <button key={value} type="button" aria-label={value} aria-pressed={selected}
      onMouseDown={event => event.preventDefault()} onClick={() => selectKey(value)}
      style={{ ...styles.button, minWidth: 0, padding: `0 ${space['1']}`, fontSize: fontSize['12'],
        background: selected ? color.accentSubtle : color.surface0,
        color: selected ? color.accent : color.text, borderColor: color.border }}>{label}</button>;
  };
  const send = () => {
    if (canSend) { onSend?.(combination.payload); }
  };
  const add = () => {
    if (canSend && !saved && onAddShortcut && onAddShortcut({ label: combination.label, payload: combination.payload }) !== false) setSaved(true);
  };
  const modifierKeys = <div data-key-combination-modifiers style={showKeyButtons
    ? { ...styles.keyGrid, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } : styles.modifiers}>
    {['ctrl', 'alt', 'shift'].map(modifier => <button key={modifier} type="button"
      aria-pressed={modifiers[modifier]}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { setSaved(false); setDirectText(key); setModifiers(previous => ({ ...previous, [modifier]: !previous[modifier] })); }}
      style={{ ...styles.button, fontSize: showKeyButtons ? fontSize['12'] : fontSize['13'],
        background: modifiers[modifier] ? color.accentSubtle : color.surface0,
        color: modifiers[modifier] ? color.accent : color.text, borderColor: color.border }}>
      {{ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }[modifier]}
    </button>)}
  </div>;
  const actions = <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space['2'], width: '100%' }}>
    {onAddShortcut && <button type="button" disabled={!canSend || saved} onClick={add}
      onMouseDown={event => event.preventDefault()}
      style={{ ...styles.button, borderColor: color.border, background: color.surface0, color: color.text,
        opacity: canSend && !saved ? 1 : 0.45 }}>{t(saved ? 'shortcutAdded' : 'addToQuickBar')}</button>}
    {onSend && <button type="button" disabled={!canSend} onClick={send}
      onMouseDown={event => event.preventDefault()}
      style={{ ...styles.button, marginLeft: 'auto', background: color.accent, color: color.crust,
        borderColor: color.accent, opacity: canSend ? 1 : 0.45 }}>
      <Send size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>{t(footerTarget ? 'send' : 'keyCombinationSend')}</span>
    </button>}
  </div>;

  return <section data-key-combination-panel style={{ ...styles.panel, ...(footerTarget ? { minHeight: 0, overflowY: 'auto', flex: '1 1 auto' } : {}) }} aria-label={t('keyCombination')}>
    <div style={styles.summary}>
      <output id={previewId} aria-live="polite" style={styles.preview}>
        {combination.error === 'empty' ? (pendingModifiers ? `${pendingModifiers} + …`
          : t(showKeyButtons ? 'keyCombinationPickHint' : 'keyCombinationHint')) : combination.error
          ? t('keyCombinationUnsupported') : displayLabel}
      </output>
      {showKeyButtons && <button type="button" title={t('keyCombinationReset')} aria-label={t('keyCombinationReset')}
        onClick={() => { setModifiers({ ctrl: false, alt: false, shift: false }); setKey(''); setDirectText(''); setSaved(false); }}
        style={styles.reset}><RotateCcw size={14} aria-hidden="true" /></button>}
    </div>
    {!showKeyButtons && modifierKeys}
    {showKeyButtons && <>
      <div role="group" aria-label={t('keyCombinationKeyType')} style={styles.modifiers}>
        {['keyboard', 'special'].map(tab => <button key={tab} type="button" aria-pressed={keyTab === tab}
          onMouseDown={event => event.preventDefault()} onClick={() => setKeyTab(tab)}
          style={{ ...styles.button, flex: 1, background: keyTab === tab ? color.accentSubtle : color.surface0,
            color: keyTab === tab ? color.accent : color.text, borderColor: color.border }}>
          {t(tab === 'keyboard' ? 'keyCombinationKeyboard' : 'keyCombinationMoreKeys')}
        </button>)}
      </div>
      <div data-key-combination-keyboard style={styles.keyboard}>
      {keyTab === 'keyboard' ? <div role="group" aria-label={t('keyCombinationKeyboard')} style={styles.keyboard}>
        {KEYBOARD_ROWS.map((row, index) => <div key={row} style={{ ...styles.keyGrid,
          gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, marginInline: index < 2 ? 0 : index === 2 ? '4%' : '12%' }}>
          {[...row].map(value => keyButton(value, value.toUpperCase()))}
        </div>)}
        <div style={{ ...styles.keyGrid, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          {COMMON_KEYS.map(([value, label]) => keyButton(value, label))}
        </div>
        <div style={styles.keyGrid}>{ARROW_KEYS.map(([value, label]) => keyButton(value, label))}</div>
      </div> : KEY_GROUPS.map(group => <div key={group.title} role="group" aria-label={t(group.title)}>
        <div style={{ ...styles.label, marginBottom: space['1'] }}>{t(group.title)}</div>
        <div style={styles.keyGrid}>{group.keys.map(([value, label]) => keyButton(value, label))}</div>
      </div>)}
      {modifierKeys}
      </div>
      <button type="button" aria-expanded={directInputOpen} aria-controls={inputId}
        onClick={() => setDirectInputOpen(open => !open)}
        style={{ ...styles.button, alignSelf: 'flex-start', background: 'transparent', color: color.subtext, borderColor: 'transparent' }}>
        {t('keyCombinationDirectInput')}{directInputOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </>}
    {directInputOpen && <>
    <label htmlFor={inputId} style={styles.label}>{t(showKeyButtons ? 'keyCombinationDirectInputLabel' : 'keyCombinationKey')}</label>
    <input ref={inputRef} id={inputId} value={directText} aria-describedby={previewId}
      placeholder={t('keyCombinationPlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      onChange={(event) => {
        const value = event.target.value;
        const parsed = readKeyInput(value);
        setDirectText(value); setKey(parsed.key); setSaved(false);
        if (parsed.modifiers) setModifiers(parsed.modifiers);
      }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={(event) => {
        if (showKeyButtons && !event.metaKey && !composing && !event.nativeEvent.isComposing
          && (event.ctrlKey || event.altKey || (event.shiftKey && event.key.length > 1) || /^F(?:[1-9]|1[0-2])$/.test(event.key))
          && !['Control', 'Alt', 'Shift', 'Meta', 'Dead', 'Process'].includes(event.key)) {
          const capturedModifiers = { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
          const captured = terminalKeyCombination(event.key, capturedModifiers);
          if (captured.payload !== null) {
            event.preventDefault(); event.stopPropagation();
            setModifiers(capturedModifiers); setKey(event.key); setDirectText(captured.label); setSaved(false);
            return;
          }
        }
        if (event.key === 'Enter') {
          event.stopPropagation();
          if (!composing && !event.nativeEvent.isComposing) { event.preventDefault(); if (onSend) send(); else add(); }
        }
      }} style={styles.input} />
    {showKeyButtons && <span style={{ ...styles.label, wordBreak: 'keep-all' }}>{t('keyCombinationCaptureHint')}</span>}
    </>}
    {footerTarget ? createPortal(actions, footerTarget) : actions}
  </section>;
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column', gap: space['2'], padding: space['3'], minWidth: 0 },
  modifiers: { display: 'flex', gap: space['2'] },
  keyboard: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  summary: { display: 'flex', alignItems: 'center', gap: space['2'] },
  reset: { width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, border: `1px solid ${color.border}`, borderRadius: radius.sm,
    background: color.surface0, color: color.subtext, cursor: 'pointer' },
  keyGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: space['1'] },
  button: { minHeight: 32, padding: `0 ${space['3']}`, border: '1px solid', borderRadius: radius.sm,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: space['1'],
    fontFamily: 'inherit', fontSize: fontSize['13'], cursor: 'pointer' },
  label: { fontSize: fontSize['12'], color: color.subtext },
  input: { minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 36,
    padding: space['2'], border: `1px solid ${color.border}`, borderRadius: radius.sm,
    background: color.base, color: color.text, fontSize: fontSize['16'], fontFamily: 'inherit' },
  preview: { flex: 1, minWidth: 0, minHeight: 24, color: color.text, fontSize: fontSize['13'], overflowWrap: 'anywhere' },
};
