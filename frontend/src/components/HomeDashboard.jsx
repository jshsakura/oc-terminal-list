import { useState, memo, useMemo, useRef, useEffect } from 'react';
import { Server, Monitor, Plus, Settings as SettingsIcon, FolderOpen } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space } = tokens;


// 정렬 순서는 DB(hosts.sort_index) 가 정답. localStorage 캐시는 최초 paint 깜빡임 방지용.
const ORDER_CACHE_KEY = 'host_order_v1';

const loadCachedOrder = () => {
  try { return JSON.parse(localStorage.getItem(ORDER_CACHE_KEY) || '[]'); } catch { return []; }
};
const cacheOrder = (ids) => {
  try { localStorage.setItem(ORDER_CACHE_KEY, JSON.stringify(ids)); } catch {}
};

const persistOrderToServer = async (ids) => {
  try {
    const token = localStorage.getItem('auth_token');
    await fetch('/api/hosts/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // 네트워크 실패해도 캐시는 유지 — 다음 새로고침에 서버 응답이 정답
  }
};

// Termius 풍 가로 카드 — 폭이 넓어지면 한 줄에 여러개, 좁아지면 한 줄로 stack.
const CARD_MIN_WIDTH = 260;
const CARD_GAP = 8;
const CONTENT_PADDING = 40; // 좌우 padding 합 (root padding ${space['5']}=20px*2)
const MAX_COLUMNS = 3;

const HomeDashboard = ({
  hosts = [],
  localCard,
  onOpenHost,
  onOpenHostAtPath,
  onAddHost,
  onEditHost,
  onDeleteHost,
  onOpenSettings,
  onEditLocal,
  onPickLocalPath,
  // embedded=true 면 부모 안에 끼워 쓰는 모드 — root 의 height: 100% 를 풀어
  // 콘텐츠 높이만 차지하게 한다 (분할 pane 의 빈 슬롯에서 미러 picker 와 같이 stack 가능).
  embedded = false,
  t,
}) => {
  const [hoverId, setHoverId] = useState(null);
  // 서버가 sort_index 로 정렬해서 hosts prop 을 내려줌. 클라 측 order 는 그 순서를 그대로 따른다.
  // 단, DnD 직후 서버 fetch 가 끝나기 전 깜빡임 방지를 위해 localStorage 캐시 / pending 버퍼 사용.
  const [pendingOrder, setPendingOrder] = useState(() => loadCachedOrder());
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);

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

  // pendingOrder 가 있으면 그걸 우선, 없으면 hosts 가 이미 서버 정렬된 상태.
  const orderedHosts = useMemo(() => {
    const byId = new Map(hosts.map((h) => [h.id, h]));
    if (pendingOrder.length > 0) {
      const sorted = pendingOrder.map((id) => byId.get(id)).filter(Boolean);
      const known = new Set(sorted.map((h) => h.id));
      const newcomers = hosts.filter((h) => !known.has(h.id));
      return [...sorted, ...newcomers];
    }
    return hosts;
  }, [hosts, pendingOrder]);

  // 서버에서 새 hosts 가 도착하면 pendingOrder 와 일치하는지 보고 정리 — 일치하면 비움
  useEffect(() => {
    if (pendingOrder.length === 0) return;
    const live = hosts.map((h) => h.id);
    const match = pendingOrder.length <= live.length
      && pendingOrder.every((id, i) => live[i] === id);
    if (match) setPendingOrder([]);
  }, [hosts, pendingOrder]);

  const reorder = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const currentIds = orderedHosts.map((h) => h.id);
    const fromIdx = currentIds.indexOf(fromId);
    const toIdx = currentIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...currentIds];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setPendingOrder(next);
    cacheOrder(next);
    persistOrderToServer(next);
  };

  return (
    <div
      ref={rootRef}
      style={{
        ...styles.root,
        ...(embedded ? { height: 'auto', overflow: 'visible' } : null),
      }}
    >
      <div style={styles.inner}>
        <div style={styles.topBar}>
          <span style={styles.title}>
            {t?.('connections') || 'Connections'}
          </span>
          <button
            style={styles.addHostBtn}
            onClick={onAddHost}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.accent; e.currentTarget.style.color = color.crust; e.currentTarget.style.borderColor = color.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.accent; e.currentTarget.style.borderColor = color.accentBorder; }}
          >
            <Plus size={12} strokeWidth={2.2} />
            <span>{t?.('addHost') || 'Add host'}</span>
          </button>
        </div>

        <div style={{
          display: 'grid',
          gap: `${CARD_GAP}px`,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}>
          <HostRow
            id="local"
            draggable={false}
            icon={<HostIcon value={localCard?.icon || ''} fallback={Monitor} size={20} />}
            name={localCard?.name || (t?.('thisMachine') || 'This machine')}
            subtitle={localCard?.subtitle || 'localhost'}
            accentColor={localCard?.accent || color.accent}
            isHovered={hoverId === 'local'}
            onHover={setHoverId}
            onClick={() => onOpenHost({ id: 'local', isLocal: true })}
            onEdit={onEditLocal || null}
            editTitle={t?.('editLocalMachine') || 'Edit this machine'}
            onPickPath={onPickLocalPath || null}
            pickPathTitle={t?.('openAtPath') || 'Open at path…'}
          />

          {orderedHosts.map((host) => {
            const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
            return (
              <HostRow
                key={host.id}
                id={host.id}
                draggable
                isDragging={draggingId === host.id}
                isDragOver={overId === host.id && draggingId !== host.id}
                icon={<HostIcon value={host.icon || ''} fallback={Server} size={20} />}
                name={host.name}
                subtitle={`${host.ssh_user}@${host.hostname}${host.port && host.port !== 22 ? `:${host.port}` : ''}`}
                accentColor={accent}
                isHovered={hoverId === host.id}
                onHover={setHoverId}
                onClick={() => onOpenHost(host)}
                onEdit={() => onEditHost?.(host)}
                editTitle={t?.('hostSettings') || 'Host settings'}
                onPickPath={onOpenHostAtPath ? () => onOpenHostAtPath(host) : null}
                pickPathTitle={t?.('openAtPath') || 'Open at path…'}
                onDragStart={(e) => {
                  setDraggingId(host.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', host.id);
                }}
                onDragEnd={() => { setDraggingId(null); setOverId(null); }}
                onDragOver={(e) => {
                  if (!draggingId || draggingId === host.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overId !== host.id) setOverId(host.id);
                }}
                onDragLeave={() => { if (overId === host.id) setOverId(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData('text/plain') || draggingId;
                  reorder(fromId, host.id);
                  setDraggingId(null);
                  setOverId(null);
                }}
              />
            );
          })}

          <EmptyRow onClick={onAddHost} t={t} />
        </div>
      </div>
    </div>
  );
};

export const HostRow = memo(({
  id, icon, name, subtitle, accentColor,
  leadingBadge = null,    // 아이콘 박스 앞에 표시할 작은 노드 (예: 탭 번호 kbd)
  isHovered, isDragging, isDragOver,
  draggable, onHover, onClick, onEdit, editTitle,
  onPickPath, pickPathTitle,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) => (
  <div
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onMouseEnter={() => onHover?.(id)}
    onMouseLeave={() => onHover?.(null)}
    onClick={onClick}
    style={{
      ...styles.row,
      background: isDragOver
        ? color.surface2
        : isHovered ? color.surface1 : color.surface0,
      borderColor: isDragOver
        ? color.accent
        : isHovered ? accentColor : color.border,
      borderStyle: isDragOver ? 'dashed' : 'solid',
      transform: isHovered && !isDragging ? 'translateY(-1px)' : 'translateY(0)',
      boxShadow: isHovered && !isDragging
        ? `0 4px 14px ${accentColor}22, 0 0 0 1px ${accentColor}`
        : 'none',
      opacity: isDragging ? 0.4 : 1,
      cursor: draggable ? 'grab' : 'pointer',
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

    {(onPickPath || onEdit) && (
      <div style={styles.actions} onClick={(e) => e.stopPropagation()}>
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
        ...styles.emptyRow,
        background: hovered ? color.surface0 : 'transparent',
        borderColor: hovered ? color.accent : color.border,
        borderStyle: 'dashed',
        color: hovered ? color.accent : color.muted,
      }}
    >
      <Plus size={14} strokeWidth={1.8} />
      <span style={{ fontSize: fontSize['12'], fontWeight: fontWeight.medium }}>
        {t?.('addHost') || 'Add host'}
      </span>
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
  addHostBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 12px',
    background: 'transparent',
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.accent,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    transition: 'background 150ms, border-color 150ms, color 150ms',
    fontFamily: font.sans,
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
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: font.mono,
  },
  actions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
};

export default HomeDashboard;
