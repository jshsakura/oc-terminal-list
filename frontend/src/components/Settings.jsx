import { useEffect, useState } from 'react';
import {
  X, RotateCcw, SlidersHorizontal, Server, Key as KeyIcon, Plus,
  Settings as GearIcon, ChevronRight, LogOut,
} from 'lucide-react';
import { themeNames } from '../styles/themes';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import HostIcon from '../utils/hostIcons';
import { tokens } from '../styles/tokens';
import { DEFAULT_TERMINAL_FONT_FAMILY } from '../utils/terminalFonts';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const HOST_DOT_PALETTE_FALLBACK = '#89b4fa';

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

const TABS = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'general',     fallback: 'General' },
  { id: 'hosts',   icon: Server,            labelKey: 'manageHosts', fallback: 'Hosts' },
  { id: 'keys',    icon: KeyIcon,           labelKey: 'sshKeys',     fallback: 'SSH Keys' },
];

const Settings = ({
  isOpen, onClose, settings, onSave, username,
  hosts = [], sshKeys = [],
  onAddHost, onEditHost,
  onAddKey,  onEditKey,
  onLogout,
}) => {
  const { t } = useTranslation(settings.language);
  const [s, setS] = useState(settings);
  const [tab, setTab] = useState('general');

  useEffect(() => { setS(settings); }, [settings]);
  useEffect(() => { if (isOpen) setTab('general'); }, [isOpen]);

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
          <div style={styles.title}>
            <GearIcon size={14} strokeWidth={1.8} style={{ color: color.subtext }} />
            {t('settingsTitle')}
          </div>
          <button onClick={onClose} title={t('cancel')} style={styles.closeBtn}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <nav style={styles.tabBar}>
          {TABS.map((tabDef) => {
            const Icon = tabDef.icon;
            const active = tab === tabDef.id;
            return (
              <button
                key={tabDef.id}
                onClick={() => setTab(tabDef.id)}
                style={{
                  ...styles.tabBtn,
                  background: active ? color.surface1 : 'transparent',
                  color: active ? color.text : color.subtext,
                  borderColor: active ? color.borderStrong : 'transparent',
                }}
              >
                <Icon size={13} strokeWidth={1.8} />
                <span>{t(tabDef.labelKey) || tabDef.fallback}</span>
              </button>
            );
          })}
        </nav>

        <div style={styles.body}>
          {tab === 'general' && (
            <GeneralPanel s={s} change={change} username={username} onLogout={onLogout} t={t} />
          )}
          {tab === 'hosts' && (
            <HostsPanel hosts={hosts} onAdd={onAddHost} onEdit={onEditHost} t={t} />
          )}
          {tab === 'keys' && (
            <KeysPanel keys={sshKeys} onAdd={onAddKey} onEdit={onEditKey} t={t} />
          )}
        </div>

        <footer style={styles.footer}>
          {tab === 'general' ? (
            <>
              <Button variant="ghost" onClick={reset} icon={RotateCcw}>{t('reset')}</Button>
              <div style={{ display: 'flex', gap: space['1.5'] }}>
                <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
                <Button variant="primary" onClick={save}>{t('save')}</Button>
              </div>
            </>
          ) : (
            <>
              <span style={styles.footerNote}>
                {tab === 'hosts'
                  ? `${hosts.length} ${t('savedHosts') || 'hosts'}`
                  : `${sshKeys.length} ${t('keys') || 'keys'}`}
              </span>
              <Button variant="secondary" onClick={onClose}>{t('close') || 'Close'}</Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

const GeneralPanel = ({ s, change, username, onLogout, t }) => (
  <>
    <Section title={t('account') || 'Account'}>
      {username && (
        <Field label={t('user')}>
          <div style={{ ...styles.readonly, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{username}</span>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                style={styles.inlineLogoutBtn}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                <LogOut size={11} strokeWidth={2} />
                <span>{t('logout') || 'Logout'}</span>
              </button>
            )}
          </div>
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
      <Field
        label={t('localStartPath') || 'This machine — start path'}
        hint={t('localStartPathHint') || 'Workspace-relative path. Empty = workspace root.'}
      >
        <input
          type="text"
          value={s.localStartPath || ''}
          onChange={(e) => change('localStartPath', e.target.value)}
          placeholder="projects/my-app"
          style={styles.input}
        />
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
        label={`${t('scrollSensitivity')} · ${(s.scrollSensitivity ?? 0.8).toFixed(1)}`}
        hint={t('scrollSensitivityHint')}
      >
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={s.scrollSensitivity ?? 0.8}
          onChange={(e) => change('scrollSensitivity', parseFloat(e.target.value))}
          style={styles.slider}
        />
      </Field>
    </Section>
  </>
);

const HostsPanel = ({ hosts, onAdd, onEdit, t }) => (
  <Section title={t('savedHosts') || 'Saved hosts'}>
    {hosts.length === 0 && (
      <div style={styles.empty}>{t('noHostsYet') || 'No hosts yet. Add one to get started.'}</div>
    )}
    <div style={styles.list}>
      {hosts.map((host) => {
        const palette = tokens.color.dotPalette || [HOST_DOT_PALETTE_FALLBACK];
        const accent = palette[(host.color_index || 0) % palette.length] || HOST_DOT_PALETTE_FALLBACK;
        return (
          <button
            key={host.id}
            type="button"
            onClick={() => onEdit?.(host)}
            style={styles.listRow}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
          >
            <span style={{ ...styles.listIcon, color: accent }}>
              <HostIcon value={host.icon || ''} fallback={Server} size={14} />
            </span>
            <div style={styles.listText}>
              <div style={styles.listName}>{host.name}</div>
              <div style={styles.listSub}>
                {host.ssh_user}@{host.hostname}
                {host.port && host.port !== 22 ? `:${host.port}` : ''}
              </div>
            </div>
            <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
          </button>
        );
      })}
    </div>
    {onAdd && (
      <button type="button" onClick={onAdd} style={styles.addRow}>
        <Plus size={13} strokeWidth={2} />
        <span>{t('addHost') || 'Add host'}</span>
      </button>
    )}
  </Section>
);

const KeysPanel = ({ keys, onAdd, onEdit, t }) => (
  <Section title={t('sshKeys') || 'SSH Keys'}>
    {keys.length === 0 && (
      <div style={styles.empty}>{t('noKeys') || 'No SSH keys yet'}</div>
    )}
    <div style={styles.list}>
      {keys.map((key) => (
        <button
          key={key.id}
          type="button"
          onClick={() => onEdit?.(key)}
          style={styles.listRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: color.accent }}>
            <KeyIcon size={14} strokeWidth={1.8} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{key.name}</div>
            <div style={styles.listSub}>
              {key.public_key ? key.public_key.split(' ')[0] : (t('privateKey') || 'Private key')}
            </div>
          </div>
          <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
        </button>
      ))}
    </div>
    {onAdd && (
      <button type="button" onClick={onAdd} style={styles.addRow}>
        <Plus size={13} strokeWidth={2} />
        <span>{t('addKey') || 'Add SSH key'}</span>
      </button>
    )}
  </Section>
);

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
    maxWidth: '520px',
    height: '88vh',
    maxHeight: '720px',
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
    flexShrink: 0,
  },
  title: {
    fontSize: fontSize['14'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
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
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: `8px ${space['3']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.mantle,
    overflowX: 'auto',
    flexShrink: 0,
  },
  tabBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '30px',
    padding: `0 ${space['3']}`,
    background: 'transparent',
    border: `1px solid transparent`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
    flexShrink: 0,
  },
  body: {
    padding: `${space['3']} ${space['4']}`,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: color.text,
    textAlign: 'left',
    transition: `background ${motion.fast}`,
  },
  listIcon: {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  listText: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  listName: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  listSub: {
    fontSize: '10.5px',
    color: color.muted,
    fontFamily: font.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  addRow: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    width: '100%',
    height: '34px',
    background: 'transparent',
    border: `1px dashed ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    fontFamily: 'inherit',
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    marginTop: space['1'],
    transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
  },
  empty: {
    padding: `${space['4']} 0`,
    fontSize: fontSize['12'],
    color: color.muted,
    textAlign: 'center',
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
    flexShrink: 0,
  },
  footerNote: {
    fontSize: fontSize['11'],
    color: color.muted,
  },
  inlineLogoutBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: '24px',
    padding: `0 10px`,
    background: color.danger,
    border: `1px solid ${color.danger}`,
    borderRadius: radius.xs,
    cursor: 'pointer',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'inherit',
    fontWeight: fontWeight.semibold,
    transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}, opacity ${motion.fast}`,
  },
};

export default Settings;
