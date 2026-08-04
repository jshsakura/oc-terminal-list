import { useState, memo, useRef, useEffect } from 'react';
import {
  Server, Monitor, Plus, Settings as SettingsIcon, FolderOpen,
  Link2, BarChart3, ScreenShare,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import HomeSessions from './HomeSessions';
import useHostReorder from '../hooks/useHostReorder';
import DashboardCards from './DashboardCards';

const { color, font, fontSize, fontWeight, radius, space } = tokens;


// 정렬 순서는 서버 hosts.sort_index 가 SSoT. useHostReorder 훅이 옵티미스틱 관리.

// Termius 풍 가로 카드 — 폭이 넓어지면 한 줄에 여러개, 좁아지면 한 줄로 stack.
const CARD_MIN_WIDTH = 260;
const CARD_GAP = 8;
const CONTENT_PADDING = 40; // 좌우 padding 합 (root padding ${space['5']}=20px*2)
const MAX_COLUMNS = 3;

const HomeDashboard = ({
  hosts = [],
  localCard,
  settings = {},
  onOpenHost,
  onOpenHostAtPath,
  onOpenVnc,
  onAddHost,
  onEditHost,
  onDeleteHost,
  onOpenSettings,
  onEditLocal,
  onPickLocalPath,
  // 영속 세션 카드용 (옵셔널 — 미공급 시 섹션 미표시)
  tabs = [],
  busyTabIds = null,
  onJumpTab,
  onResumeHostSession,
  onTerminateHostSession,
  onConfirm,
  onNotify,
  // embedded=true 면 부모 안에 끼워 쓰는 모드 — root 의 height: 100% 를 풀어
  // 콘텐츠 높이만 차지하게 한다 (분할 pane 의 빈 슬롯에서 미러 picker 와 같이 stack 가능).
  embedded = false,
  refreshHosts = null,
  refreshSignal = 0,
  // 홈이 실제 사용자에게 보이는지 — false 면 HomeSessions 의 SSH tmux 조회를 스킵.
  isVisible = true,
  // 사용 통계 카드 — 빈 패널/홈 양쪽 동일하게 보여주기 위해 옵션. 기본 켜둠.
  showUsageStats = true,
  // EmptyPane 모드에서 다른 탭 흡수 섹션을 위에 끼우고 싶을 때 — 노드 그대로 받아 렌더.
  extraTopSlot = null,
  t,
}) => {
  const [hoverId, setHoverId] = useState(null);
  // 서버 sort_index 가 SSoT. useHostReorder 가 옵티미스틱 reorder + persist + refresh 통합 처리.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);

  const rootRef = useRef(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const calc = () => {
      const avail = el.clientWidth - CONTENT_PADDING;
      const fits = (n) => n * CARD_MIN_WIDTH + (n - 1) * CARD_GAP;
      let n = 1;
      for (let candidate = MAX_COLUMNS; candidate >= 1; candidate -= 1) {
        if (avail >= fits(candidate)) { n = candidate; break; }
      }
      setColumns(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        ...styles.root,
        ...(embedded ? { height: 'auto', overflow: 'visible' } : null),
      }}
    >
      <div style={styles.inner}>
        {/* 1) Connections — 탭 열기가 핵심 흐름이므로 가장 위. */}
        <Section icon={Link2} title={t?.('connections') || 'Connections'}>
          <div style={{
            display: 'grid',
            gap: `${CARD_GAP}px`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}>
            {/* 명시적으로 localCard={null} 일 때만 카드 숨김 — undefined 는 기존 동작(기본값으로 렌더). */}
            {localCard !== null && (
              <HostRow
                id="local"
                draggable={false}
                icon={<HostIcon value={localCard?.icon || ''} fallback={Monitor} size={20} />}
                name={localCard?.name || (t?.('thisMachine') || 'This machine')}
                subtitle={
                  <>
                    <span style={styles.subLine}>localhost</span>
                    <span style={{ ...styles.subLine, color: (localCard?.startPath || '').trim() ? color.subtext : color.faint }}>
                      {(localCard?.startPath || '').trim() || (t?.('noStartPath') || 'No start path')}
                    </span>
                  </>
                }
                accentColor={localCard?.accent || color.accent}
                isHovered={hoverId === 'local'}
                onHover={setHoverId}
                onClick={() => onOpenHost({ id: 'local', isLocal: true })}
                onEdit={onEditLocal || null}
                editTitle={t?.('editLocalMachine') || 'Edit this machine'}
                onPickPath={onPickLocalPath || null}
                pickPathTitle={t?.('openAtPath') || 'Open at path…'}
                /* 로컬도 원격 데스크톱을 쓸 수 있다 — 백엔드가 도는 기계라
                   SSH 터널 없이 루프백에 바로 붙는다(가장 짧은 경로). */
                onOpenVnc={onOpenVnc ? () => onOpenVnc({ id: 'local', isLocal: true, name: localCard?.name || 'local' }) : null}
                openVncTitle={t?.('remoteDesktop') || 'Remote desktop'}
              />
            )}

            {orderedHosts.map((host) => {
              const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
              return (
                <HostRow
                  key={host.id}
                  id={host.id}
                  {...rowPropsFor(host)}
                  icon={<HostIcon value={host.icon || ''} fallback={Server} size={20} />}
                  name={host.name}
                  subtitle={
                    <>
                      <span style={styles.subLine}>{host.ssh_user}@{host.hostname}{host.port && host.port !== 22 ? `:${host.port}` : ''}</span>
                      <span style={{ ...styles.subLine, color: host.start_path ? color.subtext : color.faint }}>
                        {host.start_path || (t?.('noStartPath') || 'No start path')}
                      </span>
                    </>
                  }
                  accentColor={accent}
                  isHovered={hoverId === host.id}
                  onHover={setHoverId}
                  onClick={() => onOpenHost(host)}
                  onEdit={() => onEditHost?.(host)}
                  editTitle={t?.('hostSettings') || 'Host settings'}
                  onPickPath={onOpenHostAtPath ? () => onOpenHostAtPath(host) : null}
                  pickPathTitle={t?.('openAtPath') || 'Open at path…'}
                  onOpenVnc={onOpenVnc ? () => onOpenVnc(host) : null}
                  openVncTitle={t?.('remoteDesktop') || 'Remote desktop'}
                />
              );
            })}

            <EmptyRow onClick={onAddHost} t={t} />
          </div>
        </Section>

        {/* 2) (EmptyPane 모드 전용) 다른 탭 흡수. 부모가 노드 통째로 넘김. */}
        {extraTopSlot}

        {/* 3) Open / Resumable 세션 — HomeSessions 가 자체 Open / Resumable 그룹 헤더를 렌더. */}
        {(tabs.length > 0 || hosts.some((h) => h.use_remote_tmux)) && (
          <HomeSessions
            tabs={tabs}
            hosts={hosts}
            busyTabIds={busyTabIds}
            onJumpTab={onJumpTab}
            onResumeHostSession={onResumeHostSession}
            onTerminateHostSession={onTerminateHostSession}
            onConfirm={onConfirm}
            onNotify={onNotify}
            refreshSignal={refreshSignal}
            isVisible={isVisible}
            t={t}
          />
        )}

        {/* 4) 사용 통계 — 양쪽 동일하게. */}
        {showUsageStats && (
          <Section icon={BarChart3} title={t?.('usageStats') || 'Usage · last 7 days'}>
            <DashboardCards hosts={hosts} settings={settings} days={7} t={t} />
          </Section>
        )}
      </div>
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <div style={styles.section}>
    <div style={styles.sectionHead}>
      {Icon && <Icon size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
      <span style={styles.title}>{title}</span>
    </div>
    <div>{children}</div>
  </div>
);

export const HostRow = memo(({
  id, icon, name, subtitle, accentColor,
  leadingBadge = null,
  isHovered, isDragging, isDragOver,
  onHover, onClick, onEdit, editTitle,
  onPickPath, pickPathTitle,
  onOpenVnc, openVncTitle,
  // useHostReorder.rowPropsFor 가 spread 로 보내는 것들: data-host-row, onPointerDown, isDragging, isDragOver.
  ...rest
}) => (
  <div
    data-host-row={rest['data-host-row'] || undefined}
    onPointerDown={rest.onPointerDown}
    onMouseEnter={() => onHover?.(id)}
    onMouseLeave={() => onHover?.(null)}
    onClick={onClick}
    style={{
      ...styles.row,
      background: isDragging
        ? color.surface2
        : (isDragOver ? color.surface2 : (isHovered ? color.surface1 : color.surface0)),
      borderColor: isDragging
        ? color.accent
        : (isDragOver ? color.accent : color.border),
      borderStyle: isDragOver && !isDragging ? 'dashed' : 'solid',
      borderWidth: isDragOver ? '2px' : '1px',
      transform: isDragging
        ? 'translateY(-1px) scale(1.01)'
        : (isHovered ? 'translateY(-1px)' : 'translateY(0)'),
      boxShadow: isDragging
        ? `0 8px 24px ${color.accent}50, 0 0 0 1px ${color.accent}`
        : (isHovered ? `0 4px 14px ${accentColor}22, 0 0 0 1px ${accentColor}` : 'none'),
      cursor: isDragging ? 'grabbing' : 'pointer',
      touchAction: rest.onPointerDown ? 'pan-y' : 'auto',
      userSelect: 'none',
    }}
  >
    {leadingBadge}
    <div
      style={{
        ...styles.iconBox,
        color: accentColor,
        borderColor: isHovered ? `${accentColor}66` : color.border,
        background: isHovered ? `${accentColor}1a` : color.crust,
      }}
    >
      {icon}
    </div>

    <div style={styles.text}>
      <div style={styles.name}>{name}</div>
      <div style={styles.sub}>{subtitle}</div>
    </div>

    {(onPickPath || onEdit || onOpenVnc) && (
      <div style={styles.actions} onClick={(e) => e.stopPropagation()}>
        {onOpenVnc && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onOpenVnc(); }} title={openVncTitle}>
            <ScreenShare size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
        {onPickPath && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onPickPath(); }} title={pickPathTitle}>
            <FolderOpen size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
        {onEdit && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onEdit(); }} title={editTitle}>
            <SettingsIcon size={13} strokeWidth={1.8} />
          </RowBtn>
        )}
      </div>
    )}
  </div>
));

const RowBtn = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: '26px',
      height: '26px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: color.surface0,
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      cursor: 'pointer',
      color: color.subtext,
      transition: 'background 150ms, color 150ms, border-color 150ms',
      padding: 0,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.base;
      e.currentTarget.style.color = color.text;
      e.currentTarget.style.borderColor = color.accent;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.color = color.subtext;
      e.currentTarget.style.borderColor = color.border;
    }}
  >
    {children}
  </button>
);

const EmptyRow = ({ onClick, t }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        ...styles.row,
        background: hovered ? color.surface1 : color.surface0,
        // button 기본 정렬 reset — HostRow(<div>) 와 시각 동일하게 좌측 정렬.
        textAlign: 'left',
        font: 'inherit',
        appearance: 'none',
      }}
    >
      <div style={{ ...styles.iconBox, borderColor: hovered ? color.accentBorder : color.border }}>
        <Plus size={16} strokeWidth={1.8} style={{ color: color.accent }} />
      </div>
      {/* HostRow 의 name + subtitle(2줄) 과 라인 수를 맞춰 row 높이 정렬. */}
      <div style={styles.text}>
        <span style={{ ...styles.name, color: color.subtext }}>{t?.('addHost') || 'Add host'}</span>
        <span style={styles.sub}>
          <span style={{ ...styles.subLine, color: color.faint }}>{t?.('addHostHint') || 'New SSH connection'}</span>
        </span>
      </div>
    </button>
  );
};

const styles = {
  root: {
    width: '100%',
    height: '100%',
    background: color.base,
    overflow: 'auto',
    fontFamily: font.sans,
    padding: `${space['4']} ${space['5']}`,
    boxSizing: 'border-box',
  },
  inner: {
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space['3'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionHead: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    cursor: 'pointer',
    transition: 'background 150ms, border-color 150ms, transform 150ms, box-shadow 150ms, opacity 120ms',
    fontFamily: font.sans,
    minHeight: '60px',
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  emptyRow: {
    justifyContent: 'center',
    cursor: 'pointer',
  },
  iconBox: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    background: color.crust,
    transition: 'background 150ms, border-color 150ms',
  },
  text: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  name: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    fontSize: fontSize['11'],
    color: color.subtext,
    fontFamily: font.mono,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    minWidth: 0,
    lineHeight: 1.35,
  },
  subLine: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
};

export default HomeDashboard;
