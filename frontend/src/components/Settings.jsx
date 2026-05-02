import { useEffect, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { themeNames } from '../styles/themes';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import { DEFAULT_TERMINAL_FONT_FAMILY } from '../utils/terminalFonts';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const DEFAULTS = {
  theme: 'catppuccin',
  language: 'en',
  fontSize: 14,
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  defaultShell: 'bash',
  autoScroll: 'smart',
  smoothScroll: true,
  scrollSensitivity: 0.8,
};

const Settings = ({ isOpen, onClose, settings, onSave, username }) => {
  const { t } = useTranslation(settings.language);
  const [s, setS] = useState(settings);

  useEffect(() => { setS(settings); }, [settings]);

  if (!isOpen) return null;

  const change = (key, value) => setS((p) => ({ ...p, [key]: value }));
  const save = () => { onSave(s); onClose(); };
  const reset = () => {
    if (confirm(t('reset'))) { onSave(DEFAULTS); onClose(); }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.title}>{t('settingsTitle')}</div>
          <button onClick={onClose} title={t('cancel')} style={styles.closeBtn}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          <Section title={t('account') || 'Account'}>
            {username && (
              <Field label={t('user')}>
                <div style={styles.readonly}>{username}</div>
              </Field>
            )}
            <Field label={t('defaultShell')}>
              <Select value={s.defaultShell || 'bash'} onChange={(v) => change('defaultShell', v)}>
                <option value="bash">{t('shellBash')}</option>
                <option value="zsh">{t('shellZsh')}</option>
                <option value="sh">{t('shellSh')}</option>
                <option value="auto">{t('shellAuto')}</option>
              </Select>
            </Field>
          </Section>

          <Divider />

          <Section title={t('appearance') || 'Appearance'}>
            <Field label={t('theme')}>
              <Select value={s.theme} onChange={(v) => change('theme', v)}>
                {themeNames.map((name) => {
                  const key = `theme${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                  return <option key={name} value={name}>{t(key) || name}</option>;
                })}
              </Select>
            </Field>
            <Field label={t('language')}>
              <Select value={s.language} onChange={(v) => change('language', v)}>
                <option value="en">{t('languageEnglish')}</option>
                <option value="ko">{t('languageKorean')}</option>
              </Select>
            </Field>
            <Field label={t('fontSize')}>
              <input
                type="number"
                min="10"
                max="24"
                value={s.fontSize}
                onChange={(e) => change('fontSize', parseInt(e.target.value, 10))}
                style={styles.input}
              />
            </Field>
          </Section>

          <Divider />

          <Section title={t('scrollBehavior') || 'Scroll'}>
            <Field label={t('autoScroll')}>
              <Select value={s.autoScroll} onChange={(v) => change('autoScroll', v)}>
                <option value="always">{t('autoScrollAlways') || 'Always'}</option>
                <option value="smart">{t('autoScrollSmart') || 'Smart'}</option>
                <option value="never">{t('autoScrollNever') || 'Manual'}</option>
              </Select>
            </Field>
            <Toggle
              label={t('smoothScroll')}
              checked={s.smoothScroll}
              onChange={(v) => change('smoothScroll', v)}
            />
            <Field
              label={`${t('scrollSensitivity')} · ${s.scrollSensitivity.toFixed(1)}`}
              hint={t('scrollSensitivityHint')}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={s.scrollSensitivity}
                onChange={(e) => change('scrollSensitivity', parseFloat(e.target.value))}
                style={styles.slider}
              />
            </Field>
          </Section>
        </div>

        <footer style={styles.footer}>
          <Button variant="ghost" onClick={reset} icon={RotateCcw}>{t('reset')}</Button>
          <div style={{ display: 'flex', gap: space['1.5'] }}>
            <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
            <Button variant="primary" onClick={save}>{t('save')}</Button>
          </div>
        </footer>
      </div>
    </div>
  );
};

const Section = ({ title, children }) => (
  <section style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionBody}>{children}</div>
  </section>
);

const Divider = () => <div style={styles.divider} />;

const Field = ({ label, hint, children }) => (
  <div style={styles.field}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

const Select = ({ value, onChange, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.input,
        borderColor: hover ? color.borderStrong : color.border,
        appearance: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
};

const Toggle = ({ label, checked, onChange }) => (
  <label style={styles.toggleRow}>
    <span style={styles.toggleLabel}>{label}</span>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        ...styles.toggle,
        background: checked ? color.accent : color.surface1,
      }}
    >
      <span
        style={{
          ...styles.toggleKnob,
          transform: checked ? 'translateX(14px)' : 'translateX(0)',
        }}
      />
    </button>
  </label>
);

const styles = {
  overlay: {
    position: 'fixed',
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
    maxWidth: '480px',
    maxHeight: '86vh',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: tokens.shadow.lg,
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
  title: {
    fontSize: fontSize['14'],
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  closeBtn: {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.muted,
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
  },
  body: {
    padding: `${space['3']} ${space['4']}`,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    paddingTop: space['1'],
    paddingBottom: space['1'],
  },
  sectionTitle: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.muted,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: space['1'],
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['3'],
  },
  divider: {
    height: '1px',
    background: color.border,
    margin: `${space['3']} 0`,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1'],
  },
  label: {
    fontSize: fontSize['12'],
    color: color.subtext,
    fontWeight: fontWeight.medium,
  },
  input: {
    width: '100%',
    height: '32px',
    padding: `0 ${space['3']}`,
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    outline: 'none',
    transition: `border-color ${motion.fast}`,
  },
  readonly: {
    width: '100%',
    height: '32px',
    padding: `0 ${space['3']}`,
    display: 'flex',
    alignItems: 'center',
    background: color.mantle,
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: font.mono,
  },
  hint: {
    fontSize: fontSize['11'],
    color: color.muted,
    marginTop: space['0.5'],
  },
  slider: {
    width: '100%',
    accentColor: color.accent,
    cursor: 'pointer',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
  },
  toggleLabel: {
    fontSize: fontSize['13'],
    color: color.text,
  },
  toggle: {
    position: 'relative',
    width: '30px',
    height: '16px',
    border: 'none',
    borderRadius: radius.full,
    cursor: 'pointer',
    transition: `background ${motion.fast}`,
    padding: 0,
  },
  toggleKnob: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    background: '#fff',
    borderRadius: radius.full,
    transition: `transform ${motion.fast}`,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default Settings;
