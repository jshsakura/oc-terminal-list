/**
 * Daily-chart geometry — ported from llm-watcher's DailyChart, kept pure so it
 * can be tested without a DOM.
 *
 * Three rules carried over from the original, each for a reason that bites:
 *
 * - **Fill the gaps.** The API only returns days that had usage; a quiet week
 *   would otherwise render as one step and the trend would be a lie.
 * - **Monotone cubic interpolation.** A plain Catmull-Rom overshoots on spiky
 *   data and paints negative cost on the days you didn't work.
 * - **Nice ticks.** Axis labels land on 1 / 2 / 2.5 / 5 × 10ⁿ, the numbers people
 *   actually read.
 */

export const CHART_W = 1000;
export const CHART_H = 230;
export const PAD_L = 58;
export const PAD_R = 8;
export const PAD_T = 12;
export const PAD_B = 26;

/** Token buckets in stacking order. Order is the colour-safety mechanism — keep it. */
export const TOKEN_SERIES = [
  { key: 'input', label: 'tokensInput' },
  { key: 'output', label: 'tokensOutput' },
  { key: 'cache_read', label: 'tokensCacheRead' },
  { key: 'cache_creation', label: 'tokensCacheWrite' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function fillDayGaps(rows, cap = 400) {
  if (!Array.isArray(rows) || rows.length < 2) return rows || [];
  let cursor = Date.parse(`${rows[0].day}T00:00:00Z`);
  const last = Date.parse(`${rows[rows.length - 1].day}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(last)) return rows;
  const known = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  while (cursor <= last && out.length < cap) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    out.push(known.get(day) || {
      day, cost: 0, tokens: 0, input: 0, output: 0, cache_read: 0, cache_creation: 0, hosts: {},
    });
    cursor += DAY_MS;
  }
  return out;
}

export function niceTicks(max, count = 3) {
  if (!(max > 0)) return [];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || 10 * mag;
  const out = [];
  for (let v = step; v <= max * 1.0001; v += step) out.push(v);
  return out;
}

export function smoothPath(points) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0].x},${points[0].y}`;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
  }
  const m = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) m.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
    }
  }
  m.push(slope[n - 2]);
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    d += ` C${points[i].x + h},${points[i].y + m[i] * h}`
      + ` ${points[i + 1].x - h},${points[i + 1].y - m[i + 1] * h}`
      + ` ${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}

/**
 * Build the bands to draw.
 *
 * Cost is **one series**: a stack of hosts or token types reads as a single
 * colour anyway (cache reads dominate), and cost is one meaningful number.
 * Tokens stay stacked, which is what the legend and the table are for.
 *
 * @param {Array} days     rows (already gap-filled)
 * @param {string} metric  'cost' | 'tokens'
 * @param {Array} palette  colours in stacking order (token mode) or [accent]
 */
export function buildChart(days, metric, palette) {
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const baseY = PAD_T + plotH;
  const empty = { bands: [], xs: [], ticks: [], xLabels: [], baseY, scaleMax: 1 };
  if (!Array.isArray(days) || days.length === 0) return empty;

  const costMode = metric !== 'tokens';
  const layers = costMode
    ? [{ key: 'cost', label: 'llmCost' }]
    : TOKEN_SERIES;

  const totalOf = (d) => (costMode ? Number(d.cost) || 0 : Number(d.tokens) || 0);
  const dataMax = days.reduce((m, d) => Math.max(m, totalOf(d)), 0);
  const ticks = niceTicks(dataMax);
  const scaleMax = Math.max(ticks[ticks.length - 1] || 0, dataMax) || 1;

  const n = days.length;
  const xs = days.map((_, i) => (n === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW));
  const y = (v) => PAD_T + (1 - v / scaleMax) * plotH;

  const cum = new Array(n).fill(0);
  const bands = layers.map((layer, idx) => {
    const points = days.map((d, i) => {
      cum[i] += costMode ? (Number(d.cost) || 0) : (Number(d[layer.key]) || 0);
      return { x: xs[i], y: y(cum[i]) };
    });
    const line = smoothPath(points);
    return {
      ...layer,
      accent: palette[idx % palette.length],
      line,
      area: `${line} L${xs[n - 1]},${baseY} L${xs[0]},${baseY} Z`,
      tops: points.map((p) => p.y),
    };
  });

  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const xLabels = days
    .map((d, i) => ({ day: d.day, x: xs[i], i }))
    .filter((l) => l.i % labelEvery === 0);

  return { bands, xs, ticks: ticks.map((value) => ({ value, y: y(value) })), xLabels, baseY, scaleMax };
}

/** 2026-08-05 → 08-05 (the original's axis form). */
export const shortDay = (day) => String(day || '').slice(5);
