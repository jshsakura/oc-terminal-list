import { useEffect } from 'react';
import { X, Plus, Server, Settings as SettingsIcon, Monitor, Link2, Download } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import useConnectedRemotes from '../hooks/useConnectedRemotes';
import useHostReorder from '../hooks/useHostReorder';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

// EmptyPane / HomeDashboard 와 같은 팔레트 인덱스 규칙. 로컬 카드 강조색.
const localAccentFor = (settings) =>
  color.dotPalette[(settings?.localColorIndex ?? 0) % color.dotPalette.length];

// 카드 sub 한 줄 (truncate + 인라인 block) 공유 스타일.
const LINE = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const HostManager = ({ isOpen, onClose, hosts = [], localStartPath = '', settings = {}, onAdd, onEdit, onEditLocal = null, onConnect, refreshHosts = null, t }) => {
  // 열려 있을 때만 묻는다 — 닫힌 모달이 배경에서 폴링하지 않게.
  const { connected: connectedRemotes } = useConnectedRemotes(isOpen);
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  // 서버 sort_index = SSoT. HomeDashboard / EmptyPane 과 동일한 hook → 한 곳에서 옮기면 모든 곳 동기화.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);

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
          {/* 로컬 + 원격 단일 리스트 — 톤 통일. 첫 번째 항목이 항상 This machine. */}
          <Row
            accent={localAccentFor(settings)}
            icon={<HostIcon value={settings.localIcon || ''} fallback={Monitor} size={13} />}
            name={(settings.localName || '').trim() || (t?.('thisMachine') || 'This machine')}
            sub={
              <>
                <span style={LINE}>localhost</span>
                <span style={{ ...LINE, color: (localStartPath || '').trim() ? color.muted : color.faint }}>
                  {(localStartPath || '').trim() || (t?.('noStartPath') || 'No start path')}
                </span>
              </>
            }
            actions={onEditLocal && (
              <button
                onClick={(e) => { e.stopPropagation(); onEditLocal(); }}
                title={t?.('localSettings') || 'Local settings'}
                style={styles.gearBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
              >
                <SettingsIcon size={13} strokeWidth={1.8} />
              </button>
            )}
          />

          {orderedHosts.map((host) => {
            const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
            const remoteOn = !!connectedRemotes[host.id];
            return (
              <Row
                key={host.id}
                {...rowPropsFor(host)}
                accent={accent}
                icon={<HostIcon value={host.icon || ''} fallback={Server} size={13} />}
                name={host.name}
                sub={
                  <>
                    <span style={LINE}>{host.ssh_user}@{host.hostname}{host.port !== 22 ? `:${host.port}` : ''}</span>
                    <span style={{ ...LINE, color: host.start_path ? color.muted : color.faint }}>
                      {host.start_path || (t?.('noStartPath') || 'No start path')}
                    </span>
                  </>
                }
                /* 호스트 관리 row 는 클릭으로 연결 X — 관리/정렬 전용. 연결은 새 탭/홈에서. 편집은 우측 gear. */
                actions={
                  <>
                    {/* 리모트가 붙어 있을 때만 표시한다. 없을 때 회색 아이콘을 두면
                        '안 깔았다' 가 결함처럼 읽히는데, 설치는 선택이다. 자세한 상태와
                        설치/제거는 옆의 설정(기어) 안에 있다. */}
                    {remoteOn ? (
                      <span
                        title={t?.('remoteConnectedShort') || '리모트 연결됨'}
                        style={styles.remoteDot}
                      >
                        <Link2 size={12} strokeWidth={2} />
                      </span>
                    ) : (
                      /* 리모트가 없으면 그 호스트는 세션 간 명령 전달도 상태 표시도 안 된다.
                         우리가 볼 방법이 없어서지 고장이 아니다 — 그래서 경고색이 아니라
                         **할 수 있는 일**을 내민다(VMware 가 Tools 미설치를 알리는 방식).
                         누르면 그 호스트의 설정(리모트 구획)이 열린다. */
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit?.(host); }}
                        title={t?.('remoteInstallHint') || '리모트 미설치 — 설치하면 명령 전달과 상태가 켜집니다'}
                        style={styles.remoteInstall}
                      >
                        <Download size={12} strokeWidth={2} />
                      </button>
                    )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit?.(host); }}
                    title={t?.('hostSettings') || 'Settings'}
                    style={styles.gearBtn}
                    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
                  >
                    <SettingsIcon size={13} strokeWidth={1.8} />
                  </button>
                  </>
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

const Row = ({
  accent, icon, name, sub, onClick, actions,
  isDragging = false, isDragOver = false,
  ...rest
}) => (
  <div
    /* data-host-row + onPointerDown spread (useHostReorder.rowPropsFor). */
    data-host-row={rest['data-host-row'] || undefined}
    onPointerDown={rest.onPointerDown}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 14px',
      cursor: isDragging ? 'grabbing' : (onClick ? 'pointer' : 'grab'),
      transition: 'background 120ms, border-color 120ms, box-shadow 120ms',
      borderRadius: '6px',
      margin: '2px 6px',
      // 드래그 중 = 들린 카드처럼 accent 보더 + glow. opacity 안 깎음 (이전엔 너무 흐려서 안 보였음).
      border: isDragging
        ? `1px solid ${color.accent}`
        : isDragOver ? `2px dashed ${color.accent}` : '1px solid transparent',
      background: isDragging ? color.surface2 : (isDragOver ? color.surface1 : 'transparent'),
      boxShadow: isDragging ? `0 6px 18px ${color.accent}40, 0 0 0 1px ${color.accent}` : 'none',
      transform: isDragging ? 'translateY(-1px) scale(1.01)' : 'none',
      touchAction: rest.onPointerDown ? 'pan-y' : 'auto',
      userSelect: 'none',
    }}
    onClick={onClick}
    onMouseEnter={(e) => { if (!isDragOver) e.currentTarget.style.background = color.surface0; }}
    onMouseLeave={(e) => { if (!isDragOver) e.currentTarget.style.background = 'transparent'; }}
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
          marginTop: '1px',
          display: 'flex', flexDirection: 'column', gap: '1px',
          minWidth: 0,
          lineHeight: 1.35,
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
    position: 'absolute', inset: 0,
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
  remoteInstall: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    flexShrink: 0,
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: radius.sm,
    // 경고색이 아니다 — 안 깐 것은 결함이 아니라 선택이고, 여기서 말하는 것은 "할 수 있다" 다.
    color: color.subtext,
    cursor: 'pointer',
  },
  remoteDot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    flexShrink: 0,
    color: color.success,
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
