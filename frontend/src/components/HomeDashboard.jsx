import { useState, memo, useMemo, useRef, useEffect } from 'react';
import { Server, Monitor, Plus, Settings as SettingsIcon } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

// 한 줄 최대 칸 수 — 실제 카드 수가 이보다 적으면 그 수만큼만 사용 (가운데 딱)

const HOST_COLORS = [
  '#89b4fa', '#a6e3a1', '#fab387', '#f38ba8',
  '#cba6f7', '#89dceb', '#f9e2af', '#b4befe',
];

const ORDER_KEY = 'host_order_v1';

// localStorage 영속 — 호스트 ID 의 순서 배열
const loadOrder = () => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; }
};
const saveOrder = (ids) => {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch {}
};

const CARD_WIDTH = 140;
const CARD_GAP = 8;
const HORIZONTAL_PADDING = 40;  // root 좌우 padding 합 추정 (root padding ${space['5']}=20px*2)

const HomeDashboard = ({ hosts = [], onOpenHost, onAddHost, onEditHost, onDeleteHost, onOpenSettings, t }) => {
  const [hoverId, setHoverId] = useState(null);
  const [order, setOrder] = useState(() => loadOrder());
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);

  // 컨테이너 폭 측정 → 8/6/4/3 중 가장 큰 거 선택 (딱딱 끊어지는 단계)
  const rootRef = useRef(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fits = (n) => n * CARD_WIDTH + (n - 1) * CARD_GAP;
    const calc = () => {
      const avail = el.clientWidth - HORIZONTAL_PADDING;
      let n = 3;
      if (avail >= fits(8)) n = 8;
      else if (avail >= fits(6)) n = 6;
      else if (avail >= fits(4)) n = 4;
      setColumns(n);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 저장된 순서대로 정렬, 신규 호스트는 뒤에 붙임
  const orderedHosts = useMemo(() => {
    const byId = new Map(hosts.map((h) => [h.id, h]));
    const sorted = order.map((id) => byId.get(id)).filter(Boolean);
    const known = new Set(sorted.map((h) => h.id));
    const newcomers = hosts.filter((h) => !known.has(h.id));
    return [...sorted, ...newcomers];
  }, [hosts, order]);

  const reorder = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const ids = orderedHosts.map((h) => h.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    saveOrder(next);
  };

  // 카드 = This machine + 호스트들. 한 줄(=columns) 보다 적으면 빈 Add 슬롯으로 채움 (한 줄 항상 꽉)
  const realSlots = [
    { type: 'local' },
    ...orderedHosts.map((h) => ({ type: 'host', host: h })),
  ];
  const slots = [...realSlots];
  while (slots.length < columns) slots.push({ type: 'empty' });
  // inner 폭은 항상 한 줄(columns) 기준 → 추가 카드는 다음 줄로 wrap
  const innerWidth = columns * CARD_WIDTH + (columns - 1) * CARD_GAP;

  return (
    <div ref={rootRef} style={styles.root}>
      <div style={{ ...styles.inner, width: `${innerWidth}px`, maxWidth: '100%' }}>
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
          gridTemplateColumns: `repeat(${columns}, ${CARD_WIDTH}px)`,
        }}>
          {slots.map((slot, i) => {
            if (slot.type === 'local') {
              return (
                <HostCard
                  key="local"
                  id="local"
                  draggable={false}
                  iconNode={<Monitor size={22} strokeWidth={1.8} />}
                  name={t?.('thisMachine') || 'This machine'}
                  subtitle="localhost"
                  accentColor={color.accent}
                  isHovered={hoverId === 'local'}
                  onHover={setHoverId}
                  onClick={() => onOpenHost({ id: 'local', isLocal: true })}
                />
              );
            }
            if (slot.type === 'host') {
              const { host } = slot;
              const accent = HOST_COLORS[host.color_index % HOST_COLORS.length] || color.accent;
              return (
                <HostCard
                  key={host.id}
                  id={host.id}
                  draggable
                  isDragging={draggingId === host.id}
                  isDragOver={overId === host.id && draggingId !== host.id}
                  emoji={host.icon || null}
                  iconNode={!host.icon && <Server size={22} strokeWidth={1.8} />}
                  name={host.name}
                  subtitle={`${host.ssh_user}@${host.hostname}`}
                  accentColor={accent}
                  isHovered={hoverId === host.id}
                  onHover={setHoverId}
                  onClick={() => onOpenHost(host)}
                  onEdit={() => onEditHost?.(host)}
                  editTitle={t?.('hostSettings') || 'Host settings'}
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
            }
            return (
              <EmptySlot key={`empty-${i}`} onClick={onAddHost} t={t} />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const HostCard = memo(({
  id, iconNode, emoji, name, subtitle, accentColor,
  isHovered, isDragging, isDragOver,
  draggable, onHover, onClick, onEdit, editTitle,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) => (
  <div
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onMouseEnter={() => onHover(id)}
    onMouseLeave={() => onHover(null)}
    onClick={onClick}
    style={{
      ...styles.card,
      background: isDragOver
        ? color.surface2
        : isHovered ? color.surface1 : color.surface0,
      borderColor: isDragOver
        ? color.accent
        : isHovered ? accentColor : color.border,
      borderStyle: isDragOver ? 'dashed' : 'solid',
      transform: isHovered && !isDragging ? 'translateY(-3px)' : 'translateY(0)',
      boxShadow: isHovered && !isDragging ? `0 8px 20px ${accentColor}30, 0 0 0 1px ${accentColor}` : 'none',
      opacity: isDragging ? 0.4 : 1,
      cursor: draggable ? 'grab' : 'pointer',
      position: 'relative',
    }}
  >
    {onEdit && (
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        title={editTitle}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          width: '22px',
          height: '22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isHovered ? color.surface2 : 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          color: isHovered ? color.subtext : 'transparent',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 150ms, background 150ms, color 150ms',
          padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = color.base; e.currentTarget.style.color = color.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isHovered ? color.surface2 : 'transparent'; e.currentTarget.style.color = isHovered ? color.subtext : 'transparent'; }}
      >
        <SettingsIcon size={12} strokeWidth={1.8} />
      </button>
    )}
    {/* 아이콘 — 박스 없이 accent 색 라인 아이콘만 가운데 */}
    <div style={{ ...styles.iconBadge, color: accentColor }}>
      {emoji
        ? <span style={{ fontSize: '24px', lineHeight: 1 }}>{emoji}</span>
        : iconNode}
    </div>
    <div style={styles.cardName}>{name}</div>
    <div style={styles.cardSub}>{subtitle}</div>
  </div>
));

const EmptySlot = ({ onClick, t }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        ...styles.card,
        ...styles.emptyCard,
        background: hovered ? color.surface0 : 'transparent',
        borderColor: hovered ? color.accent : color.border,
        borderStyle: 'dashed',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <Plus
        size={18}
        strokeWidth={1.5}
        style={{ color: hovered ? color.accent : color.muted }}
      />
      <span style={{ fontSize: fontSize['11'], color: hovered ? color.accent : color.muted }}>
        {t?.('addHost') || 'Add host'}
      </span>
    </button>
  );
};

const styles = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.base,
    overflow: 'auto',
    fontFamily: font.sans,
    padding: `0 ${space['5']}`,
    boxSizing: 'border-box',
  },
  inner: {
    padding: `${space['6']} 0`,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space['4'],
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
  cornerBtn: {
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    transition: 'background 150ms, color 150ms',
    padding: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: space['2'],
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '8px',
    padding: `14px 10px 10px`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    cursor: 'pointer',
    transition: 'background 150ms, border-color 150ms, transform 150ms, box-shadow 150ms, opacity 120ms',
    fontFamily: font.sans,
    height: '128px',
    boxSizing: 'border-box',
    userSelect: 'none',
  },
  emptyCard: {
    justifyContent: 'center',
    flexDirection: 'column',
    gap: space['2'],
  },
  iconBadge: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardName: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  cardSub: {
    fontSize: fontSize['11'],
    color: color.subtext,
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
};

export default HomeDashboard;
