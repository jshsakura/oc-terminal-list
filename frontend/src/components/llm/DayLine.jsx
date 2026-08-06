import { useMemo, useState } from 'react';
import { tokens as designTokens } from '../../styles/tokens';
import { CHART_W, CHART_H, PAD_L, PAD_R, PAD_T, buildChart, shortDay } from './llmChartGeometry';

const { color, font, fontSize, radius } = designTokens;

/**
 * 일별 사용 시간 — 라인(면적) 그래프.
 *
 * 처음엔 막대로 그렸는데, 바로 아래 LLM 일별 지출이 라인이라 같은 화면에 다른 문법의
 * 그래프가 둘 있는 꼴이었다. 게다가 "매일 얼마나" 는 개별 값의 비교가 아니라 **흐름**이다 —
 * 라인이 그 질문에 맞는 형태다.
 *
 * 기하 계산은 `llmChartGeometry` 를 그대로 쓴다(단조 3차 보간·nice ticks·갭 채우기). 축
 * 라벨만 시간 단위로 포맷한다 — 여기 y 는 돈이 아니라 초다.
 */
const DayLine = ({ byDay = [], format, t }) => {
  const [hover, setHover] = useState(null);

  // 기하 계산은 `cost` 필드를 본다 — 초를 그 자리에 넣는다(축 포맷만 다르다).
  const days = useMemo(
    () => (byDay || []).map((d) => ({ day: d.day, cost: Number(d.seconds) || 0 })),
    [byDay],
  );
  /* 색은 액센트가 아니라 `info`(=테마의 cyan/blue)다. 바로 아래 LLM 일별 지출이 액센트를
     쓰므로 같은 색이면 한 화면의 두 그래프가 같은 값의 두 표현처럼 보인다.
     선은 단색이 아니라 **테마 두 색을 가로로 흐르게** 칠한다(info → success). 둘 다
     테마의 터미널 팔레트에서 나오므로(themeUI: cyan/green) 테마를 갈면 그래프의 색조가
     통째로 따라 바뀐다 — 고정값은 여기 없다. */
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
          {/* 선 — 가로로 테마 두 색이 흐른다. */}
          <linearGradient id="day-usage-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color.info} />
            <stop offset="100%" stopColor={color.success} />
          </linearGradient>
          {/* 면 — 같은 두 색을 아래로 흐리게. 위는 진하고 바닥에서 사라진다. */}
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
              /* 점은 그라디언트가 아니라 단색이다 — 3.5px 짜리 원에 가로 그라디언트를
                 물리면 그 지점의 한 조각만 잘려 색이 어긋나 보인다. */
              <circle key={band.key} cx={chart.xs[hover]} cy={band.tops[hover]} r="3.5"
                fill={color.info} stroke={color.base} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}
      </svg>

      {/* 축 라벨은 HTML — SVG text 는 preserveAspectRatio=none 에서 가로로 눌린다. */}
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
