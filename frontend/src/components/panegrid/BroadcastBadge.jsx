import { Radio, X, Plus } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight } = tokens;

// pane 마다 배지가 하나씩 뜨므로 keyframes 는 head 에 한 번만 넣는다
// (common/SkeletonRow.jsx 와 같은 방식).
const STYLE_ID = 'iterm-broadcast-badge-style';
let injected = false;
const ensureStyle = () => {
  if (typeof document === 'undefined' || injected) return;
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
      @keyframes iterm-broadcast-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes iterm-broadcast-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.3; }
      }
      .iterm-bc-action:hover { background: color-mix(in srgb, currentColor 20%, transparent); }
    `;
    document.head.appendChild(el);
  }
  injected = true;
};

/**
 * Broadcast(동시 입력)가 켜져 있을 때 각 pane 우측 상단에 뜨는 배지.
 *
 * pane 단위 opt-out 이 목적 — 5분할 중 한 곳만 빼고 보내고 싶을 때, 그 pane 의 ✕ 를 눌러
 * 제외한다. 제외된 pane 은 입력을 받지도, 자기 입력을 남에게 보내지도 않는다.
 * 전역 on/off 는 탭바의 Radio 버튼이 담당한다.
 */
const BroadcastBadge = ({ isExcluded = false, onToggle, t }) => {
  const toggleLabel = isExcluded
    ? (t?.('broadcastInclude') || 'Include this pane again')
    : (t?.('broadcastExclude') || 'Exclude this pane');
  ensureStyle();

  return (
  <div style={{ ...styles.wrap, ...(isExcluded ? styles.wrapExcluded : null) }}>
    {isExcluded
      ? <span style={styles.dotMuted} />
      : <span style={styles.dot} />}
    <Radio size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
    <span style={styles.label}>
      {isExcluded
        ? (t?.('broadcastExcluded') || 'Excluded')
        : (t?.('broadcastActive') || 'Broadcasting')}
    </span>
    <span style={styles.divider} />
    <button
      type="button"
      className="iterm-bc-action"
      onClick={onToggle}
      title={toggleLabel}
      aria-label={toggleLabel}
      aria-pressed={isExcluded}
      style={styles.action}
    >
      {isExcluded
        ? <Plus size={11} strokeWidth={2.5} />
        : <X size={11} strokeWidth={2.5} />}
    </button>
  </div>
  );
};

const BASE_WRAP = {
  position: 'absolute',
  top: '14px',
  right: '6px',
  zIndex: 6,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  height: '22px',
  padding: '0 3px 0 7px',
  borderRadius: '999px',
  fontFamily: font.sans,
  fontSize: '10px',
  fontWeight: fontWeight.semibold,
  lineHeight: 1,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  animation: 'iterm-broadcast-in 140ms ease both',
  pointerEvents: 'auto',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const styles = {
  wrap: {
    ...BASE_WRAP,
    // pane 테두리(앰버)와 같은 계열로 — 브로드캐스트 대상임을 한눈에.
    color: '#f59e0b',
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 80%, transparent)`,
    border: '1px solid color-mix(in srgb, #f59e0b 50%, transparent)',
    boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
  },
  wrapExcluded: {
    color: `var(--ui-muted, ${color.muted})`,
    border: `1px dashed color-mix(in srgb, var(--ui-muted, ${color.muted}) 45%, transparent)`,
    boxShadow: 'none',
  },
  dot: {
    width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
    background: '#f59e0b',
    animation: 'iterm-broadcast-pulse 1.4s ease-in-out infinite',
  },
  dotMuted: {
    width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
    background: `var(--ui-muted, ${color.muted})`,
  },
  label: { lineHeight: 1 },
  divider: {
    width: '1px', height: '11px', flexShrink: 0,
    background: 'color-mix(in srgb, currentColor 35%, transparent)',
  },
  action: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '17px', height: '17px', flexShrink: 0,
    padding: 0, border: 'none', borderRadius: '50%',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    transition: 'background 120ms',
    WebkitTapHighlightColor: 'transparent',
  },
};

export default BroadcastBadge;
