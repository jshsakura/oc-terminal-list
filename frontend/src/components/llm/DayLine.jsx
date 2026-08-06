import { useMemo, useState } from 'react';
import { tokens as designTokens } from '../../styles/tokens';
import { CHART_W, CHART_H, PAD_L, PAD_R, PAD_T, buildChart, shortDay } from './llmChartGeometry';

const { color, font, fontSize, radius } = designTokens;

/**
 * Daily terminal time — an area/line chart.
 *
 * It started as bars, but the LLM spend chart right below it is a line, so one screen
 * carried two chart grammars. And "how much each day" is not a comparison of individual
 * values, it is a **trend** — a line is the shape that answers it.
 *
 * The geometry is `llmChartGeometry` unchanged (monotone cubic, nice ticks, gap filling).
 * Only the axis labels differ: y here is seconds, not money.
 */
const DayLine = ({ byDay = [], format, t }) => {
  const [hover, setHover] = useState(null);

  // The geometry reads a `cost` field — seconds go in that slot (only formatting differs).
  const days = useMemo(
    () => (byDay || []).map((d) => ({ day: d.day, cost: Number(d.seconds) || 0 })),
    [byDay],
  );
  /* The colour is `info` (the theme's cyan/blue), not the accent: the LLM spend chart
     below uses the accent, and two charts in the same colour read as two views of the
     same number. The stroke is not flat either — it sweeps across **two theme colours**
     (info → success). Both come from the theme's terminal palette (themeUI: cyan/green),
     so switching themes moves the whole chart's hue. Nothing here is hardcoded. */
  const chart = useMemo(() => buildChart(days, 'cost', ['url(#day-usage-stroke)']), [days]);
  if (days.length < 2) return null;

  const plotW = CHART_W - PAD_L - PAD_R;
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * CHART_W;
    const i = Math.round(((rel - PAD_L) / plotW) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };
  const shown = hover == null ? null : days[hover];
  const fmt = (seconds) => (format ? format(seconds) : `${seconds}`);
  const leftPct = hover != null && chart.xs[hover] != null ? (chart.xs[hover] / CHART_W) * 100 : null;
  const topPct = hover != null && chart.bands[0]?.tops[hover] != null
    ? (chart.bands[0].tops[hover] / CHART_H) * 100
    : 0;

  return (
    <div style={wrapStyle}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        style={svgStyle}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={t?.('dailyUsage') || 'Daily usage'}
      >
        <defs>
          {/* Stroke — two theme colours sweeping horizontally. */}
          <linearGradient id="day-usage-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color.info} />
            <stop offset="100%" stopColor={color.success} />
          </linearGradient>
          {/* Fill — the same two colours fading downward; strong on top, gone at the base. */}
          <linearGradient id="day-usage-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color.info} stopOpacity="0.40" />
            <stop offset="55%" stopColor={color.success} stopOpacity="0.20" />
            <stop offset="100%" stopColor={color.success} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {chart.ticks.map((tick) => (
          <line key={tick.value} x1={PAD_L} x2={CHART_W - PAD_R} y1={tick.y} y2={tick.y}
            stroke={color.border} strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={PAD_L} x2={CHART_W - PAD_R} y1={chart.baseY} y2={chart.baseY}
          stroke={color.border} strokeWidth="1" vectorEffect="non-scaling-stroke" />

        {chart.bands.map((band) => (
          <g key={band.key}>
            <path d={band.area} fill="url(#day-usage-fill)" />
            <path d={band.line} fill="none" stroke={band.accent} strokeWidth="2"
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}

        {hover != null && chart.xs[hover] != null && (
          <g>
            <line x1={chart.xs[hover]} x2={chart.xs[hover]} y1={PAD_T} y2={chart.baseY}
              stroke={color.text} strokeWidth="1" opacity="0.45" vectorEffect="non-scaling-stroke" />
            {chart.bands.map((band) => (
              /* The dot is flat, not gradient — a horizontal gradient on a 3.5px circle
                 slices one sliver of the ramp and the colour looks wrong. */
              <circle key={band.key} cx={chart.xs[hover]} cy={band.tops[hover]} r="3.5"
                fill={color.info} stroke={color.base} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}
      </svg>

      {/* Axis labels are HTML — SVG text gets squashed under preserveAspectRatio=none. */}
      {chart.ticks.map((tick) => (
        <span
          key={tick.value}
          style={{ ...yTickStyle, top: `${(tick.y / CHART_H) * 100}%`, width: `${(PAD_L / CHART_W) * 100}%` }}
        >
          {fmt(tick.value)}
        </span>
      ))}
      {chart.xLabels.map((label) => (
        <span key={label.day} style={{ ...xTickStyle, left: `${(label.x / CHART_W) * 100}%` }}>
          {shortDay(label.day)}
        </span>
      ))}

      {shown && leftPct != null && (
        <div
          style={{
            ...tooltipStyle,
            left: `${Math.max(4, Math.min(96, leftPct))}%`,
            top: `${topPct}%`,
            transform: `translate(${leftPct < 12 ? '0' : leftPct > 88 ? '-100%' : '-50%'}, calc(-100% - 10px))`,
          }}
        >
          <span style={{ color: color.subtext }}>{shortDay(shown.day)}</span>
          <strong style={{ color: color.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(shown.cost)}</strong>
        </div>
      )}
    </div>
  );
};

const wrapStyle = { position: 'relative', width: '100%' };
const svgStyle = { display: 'block', width: '100%', height: `${CHART_H}px` };
const yTickStyle = {
  position: 'absolute', left: 0, transform: 'translateY(-50%)',
  paddingRight: '6px', textAlign: 'right',
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
  pointerEvents: 'none', whiteSpace: 'nowrap',
};
const xTickStyle = {
  position: 'absolute', bottom: 0, transform: 'translateX(-50%)',
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
  pointerEvents: 'none', whiteSpace: 'nowrap',
};
const tooltipStyle = {
  position: 'absolute',
  display: 'inline-flex', alignItems: 'baseline', gap: '6px',
  padding: '4px 8px', whiteSpace: 'nowrap',
  fontSize: fontSize['11'], fontFamily: font.sans, borderRadius: radius.sm,
  background: `color-mix(in srgb, ${color.surface1} 92%, transparent)`,
  border: `1px solid ${color.borderStrong}`,
  boxShadow: `0 4px 14px color-mix(in srgb, ${color.crust} 60%, transparent)`,
  backdropFilter: 'blur(var(--glass-blur-card, 12px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-card, 12px))',
  pointerEvents: 'none',
  zIndex: 3,
};

export default DayLine;
