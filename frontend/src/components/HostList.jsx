import { useMemo, useState } from 'react';
import { Plus, Search, Server, KeyRound, Settings as SettingsIcon, Monitor, ChevronRight } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const HOST_DRAG_MIME = 'application/x-iterminallist-host';

const startHostDrag = (e, hostId) => {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(HOST_DRAG_MIME, hostId);
};

// 항상 존재하는 \"이 머신\" 가상 호스트. id 가 'local' 이면 onConnect 측에서 분기.
const LOCAL_HOST = {
  id: 'local',
  name: 'This machine',
  hostname: 'localhost',
  ssh_user: '',
  port: 0,
  isLocal: true,
};

const HostList = ({
  hosts,
  onConnect,
  onAddHost,
  onEditHost,
  onDeleteHost,
  onManageKeys,
  t,
}) => {
  const [filter, setFilter] = useState('');
  const [hoverId, setHoverId] = useState(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.name, h.hostname, h.ssh_user, h.group_name]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q))
    );
  }, [hosts, filter]);

  return (
    <>
      <div style={styles.searchRow}>
        <div style={styles.searchInputWrap}>
          <Search size={12} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('searchHosts') || 'Search hosts'}
            style={styles.searchInput}
          />
        </div>
        <button onClick={onManageKeys} title={t('manageKeys') || 'SSH Keys'} style={styles.iconBtn}>
          <KeyRound size={13} strokeWidth={2} />
        </button>
        <button onClick={onAddHost} title={t('addHost') || 'Add host'} style={styles.iconBtn}>
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      <div style={styles.list}>
        {/* 항상 첫 줄: 로컬 머신 (저장된 원격이 비어있어도 1개는 보장) */}
        <LocalRow
          onClick={() => onConnect?.(LOCAL_HOST)}
          hovered={hoverId === 'local'}
          onMouseEnter={() => setHoverId('local')}
          onMouseLeave={() => setHoverId(null)}
          label={t('thisMachine') || 'This machine'}
          subLabel={t('localTmuxHint') || 'Local tmux session'}
        />

        {/* 저장된 원격 호스트 */}
        {filtered.length === 0 && filter.trim() === '' ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>{t('noRemoteHosts') || 'No saved remote hosts'}</div>
            <div style={styles.emptyHint}>{t('addHostHint') || 'Add a server to connect via SSH.'}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>{t('noResults') || 'No matches'}</div>
            <div style={styles.emptyHint}>{t('tryDifferentSearch') || 'Try a different search.'}</div>
          </div>
        ) : (
          filtered.map((h) => {
            const dotColor = color.dotPalette[(h.color_index || 0) % color.dotPalette.length];
            const hovered = hoverId === h.id;
            return (
              <div
                key={h.id}
                draggable
                onDragStart={(e) => startHostDrag(e, h.id)}
                onMouseEnter={() => setHoverId(h.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => onConnect?.(h)}
                onDoubleClick={() => onConnect?.(h)}
                title={`${h.name} — ${t('dragToOpenHere') || 'click or drag to terminal'}`}
                style={{
                  ...styles.row,
                  background: hovered ? color.surface1 : color.surface0,
                  borderColor: hovered ? color.borderStrong : color.border,
                  cursor: 'grab',
                }}
              >
                <div style={{
                  ...styles.hostIcon,
                  color: dotColor,
                  borderColor: hovered ? `${dotColor}55` : color.border,
                }}>
                  <Server size={12} strokeWidth={2} />
                </div>
                <div style={styles.rowBody}>
                  <div style={styles.rowName}>{h.name}</div>
                  <div style={styles.rowSub}>
                    {h.ssh_user}@{h.hostname}
                    {h.port && h.port !== 22 ? `:${h.port}` : ''}
                  </div>
                </div>

                {hovered && (
                  <div style={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                    <RowAction onClick={() => onEditHost(h)} icon={SettingsIcon} title={t('hostSettings') || 'Host settings'} />
                  </div>
                )}
                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  style={{
                    ...styles.openHint,
                    opacity: hovered ? 1 : 0.35,
                    color: hovered ? color.accent : color.muted,
                    transform: hovered ? 'translateX(2px)' : 'translateX(0)',
                  }}
                />
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

const LocalRow = ({ onClick, hovered, onMouseEnter, onMouseLeave, label, subLabel }) => (
  <div
    draggable
    onDragStart={(e) => startHostDrag(e, 'local')}
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    title={`${label} — click or drag to terminal`}
    style={{
      ...styles.row,
      background: hovered ? color.surface1 : color.surface0,
      borderColor: hovered ? color.borderStrong : color.border,
      cursor: 'grab',
    }}
  >
    <div style={{ ...styles.localIcon }}>
      <Monitor size={12} strokeWidth={2} />
    </div>
    <div style={styles.rowBody}>
      <div style={styles.rowName}>{label}</div>
      <div style={styles.rowSub}>{subLabel}</div>
    </div>
    <ChevronRight
      size={12}
      strokeWidth={2}
      style={{
        ...styles.openHint,
        opacity: hovered ? 1 : 0.35,
        color: hovered ? color.accent : color.muted,
        transform: hovered ? 'translateX(2px)' : 'translateX(0)',
      }}
    />
  </div>
);

const RowAction = ({ onClick, icon: Icon, title, tone }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      ...styles.rowActionBtn,
      color: tone === 'danger' ? color.danger : color.muted,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon size={12} strokeWidth={2} />
  </button>
);

const styles = {
  searchRow: {
    display: 'flex',
    gap: space['1.5'],
    padding: `${space['2']} ${space['2']} ${space['1.5']}`,
  },
  searchInputWrap: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    height: '28px',
    padding: `0 ${space['2']}`,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: color.text,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
  },
  iconBtn: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}`,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['2']} ${space['2']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['1'],
  },
  empty: {
    textAlign: 'center',
    padding: `${space['8']} ${space['4']}`,
    color: color.muted,
  },
  emptyTitle: {
    fontSize: fontSize['13'],
    color: color.subtext,
    marginBottom: space['1'],
  },
  emptyHint: {
    fontSize: fontSize['11'],
    color: color.muted,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['2']} ${space['3']}`,
    paddingLeft: space['4'],
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}`,
    minHeight: '46px',
  },
  hostIcon: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    transition: `border-color ${motion.fast}`,
  },
  localIcon: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    color: color.accent,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: fontSize['13'],
    color: color.text,
    fontWeight: fontWeight.medium,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  rowSub: {
    fontSize: fontSize['11'],
    color: color.muted,
    fontFamily: font.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: '1px',
  },
  rowActions: {
    display: 'flex',
    gap: '2px',
  },
  openHint: {
    color: color.muted,
    flexShrink: 0,
    opacity: 0.5,
    transition: `opacity ${motion.fast}, transform ${motion.fast}`,
  },
  rowActionBtn: {
    width: '22px',
    height: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}`,
  },
};

export default HostList;
