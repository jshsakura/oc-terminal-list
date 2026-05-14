import { useEffect, useState } from 'react';
import { X, Folder, ChevronDown } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import IconPickerPopup from './IconPickerPopup';
import ThemePicker from './common/ThemePicker';

const { color, font, fontSize, fontWeight, radius, space, motion, shadow } = tokens;

/**
 * "현재 머신" 카드의 외형/시작경로 편집 모달.
 * 호스트와 달리 연결 정보가 없으니 4가지 (이름/아이콘/색/시작경로) 만 다룬다.
 * 저장은 useSettings 의 localName/localIcon/localColorIndex/localStartPath 로 흘러간다.
 */
const LocalEditor = ({ isOpen, settings, onSave, onClose, onPickFolder, t }) => {
  const [draft, setDraft] = useState({
    localName: '',
    localIcon: '',
    localColorIndex: 0,
    localStartPath: '',
    localTheme: '',
  });
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft({
      localName: settings?.localName || '',
      localIcon: settings?.localIcon || '',
      localColorIndex: settings?.localColorIndex ?? 0,
      localStartPath: settings?.localStartPath || '',
      localTheme: settings?.localTheme || '',
    });
  }, [isOpen, settings]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e) => {
    e?.preventDefault?.();
    onSave?.(draft);
    onClose?.();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <form onSubmit={submit} style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.title}>
            {t?.('editLocalMachine') || 'Edit this machine'}
          </div>
          <button type="button" onClick={onClose} style={styles.closeBtn} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          <Field label={t?.('hostName') || 'Display name'} hint={t?.('localNameHint') || 'Empty = "This machine".'}>
            <Input
              value={draft.localName}
              onChange={(v) => set('localName', v)}
              placeholder={t?.('thisMachine') || 'This machine'}
              autoFocus
            />
          </Field>

          <Field label={t?.('icon') || 'Icon'}>
            <button
              type="button"
              onClick={() => setIconPickerOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                height: '32px',
                padding: `0 10px`,
                background: color.mantle,
                color: color.text,
                border: `1px solid ${color.border}`,
                borderRadius: radius.sm,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: fontSize['12'],
                alignSelf: 'flex-start',
              }}
            >
              <HostIcon value={draft.localIcon} size={16} />
              <span style={{ color: draft.localIcon ? color.text : color.muted }}>
                {draft.localIcon || (t?.('chooseIcon') || 'Choose icon…')}
              </span>
              <ChevronDown size={12} strokeWidth={1.8} style={{ color: color.muted }} />
            </button>
          </Field>

          <Field label={t?.('color') || 'Color'}>
            <ColorPicker value={draft.localColorIndex} onChange={(v) => set('localColorIndex', v)} />
          </Field>

          <Field
            label={t?.('localStartPath') || 'Default start path'}
            hint={t?.('localStartPathHint') || 'Workspace-relative path. Empty = workspace root.'}
          >
            <div style={{ display: 'flex', gap: '6px' }}>
              <Input
                value={draft.localStartPath}
                onChange={(v) => set('localStartPath', v)}
                placeholder=""
              />
              {onPickFolder && (
                <button
                  type="button"
                  onClick={() => onPickFolder(draft.localStartPath, (chosen) => set('localStartPath', chosen))}
                  title={t?.('pickFolder') || 'Pick a folder'}
                  style={styles.pickBtn}
                >
                  <Folder size={13} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </Field>

          <Field label={t?.('terminalTheme') || 'Terminal color'}>
            <ThemePicker
              value={draft.localTheme || ''}
              onChange={(v) => set('localTheme', v)}
              allowEmpty
              markedId={settings?.theme || 'default'}
              t={t}
              columns={2}
            />
          </Field>
        </div>

        <footer style={styles.footer}>
          <Button variant="secondary" onClick={onClose} type="button">
            {t?.('cancel') || 'Cancel'}
          </Button>
          <Button variant="primary" type="submit">
            {t?.('save') || 'Save'}
          </Button>
        </footer>
      </form>

      <IconPickerPopup
        isOpen={iconPickerOpen}
        value={draft.localIcon || ''}
        onChange={(v) => set('localIcon', v)}
        onClose={() => setIconPickerOpen(false)}
        t={t}
      />
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div style={styles.field}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

const Input = ({ value, onChange, placeholder, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        ...styles.input,
        borderColor: focused ? color.accentBorder : color.border,
        background: focused ? color.crust : color.mantle,
      }}
    />
  );
};

const ColorPicker = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: space['1.5'], flexWrap: 'wrap' }}>
    {color.dotPalette.map((c, i) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(i)}
        style={{
          width: '22px',
          height: '22px',
          padding: 0,
          background: c,
          border: i === value ? `2px solid ${color.text}` : `2px solid transparent`,
          borderRadius: radius.full,
          cursor: 'pointer',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
          transition: `border-color ${motion.fast}`,
        }}
      />
    ))}
  </div>
);

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '92%',
    maxWidth: '440px',
    maxHeight: '88vh',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: color.muted, border: 'none', borderRadius: radius.xs,
    cursor: 'pointer', padding: 0,
  },
  body: {
    padding: `${space['3']} ${space['4']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['3'],
    overflowY: 'auto',
  },
  field: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  label: { fontSize: fontSize['12'], color: color.subtext, fontWeight: fontWeight.medium },
  input: {
    width: '100%',
    height: '32px',
    padding: `0 ${space['3']}`,
    background: color.mantle,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    outline: 'none',
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
  hint: { fontSize: fontSize['11'], color: color.muted, marginTop: space['0.5'] },
  pickBtn: {
    width: '34px',
    height: '32px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    flexShrink: 0,
    padding: 0,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: space['1.5'],
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default LocalEditor;
