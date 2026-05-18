import { useEffect, useState } from 'react';
import {
  RotateCcw, SlidersHorizontal, Server, Key as KeyIcon, Plus,
  Settings as GearIcon, ChevronRight, LogOut, Smartphone, ChevronDown,
  HelpCircle,
} from 'lucide-react';
import ThemePicker from './common/ThemePicker';
import GlassModal from './common/GlassModal';
import useHostReorder from '../hooks/useHostReorder';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import HostIcon from '../utils/hostIcons';
import OtpSection from './OtpSection';
import MobileKeysEditor from './MobileKeysEditor';
import { tokens } from '../styles/tokens';
import { DEFAULT_SETTINGS } from '../hooks/useSettings';
import { DEFAULT_MOBILE_KEYS } from '../utils/mobileKeys';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const HOST_DOT_PALETTE_FALLBACK = '#89b4fa';

const TABS = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'general',     fallback: 'General' },
  { id: 'mobile',  icon: Smartphone,        labelKey: 'mobile',      fallback: 'Mobile' },
  { id: 'hosts',   icon: Server,            labelKey: 'manageHosts', fallback: 'Hosts' },
  { id: 'keys',    icon: KeyIcon,           labelKey: 'sshKeys',     fallback: 'SSH Keys' },
  { id: 'info',    icon: HelpCircle,        labelKey: 'infoShortcuts', fallback: 'Shortcuts' },
];

const SETTINGS_TABS = new Set(['general', 'mobile']);

const Settings = ({
  isOpen, onClose, settings, onSave, username,
  hosts = [], sshKeys = [], refreshHosts = null,
  onAddHost, onEditHost,
  onEditLocal,
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
    if (confirm(t('reset'))) { onSave(DEFAULT_SETTINGS); onClose(); }
  };

  const tabBar = (
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
              background: active ? `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 82%, transparent)` : 'transparent',
              color: active ? `var(--ui-text, ${color.text})` : `var(--ui-subtext, ${color.subtext})`,
              borderColor: active ? `color-mix(in srgb, var(--ui-border-strong, ${color.borderStrong}) 76%, transparent)` : 'transparent',
            }}
          >
            <Icon size={13} strokeWidth={1.8} />
            <span>{t(tabDef.labelKey) || tabDef.fallback}</span>
          </button>
        );
      })}
    </nav>
  );

  const footer = SETTINGS_TABS.has(tab) ? (
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
          ? `${(t('thisMachine') || 'This machine')} · ${hosts.length} ${t('savedHosts') || 'hosts'}`
          : tab === 'keys'
            ? `${sshKeys.length} ${t('keys') || 'keys'}`
            : t('infoShortcuts') || 'Shortcuts'}
      </span>
      <Button variant="secondary" onClick={onClose}>{t('close') || 'Close'}</Button>
    </>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('settingsTitle')}
      titleIcon={GearIcon}
      ariaLabel={t('settingsTitle')}
      closeTitle={t('cancel')}
      width="92%"
      maxWidth="780px"
      height="88vh"
      maxHeight="900px"
      afterHeader={tabBar}
      bodyStyle={styles.body}
      footer={footer}
      footerStyle={styles.footer}
    >
      {tab === 'general' && (
        <GeneralPanel s={s} change={change} username={username} onLogout={onLogout} t={t} />
      )}
      {tab === 'mobile' && (
        <MobilePanel s={s} change={change} t={t} />
      )}
      {tab === 'hosts' && (
        <HostsPanel
          hosts={hosts}
          settings={s}
          refreshHosts={refreshHosts}
          onAdd={onAddHost}
          onEdit={onEditHost}
          onEditLocal={onEditLocal}
          t={t}
        />
      )}
      {tab === 'keys' && (
        <KeysPanel keys={sshKeys} onAdd={onAddKey} onEdit={onEditKey} t={t} />
      )}
      {tab === 'info' && (
        <InfoPanel t={t} />
      )}
    </GlassModal>
  );
};

const GeneralPanel = ({ s, change, username, onLogout, t }) => (
  <>
    <Section title={t('account') || 'Account'}>
      {username && (
        <Field label={t('user')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space['2'] }}>
            <div style={{ ...styles.readonly, flex: 1 }}>
              {username}
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                style={styles.inlineLogoutBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.borderColor = color.muted; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.borderColor = color.border; }}
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

    <Section title={t('twoFactorAuth') || 'Two-factor authentication'}>
      <OtpSection t={t} />
    </Section>

    <Divider />

    <Section title={t('appearance') || 'Appearance'}>
      <Field label={t('theme')}>
        <ThemePicker value={s.theme} onChange={(v) => change('theme', v)} t={t} columns={2} />
      </Field>
      <Field label={t('language')}>
        <Select value={s.language} onChange={(v) => change('language', v)}>
          <option value="en">{t('languageEnglish')}</option>
          <option value="ko">{t('languageKorean')}</option>
        </Select>
      </Field>
      <Field label={`${t('fontSize')} (PC) · ${s.fontSize ?? 12}px`}>
        <FontSizeRow
          value={s.fontSize ?? 12}
          onChange={(v) => change('fontSize', v)}
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

const MobilePanel = ({ s, change, t }) => (
  <>
    <Section title={t('appearance') || 'Appearance'}>
      <Field
        label={`${t('fontSizeMobile') || 'Font size (Mobile)'} · ${s.fontSizeMobile ?? 13}px`}
        hint={t('mobileTabHint') || 'Settings that only apply on mobile devices.'}
      >
        <FontSizeRow
          value={s.fontSizeMobile ?? 13}
          onChange={(v) => change('fontSizeMobile', v)}
        />
      </Field>
    </Section>

    <Divider />

    <Section title={t('mobileKeys') || 'Mobile shortcut bar'}>
      <MobileKeysEditor
        keys={s.mobileKeys ?? DEFAULT_MOBILE_KEYS}
        onChange={(next) => change('mobileKeys', next)}
        t={t}
      />
    </Section>
  </>
);

const HostsPanel = ({ hosts, settings, refreshHosts, onAdd, onEdit, onEditLocal, t }) => {
  // 모든 사용처와 동일한 hook → 어디서 옮겨도 같은 서버 sort_index 로 동기.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);
  const localAccent = tokens.color.dotPalette[(settings?.localColorIndex ?? 0) % tokens.color.dotPalette.length] || HOST_DOT_PALETTE_FALLBACK;
  const localName = (settings?.localName || '').trim() || (t('thisMachine') || 'This machine');
  const localSub = [
    'localhost',
    (settings?.localStartPath || '').trim() || (t('noStartPath') || 'No start path'),
  ].join(' · ');
  return (
    <Section title={t('savedHosts') || 'Saved hosts'}>
      {/* 로컬 + 원격을 같은 list 컨테이너로 묶어 동일 4px gap — sectionBody 의 12px 간격으로 떨어지지 않게. */}
      <div style={styles.list}>
        <button
          type="button"
          onClick={() => onEditLocal?.()}
          style={styles.listRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: localAccent }}>
            <HostIcon value={settings?.localIcon || ''} fallback={Server} size={14} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{localName}</div>
            <div style={styles.listSub}>{localSub}</div>
          </div>
          <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
        </button>

        {hosts.length === 0 && (
          <div style={styles.empty}>{t('noHostsYet') || 'No hosts yet. Add one to get started.'}</div>
        )}
        {orderedHosts.map((host) => {
          const palette = tokens.color.dotPalette || [HOST_DOT_PALETTE_FALLBACK];
          const accent = palette[(host.color_index || 0) % palette.length] || HOST_DOT_PALETTE_FALLBACK;
          const rp = rowPropsFor(host);
          return (
            <div
              key={host.id}
              data-host-row={rp['data-host-row']}
              onPointerDown={rp.onPointerDown}
              onClick={() => onEdit?.(host)}
              onMouseEnter={(e) => { if (!rp.isDragOver) e.currentTarget.style.background = color.surface1; }}
              onMouseLeave={(e) => { if (!rp.isDragOver) e.currentTarget.style.background = color.surface0; }}
              style={{
                ...styles.listRow,
                cursor: rp.isDragging ? 'grabbing' : 'pointer',
                border: rp.isDragging
                  ? `1px solid ${color.accent}`
                  : (rp.isDragOver ? `2px dashed ${color.accent}` : `1px solid ${color.border}`),
                background: rp.isDragging
                  ? color.surface2
                  : (rp.isDragOver ? color.surface2 : color.surface0),
                boxShadow: rp.isDragging ? `0 6px 18px ${color.accent}40` : 'none',
                transform: rp.isDragging ? 'translateY(-1px) scale(1.005)' : 'none',
                transition: 'background 120ms, border-color 120ms, box-shadow 120ms',
                touchAction: 'pan-y',
                userSelect: 'none',
              }}
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
            </div>
          );
        })}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={styles.addRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: color.accent }}>
            <Plus size={14} strokeWidth={2} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{t('addHost') || 'Add host'}</div>
          </div>
        </button>
      )}
    </Section>
  );
};

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
      <button
        type="button"
        onClick={onAdd}
        style={styles.addRow}
        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
      >
        <span style={{ ...styles.listIcon, color: color.accent }}>
          <Plus size={14} strokeWidth={2} />
        </span>
        <div style={styles.listText}>
          <div style={styles.listName}>{t('addKey') || 'Add SSH key'}</div>
        </div>
      </button>
    )}
  </Section>
);

const InfoPanel = ({ t }) => (
  <Section title={t('infoShortcuts') || 'Shortcuts'}>
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={[t('drag') || 'Drag']} desc={t('shortcutSelect') || 'Select text (auto-copy)'} />
      <ShortcutRow keys={[t('doubleClick') || 'Double-click']} desc={t('shortcutSelectWord') || 'Select word'} />
      <ShortcutRow keys={[t('tripleClick') || 'Triple-click']} desc={t('shortcutSelectLine') || 'Select line'} />
      <ShortcutRow keys={[t('rightClick') || 'Right-click']} desc={t('shortcutContextMenu') || 'Context menu'} />
      <ShortcutRow keys={[t('wheel') || 'Wheel']} desc={t('shortcutScroll') || 'Scroll terminal history'} />
    </div>
    <Divider />
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={['Ctrl', 'V']} desc={t('shortcutPaste') || 'Paste (bracketed)'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'C']} desc={t('shortcutCopy') || 'Copy selection'} />
      <ShortcutRow keys={['Ctrl', 'C']} desc={t('shortcutSigint') || 'Interrupt (SIGINT)'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'F']} desc={t('shortcutSearch') || 'Find in terminal'} />
      <ShortcutRow keys={['F12']} desc={t('shortcutDevtools') || 'Open DevTools'} />
    </div>
    <Divider />
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={['Ctrl', 'Shift', 'P']} desc={t('shortcutCommandPalette') || 'Command palette'} />
      <ShortcutRow keys={['Ctrl', 'T']} desc={t('shortcutNewTab') || 'New tab'} />
      <ShortcutRow keys={['Ctrl', 'W']} desc={t('shortcutCloseTab') || 'Close tab'} />
      <ShortcutRow keys={['Ctrl', '\\']} desc={t('shortcutSplitRight') || 'Split right'} />
      <ShortcutRow keys={['Ctrl', 'Shift', '\\']} desc={t('shortcutSplitDown') || 'Split down'} />
      <ShortcutRow keys={['Ctrl', 'P']} desc={t('shortcutQuickOpen') || 'Quick open files'} />
      <ShortcutRow keys={['Ctrl', 'S']} desc={t('shortcutSave') || 'Save file'} />
    </div>
  </Section>
);

const ShortcutRow = ({ keys, desc }) => (
  <div style={shortcutStyles.row}>
    <div style={shortcutStyles.keys}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} style={shortcutStyles.kbd}>{key}</span>
      ))}
    </div>
    <div style={shortcutStyles.desc}>{desc}</div>
  </div>
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
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
          paddingRight: '28px',
          width: '100%',
        }}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: '8px',
          pointerEvents: 'none',
          color: color.muted,
          flexShrink: 0,
        }}
      />
    </div>
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

// 폰트 크기 — 숫자 input + 슬라이더 + ± 버튼 한 줄. 변경 빠르게.
const FontSizeRow = ({ value, onChange, min = 8, max = 28 }) => {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const set = (v) => onChange(clamp(parseInt(v, 10) || min));
  return (
    <div style={fszStyles.row}>
      <button
        type="button"
        style={fszStyles.btn}
        onClick={() => set(value - 1)}
        title="-1"
        aria-label="decrease font size"
      >−</button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={fszStyles.input}
      />
      <button
        type="button"
        style={fszStyles.btn}
        onClick={() => set(value + 1)}
        title="+1"
        aria-label="increase font size"
      >+</button>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={fszStyles.slider}
      />
    </div>
  );
};

const fszStyles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
  },
  input: {
    width: '52px',
    height: '28px',
    padding: '0 6px',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    outline: 'none',
    textAlign: 'center',
    flexShrink: 0,
  },
  btn: {
    width: '28px',
    height: '28px',
    background: color.surface0,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  slider: {
    flex: 1,
    accentColor: color.accent,
    cursor: 'pointer',
    minWidth: 0,
  },
};

const shortcutStyles = {
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
    minHeight: '26px',
    padding: '4px 6px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  keys: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  kbd: {
    minHeight: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 6px',
    borderRadius: '5px',
    background: color.mantle,
    border: `1px solid ${color.border}`,
    color: color.text,
    fontFamily: font.mono,
    fontSize: '11px',
    lineHeight: 1,
  },
  desc: {
    minWidth: 0,
    color: color.subtext,
    fontSize: fontSize['12'],
    textAlign: 'right',
    lineHeight: 1.35,
  },
};

const styles = {
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: `8px ${space['3']}`,
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 44%, transparent)`,
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
    minHeight: '44px',
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
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '44px',
    padding: '8px 10px',
    width: '100%',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: color.text,
    textAlign: 'left',
    marginTop: space['1'],
    transition: `background ${motion.fast}`,
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
    flexShrink: 0,
    gap: '5px',
    height: '32px',
    padding: `0 ${space['3']}`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    fontWeight: fontWeight.medium,
    transition: `background ${motion.fast}, border-color ${motion.fast}`,
  },
};

export default Settings;
