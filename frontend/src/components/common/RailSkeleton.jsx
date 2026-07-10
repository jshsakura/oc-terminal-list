import { tokens } from '../../styles/tokens';

const { color, radius } = tokens;

// keyframes 는 인스턴스마다 <style> 을 박지 않고 한 번만 head 에 넣는다.
// (common/SkeletonRow.jsx 와 같은 방식 — 레일 하나에 스켈레톤이 여러 개 뜬다.)
const STYLE_ID = 'iterm-rail-skel-style';
let injected = false;
const ensureStyle = () => {
  if (typeof document === 'undefined' || injected) return;
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `@keyframes iterm-rail-skel {
      0%   { background-position: 150% center; }
      100% { background-position: -150% center; }
    }`;
    document.head.appendChild(el);
  }
  injected = true;
};

/**
 * RailIconBtn 자리를 채우는 로딩 자리표시자.
 *
 * 실제 버튼과 **같은 외곽 치수**(compact 28×28 / 기본 32×32, inner 22×22 / 24×24)를 쓴다.
 * 예전엔 자리마다 13px 원·20×6 알약을 손으로 그려서, 로딩이 끝나는 순간 레일이 덜컹였다.
 * 여기서 한 번만 정의해 두면 버튼이 늘고 줄 때 스켈레톤도 같이 따라간다.
 */
const RailSkeleton = ({
  count = 1,
  compact = false,
  ui = null,
  gap = '1px',
  delayStep = 130,   // 항목마다 shimmer 시작을 어긋나게 (물결)
  delayOffset = 0,
}) => {
  const palette = ui || color;
  const outer = compact ? 28 : 32;
  const inner = compact ? 22 : 24;
  ensureStyle();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap, flexShrink: 0 }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            width: `${outer}px`,
            height: `${outer}px`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{
            width: `${inner}px`,
            height: `${inner}px`,
            borderRadius: radius.sm,
            background: `linear-gradient(90deg,
              color-mix(in srgb, ${palette.surface1 || '#45475a'} 45%, transparent) 0%,
              color-mix(in srgb, ${palette.accent || '#89b4fa'} 20%, transparent) 50%,
              color-mix(in srgb, ${palette.surface1 || '#45475a'} 45%, transparent) 100%)`,
            backgroundSize: '300% 100%',
            animation: 'iterm-rail-skel 1.6s ease-in-out infinite',
            animationDelay: `${delayOffset + i * delayStep}ms`,
          }} />
        </span>
      ))}
    </div>
  );
};

export default RailSkeleton;
