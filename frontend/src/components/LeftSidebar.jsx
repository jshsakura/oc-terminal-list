import { useState, memo } from 'react';
import {
  Server, Key, Settings as SettingsIcon, Power,
  X, Plus, Monitor,
} from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const PANEL_WIDTH = 280;
const ACTIVITY_WIDTH = 48;

const HOST_COLORS = [
  '#89b4fa', '#a6e3a1', '#fab387', '#f38ba8',
  '#cba6f7', '#89dceb', '#f9e2af', '#b4befe',
];

const TOP_TABS = [
  { id: 'hosts', icon: Server, label: 'Hosts' },
  { id: 'keys',  icon: Key,    label: 'SSH Keys' },
];

/**
 * Left sidebar — always-visible activity bar + collapsible panel.
 * Click an icon to toggle the panel; click again to close.
 */
const LeftSidebar = ({
  hosts = [],
  onConnectHost,
  onAddHost,
  onEditHost,
  onDeleteHost,
  sshKeys = [],
  onAddKey,
  onEditKey,
  onDeleteKey,
  onOpenSettings,
  onLogout,
  activePanel: activePanelProp,
  onActivePanelChange,
  isMobile = false,
  t,
}) => {
  const [internalPanel, setInternalPanel] = useState(null);
  const isControlled = activePanelProp !== undefined;
  const activePanel = isControlled ? activePanelProp : internalPanel;
  const setActivePanel = (next) => {
    if (isControlled) onActivePanelChange?.(typeof next === 'function' ? next(activePanel) : next);
    else setInternalPanel(next);
  };

  const toggle = (id) => setActivePanel((prev) => (prev === id ? null : id));

  const activeMeta = TOP_TABS.find((tab) => tab.id === activePanel);

  return (
    <div style={styles.root}>
      {/* activity bar */}
      <div style={styles.activityBar}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: `10px 0`, flex: 1 }}>
          {TOP_TABS.map(({ id, icon: Icon, label }) => (
            <ActIcon
              key={id}
              isActive={activePanel === id}
              Icon={Icon}
              label={label}
              onClick={() => toggle(id)}
            />
          ))}
        </div>

        {/* footer: settings + logout */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: `8px 0 10px`,
          borderTop: `1px solid ${color.border}`,
        }}>
          <ActIcon
            isActive={false}
            Icon={SettingsIcon}
            label={t?.('settings') || 'Settings'}
            onClick={onOpenSettings}
          />
          <ActIcon
            isActive={false}
            Icon={Power}
            label={t?.('logout') || 'Logout'}
            tone="danger"
            onClick={onLogout}
          />
        </div>
      </div>

      {/* collapsible panel — mobile 에선 overlay, desktop 에선 inline */}
      {activePanel && isMobile && (
        <div
          onClick={() => setActivePanel(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 198,
          }}
        />
      )}
      {activePanel && (
        <div style={{
          ...styles.panel,
          width: `${PANEL_WIDTH}px`,
          ...(isMobile ? {
            position: 'fixed', top: 0, bottom: 0, left: `${ACTIVITY_WIDTH}px`,
            zIndex: 199,
            boxShadow: '4px 0 16px rgba(0,0,0,0.4)',
          } : {}),
        }}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>{activeMeta?.label}</span>
            <CloseBtn onClick={() => setActivePanel(null)} />
          </div>
          <div style={styles.panelBody}>
            {activePanel === 'hosts' && (
              <HostsPanel
                hosts={hosts}
                onConnect={(host) => { onConnectHost?.(host); if (isMobile) setActivePanel(null); }}
                onAdd={onAddHost}
                onEdit={onEditHost}
                t={t}
              />
            )}
            {activePanel === 'keys' && (
              <KeysPanel
                keys={sshKeys}
                onAdd={onAddKey}
                onEdit={onEditKey}
                t={t}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ActIcon = memo(({ isActive, Icon, label, tone, onClick }) => (
  <button
    onClick={onClick}
    title={label}
    style={{
      position: 'relative',
      width: '36px',
      height: '36px',
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: isActive ? color.accentSubtle : 'transparent',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      color: isActive
        ? color.accent
        : tone === 'danger'
          ? color.danger
          : color.subtext,
      transition: 'background 150ms, color 150ms',
      padding: 0,
    }}
    onMouseEnter={(e) => {
      if (!isActive) {
        e.currentTarget.style.background = color.surface0;
        e.currentTarget.style.color = tone === 'danger' ? color.danger : color.text;
      }
    }}
    onMouseLeave={(e) => {
      if (!isActive) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = tone === 'danger' ? color.danger : color.subtext;
      }
    }}
  >
    {/* active indicator strip */}
    {isActive && (
      <div style={{
        position: 'absolute',
        left: '-6px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '3px',
        height: '18px',
        background: color.accent,
        borderRadius: '0 2px 2px 0',
      }} />
    )}
    <Icon size={17} strokeWidth={1.7} />
  </button>
));

const HostsPanel = ({ hosts, onConnect, onAdd, onEdit, t }) => (
  <div>
    <ListRow
      accent={color.accent}
      icon={<Monitor size={14} strokeWidth={1.8} />}
      name={t?.('thisMachine') || 'This machine'}
      sub="localhost"
      onClick={() => onConnect({ id: 'local', isLocal: true })}
    />

    {hosts.length > 0 && (
      <div style={styles.sectionLabel}>
        {t?.('savedHosts') || 'Saved hosts'}
      </div>
    )}

    {hosts.map((host) => {
      const accent = HOST_COLORS[host.color_index % HOST_COLORS.length] || color.accent;
      return (
        <ListRow
          key={host.id}
          accent={accent}
          icon={host.icon
            ? <span style={{ fontSize: '14px', lineHeight: 1 }}>{host.icon}</span>
            : <Server size={13} strokeWidth={1.8} />
          }
          name={host.name}
          sub={`${host.ssh_user}@${host.hostname}`}
          onClick={() => onConnect(host)}
          actions={
            <RowBtn onClick={(e) => { e.stopPropagation(); onEdit?.(host); }} title={t?.('hostSettings') || 'Settings'}>
              <SettingsIcon size={12} strokeWidth={1.8} />
            </RowBtn>
          }
        />
      );
    })}

    <PlusRow onClick={onAdd} label={t?.('addHost') || 'Add host'} />
  </div>
);

const KeysPanel = ({ keys, onAdd, onEdit, t }) => (
  <div>
    {keys.length === 0 && (
      <div style={{ padding: space['4'], fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
        {t?.('noKeys') || 'No SSH keys yet'}
      </div>
    )}
    {keys.map((key) => (
      <ListRow
        key={key.id}
        accent={color.accent}
        icon={<Key size={13} strokeWidth={1.8} />}
        name={key.name}
        sub={key.public_key ? key.public_key.split(' ')[0] : 'Private key'}
        onClick={() => onEdit?.(key)}
        actions={
          <RowBtn onClick={(e) => { e.stopPropagation(); onEdit?.(key); }} title={t?.('editKey') || 'Settings'}>
            <SettingsIcon size={12} strokeWidth={1.8} />
          </RowBtn>
        }
      />
    ))}
    <PlusRow onClick={onAdd} label={t?.('addKey') || 'Add SSH key'} />
  </div>
);

const ListRow = ({ accent, icon, name, sub, onClick, actions }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: `8px 12px`,
      cursor: 'pointer',
      transition: 'background 120ms',
      fontFamily: font.sans,
      borderRadius: '6px',
      margin: '1px 6px',
    }}
    onClick={onClick}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <div style={{
      width: '20px', height: '20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: accent, flexShrink: 0,
    }}>
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: fontSize['12'], fontWeight: fontWeight.medium, color: color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
        {name}
      </div>
      {sub && (
        <div style={{ fontSize: '10.5px', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
          {sub}
        </div>
      )}
    </div>
    {actions && (
      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    )}
  </div>
);

const PlusRow = ({ onClick, label }) => (
  <div style={{ padding: '8px 6px', borderTop: `1px solid ${color.border}`, marginTop: '4px' }}>
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        width: '100%', padding: '7px',
        background: 'transparent',
        border: `1px dashed ${color.border}`,
        borderRadius: '6px',
        cursor: 'pointer', color: color.subtext, fontSize: fontSize['12'],
        fontWeight: fontWeight.medium, fontFamily: font.sans,
        transition: 'background 150ms, border-color 150ms, color 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = color.border; e.currentTarget.style.color = color.subtext; }}
    >
      <Plus size={13} strokeWidth={2} />
      {label}
    </button>
  </div>
);

const RowBtn = ({ onClick, title, tone, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: '22px', height: '22px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: '3px',
      cursor: 'pointer',
      color: tone === 'danger' ? color.danger : color.subtext,
      transition: 'background 120ms, color 120ms',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.surface2;
      e.currentTarget.style.color = tone === 'danger' ? color.danger : color.text;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = tone === 'danger' ? color.danger : color.subtext;
    }}
  >
    {children}
  </button>
);

const CloseBtn = ({ onClick }) => (
  <button
    onClick={onClick}
    style={{
      background: 'transparent', border: 'none', cursor: 'pointer',
      color: color.subtext, padding: 4, borderRadius: 3,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
  >
    <X size={12} strokeWidth={2.2} />
  </button>
);

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    flexShrink: 0,
    fontFamily: font.sans,
  },
  activityBar: {
    width: `${ACTIVITY_WIDTH}px`,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: color.crust,
    borderRight: `1px solid ${color.borderStrong}`,
  },
  panel: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: color.base,
    borderRight: `1px solid ${color.border}`,
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `10px ${space['3']} 10px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
    height: '40px',
  },
  panelTitle: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
  },
  panelBody: {
    flex: 1,
    overflow: 'auto',
  },
  sectionLabel: {
    padding: `12px ${space['4']} 6px`,
    fontSize: '10.5px',
    fontWeight: fontWeight.semibold,
    color: color.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
  },
};

export default LeftSidebar;
