import { tokens } from '../../styles/tokens';

const { color, motion, radius } = tokens;

/**
 * 앱 전역 chrome rail 버튼 — TabBar 상단 액션, RightPanel 우측 액티비티 바 등에서 공통 사용.
 *
 * 시각 규칙 (DESIGN.md §10 정렬과 한 묶음):
 *  - 외부 hit-area: 32×32 (모바일 친화 hit-area 유지, 시각 무게는 inner box 가 담당)
 *  - inner box: 24×24, borderRadius radius.sm (6px) — 호버/활성 시 배경 칠해지는 영역
 *  - 아이콘: 15px / strokeWidth 1.8
 *  - 색상: 기본 subtext → 호버 text → 활성 accent
 *  - 활성 = inner box bg surface1, color accent (border-left 같은 부속 표식 안 씀)
 *  - 트랜지션: motion.fast (120ms)
 *
 * children 으로 lucide 아이콘을 받는다 (이미 size/strokeWidth 박혀 들어와도 OK,
 * 외곽이 일관되면 됨).
 */
const RailIconBtn = ({
  icon: Icon,
  children,
  onClick,
  title,
  active = false,
  tone,             // 'danger' 등 의미 색상
  disabled = false,
  badge = null,     // 우상단 작은 카운트 배지
  ariaLabel,
}) => {
  const isDanger = tone === 'danger';
  const baseColor =
    isDanger ? color.danger
    : active ? color.accent
    : color.subtext;
  const hoverColor = isDanger ? '#fff' : color.text;
  // danger 는 항상 살짝 보이게 (rail 안에 묻히지 않도록). active 면 surface1 우선.
  const idleInnerBg = active
    ? color.surface1
    : isDanger
      ? `${color.danger}1f`   // ~12% alpha
      : 'transparent';
  const hoverInnerBg = isDanger ? color.danger : color.surface0;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      disabled={disabled}
      style={{
        ...S.outer,
        color: baseColor,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        const inner = e.currentTarget.firstElementChild;
        if (inner && !active) inner.style.background = hoverInnerBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        const inner = e.currentTarget.firstElementChild;
        if (inner && !active) inner.style.background = idleInnerBg;
        e.currentTarget.style.color = baseColor;
      }}
    >
      <span
        style={{
          ...S.inner,
          background: idleInnerBg,
          border: isDanger ? `1px solid ${color.danger}33` : '1px solid transparent',
        }}
      >
        {Icon ? <Icon size={15} strokeWidth={1.8} /> : children}
        {badge != null && badge > 0 && (
          <span style={S.badge}>{badge > 99 ? '99+' : badge}</span>
        )}
      </span>
    </button>
  );
};

const S = {
  outer: {
    width: '32px',
    height: '32px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    padding: 0,
    flexShrink: 0,
    transition: `color ${motion.fast}`,
  },
  inner: {
    position: 'relative',
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    transition: `background ${motion.fast}`,
  },
  badge: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    minWidth: '13px',
    height: '13px',
    padding: '0 3px',
    background: color.accent,
    color: color.crust,
    borderRadius: '7px',
    fontSize: '9px',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    boxShadow: `0 0 0 1.5px ${color.mantle}`,
  },
};

export default RailIconBtn;
