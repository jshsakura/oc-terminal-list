import { describe, it, expect } from 'vitest';
import { buildChart, fillDayGaps, niceTicks, smoothPath } from './llmChartGeometry';

// Ported from llm-watcher. Three properties matter, and each one is a bug people
// actually see when it breaks.

describe('fillDayGaps', () => {
  it('inserts the quiet days — otherwise a week-long gap renders as one step', () => {
    const filled = fillDayGaps([
      { day: '2026-08-01', cost: 1 },
      { day: '2026-08-04', cost: 2 },
    ]);
    expect(filled.map((d) => d.day)).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
    ]);
    expect(filled[1].cost).toBe(0);
  });

  it('leaves short or unparseable input alone', () => {
    expect(fillDayGaps([])).toEqual([]);
    expect(fillDayGaps(null)).toEqual([]);
    const bad = [{ day: 'nope' }, { day: 'still-nope' }];
    expect(fillDayGaps(bad)).toEqual(bad);
  });
});

describe('niceTicks', () => {
  it('lands on numbers people read', () => {
    expect(niceTicks(100)).toEqual([50, 100]);
    expect(niceTicks(9)).toEqual([5]);     // count=3 → step 5 is the first 'nice' one that fits
  });

  it('has nothing to draw at or below zero', () => {
    expect(niceTicks(0)).toEqual([]);
    expect(niceTicks(-3)).toEqual([]);
  });
});

describe('smoothPath — monotone cubic', () => {
  it('never dips below the surrounding points (a spline would)', () => {
    // Spiky series: a Catmull-Rom overshoots here and paints negative cost.
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 100 }, { x: 30, y: 10 }];
    const d = smoothPath(pts);
    const ys = d.match(/,(-?\d+(?:\.\d+)?)/g).map((m) => Number(m.slice(1)));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100.001);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.001);
  });

  it('degenerates safely', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1,2');
  });
});

describe('buildChart', () => {
  const days = [
    { day: '2026-08-01', cost: 1, tokens: 100, input: 40, output: 20, cache_read: 30, cache_creation: 10 },
    { day: '2026-08-02', cost: 3, tokens: 300, input: 100, output: 50, cache_read: 100, cache_creation: 50 },
  ];

  it('cost is one series — a stack of anything reads as one colour anyway', () => {
    const c = buildChart(days, 'cost', ['#89b4fa']);
    expect(c.bands).toHaveLength(1);
    expect(c.bands[0].key).toBe('cost');
  });

  it('tokens stack in fixed slot order — the order is the colour safety, not cosmetics', () => {
    const c = buildChart(days, 'tokens', ['a', 'b', 'c', 'd']);
    expect(c.bands.map((b) => b.key)).toEqual(['input', 'output', 'cache_read', 'cache_creation']);
    expect(c.bands.map((b) => b.accent)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the top band reaches the plot top and areas close on the baseline', () => {
    const c = buildChart(days, 'tokens', ['a', 'b', 'c', 'd']);
    const top = c.bands.at(-1);
    expect(Math.min(...top.tops)).toBeLessThan(c.baseY);
    c.bands.forEach((b) => expect(b.area.trim().endsWith('Z')).toBe(true));
  });

  it('survives an empty range', () => {
    expect(buildChart([], 'cost', ['x']).bands).toEqual([]);
  });
});
