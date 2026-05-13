import { tokens } from '../../styles/tokens';

const { color, radius } = tokens;

const skelKeyframes = `@keyframes skel-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.7; }
}`;

let injected = false;
const ensureStyle = () => {
  if (typeof document === 'undefined' || injected) return;
  if (!document.getElementById('skel-pulse-style')) {
    const el = document.createElement('style');
    el.id = 'skel-pulse-style';
    el.textContent = skelKeyframes;
    document.head.appendChild(el);
    injected = true;
  }
};

const SkeletonRow = ({
  width = '60%',
  height = '12px',
  borderRadius,
  style,
  ...rest
}) => {
  ensureStyle();
  return (
    <div
      aria-busy="true"
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: borderRadius || radius.xs,
        background: color.surface2,
        animation: 'skel-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
      {...rest}
    />
  );
};

export const SkeletonBlock = ({
  rows = 5,
  rowHeight = '12px',
  widths,
  gap = '6px',
  style,
  ...rest
}) => {
  const arr = Array.from({ length: rows }, (_, i) => i);
  return (
    <div
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap, ...style }}
      {...rest}
    >
      {arr.map((i) => (
        <SkeletonRow
          key={i}
          width={widths?.[i] || `${50 + Math.random() * 30}%`}
          height={rowHeight}
        />
      ))}
    </div>
  );
};

export default SkeletonRow;
