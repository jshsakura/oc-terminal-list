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
  ui = null,
  compact = false,  // 좁은 rail 용 (RightPanel 활동바 등) — outer 24×24 / inner 18×18.
}) => {
  const isDanger = tone === 'danger';
  const isAccent = tone === 'accent';
  const palette = ui || color;
  const baseColor =
    isDanger ? palette.danger
    : (active || isAccent) ? palette.accent
    : palette.subtext;
  const hoverColor = isDanger ? '#fff' : palette.text;
  // 모든 톤 동일 — idle 은 transparent, 호버에만 배경. (이전엔 danger 만 idle bg+border 가
  // 있어서 혼자 큰 버튼처럼 보이는 사고. 시각 무게는 icon color 만으로 충분히 전달.)
  // isAccent: 아이콘 색만 accent 로 — 배경 없음 (눈 아이콘 포커스 표시 등)
  const idleInnerBg = (active && !isAccent) ? palette.surface1 : 'transparent';
  const hoverInnerBg = isDanger ? palette.danger : palette.surface0;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      disabled={disabled}
      style={{
        ...S.outer,
        ...(compact ? S.outerCompact : null),
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
          ...(compact ? S.innerCompact : null),
          background: idleInnerBg,
        }}
      >
        {Icon ? <Icon size={compact ? 13 : 15} strokeWidth={1.8} /> : children}
        {badge != null && badge > 0 && (
          <span style={{ ...S.badge, background: palette.accent, color: palette.crust, boxShadow: `0 0 0 1.5px ${palette.mantle}` }}>
            {badge > 99 ? '99+' : badge}
          </span>
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
    outline: 'none',
    padding: 0,
    flexShrink: 0,
    transition: `color ${motion.fast}`,
  },
  outerCompact: {
    width: '28px',
    height: '28px',
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
  innerCompact: {
    width: '22px',
    height: '22px',
  },
  badge: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    minWidth: '14px',
    height: '14px',
    padding: '0 3px',
    background: color.accent,
    color: color.crust,
    borderRadius: '7px',
    fontSize: '9px',
    fontWeight: 700,
    fontFamily: 'system-ui, -apple-system, sans-serif', // 모노/Nerd Font 의 baseline 편차 회피
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // 텍스트가 박스 안에서 정확히 중앙에 오도록 — line-height 박스 높이와 동일.
    // padding 이 아닌 line-height 로 베이스라인 보정 (font-metric 영향 ↓).
    lineHeight: '14px',
    textAlign: 'center',
    boxSizing: 'border-box',
    boxShadow: `0 0 0 1.5px ${color.mantle}`,
  },
};

export default RailIconBtn;
