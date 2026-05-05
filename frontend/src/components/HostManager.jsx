import { useEffect } from 'react';
import { X, Plus, Server, Settings as SettingsIcon, Monitor } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const HOST_COLORS = [
  '#89b4fa', '#a6e3a1', '#fab387', '#f38ba8',
  '#cba6f7', '#89dceb', '#f9e2af', '#b4befe',
];

const HostManager = ({ isOpen, onClose, hosts = [], onAdd, onEdit, onConnect, t }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.title}>
            {t?.('manageHosts') || 'Manage hosts'}
          </div>
          <button onClick={onClose} style={styles.closeBtn} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.body}>
          {/* This machine — disabled, info only */}
          <Row
            accent={color.accent}
            icon={<Monitor size={14} strokeWidth={1.8} />}
            name={t?.('thisMachine') || 'This machine'}
            sub="localhost (always available)"
            onClick={() => onConnect?.({ id: 'local', isLocal: true })}
          />

          {hosts.length > 0 && (
            <div style={styles.sectionLabel}>
              {t?.('savedHosts') || 'Saved hosts'} · {hosts.length}
            </div>
          )}

          {hosts.map((host) => {
            const accent = HOST_COLORS[host.color_index % HOST_COLORS.length] || color.accent;
            return (
              <Row
                key={host.id}
                accent={accent}
                icon={<HostIcon value={host.icon || ''} fallback={Server} size={13} />}
                name={host.name}
                sub={`${host.ssh_user}@${host.hostname}${host.port !== 22 ? `:${host.port}` : ''}`}
                onClick={() => onConnect?.(host)}
                actions={
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit?.(host); }}
                    title={t?.('hostSettings') || 'Settings'}
                    style={styles.gearBtn}
                    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
                  >
                    <SettingsIcon size={13} strokeWidth={1.8} />
                  </button>
                }
              />
            );
          })}

          {hosts.length === 0 && (
            <div style={styles.empty}>
              {t?.('noHostsYet') || 'No hosts saved yet. Add one to get started.'}
            </div>
          )}
        </div>

        <footer style={styles.footer}>
          <button
            onClick={onAdd}
            style={styles.addBtn}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.accent; e.currentTarget.style.color = color.crust; e.currentTarget.style.borderColor = color.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.accent; e.currentTarget.style.borderColor = color.accentBorder; }}
          >
            <Plus size={13} strokeWidth={2} />
            {t?.('addHost') || 'Add host'}
          </button>
        </footer>
      </div>
    </div>
  );
};

const Row = ({ accent, icon, name, sub, onClick, actions }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 14px',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'background 120ms',
      borderRadius: '6px',
      margin: '2px 6px',
    }}
    onClick={onClick}
    onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = color.surface0; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <div style={{
      width: '24px', height: '24px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: accent, flexShrink: 0,
    }}>
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: fontSize['12'],
        fontWeight: fontWeight.medium,
        color: color.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}>
        {name}
      </div>
      {sub && (
        <div style={{
          fontSize: '10.5px', color: color.muted,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginTop: '1px',
        }}>
          {sub}
        </div>
      )}
    </div>
    {actions && (
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    )}
  </div>
);

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: color.scrim,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, fontFamily: font.sans,
  },
  modal: {
    width: '440px',
    maxWidth: '92vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    background: color.base,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.lg,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `12px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  title: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: '4px',
    cursor: 'pointer', color: color.subtext,
    padding: 0,
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: `8px 0`,
  },
  sectionLabel: {
    padding: '14px 14px 6px',
    fontSize: '10.5px',
    fontWeight: fontWeight.semibold,
    color: color.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
  },
  empty: {
    padding: `${space['6']} ${space['4']}`,
    fontSize: fontSize['12'],
    color: color.subtext,
    textAlign: 'center',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: `10px ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '6px 14px',
    background: 'transparent',
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.accent,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    fontFamily: font.sans,
    transition: 'background 150ms, border-color 150ms, color 150ms',
  },
  gearBtn: {
    width: '24px', height: '24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: '4px',
    cursor: 'pointer', color: color.subtext,
    padding: 0, transition: 'background 120ms, color 120ms',
  },
};

export default HostManager;
