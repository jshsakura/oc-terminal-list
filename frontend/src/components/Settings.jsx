import { useEffect, useState } from 'react';
import {
  RotateCcw, SlidersHorizontal, Server, Key as KeyIcon,
  Settings as GearIcon, Smartphone, HelpCircle,
} from 'lucide-react';
import GlassModal from './common/GlassModal';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import { DEFAULT_SETTINGS } from '../hooks/useSettings';
import { styles } from './settings/settingsStyles';
import { GeneralPanel, MobilePanel, HostsPanel, KeysPanel, InfoPanel } from './settings/SettingsPanels';

const { color, space } = tokens;

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

export default Settings;
