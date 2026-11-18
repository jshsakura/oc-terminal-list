import { describe, expect, it } from 'vitest';
import { ACTIVE_TAB_PX, COMPACT_MIN_PX, ICON_TAB_PX, TAB_DENSITY, tabDensity, tabHitSizing } from './tabDensity';

describe('tabDensity', () => {
  it('keeps the full chip when every tab gets enough room', () => {
    expect(tabDensity(1000, 5)).toBe(TAB_DENSITY.FULL);
  });

  it('stays full before the first measurement and for a single tab', () => {
    expect(tabDensity(0, 20)).toBe(TAB_DENSITY.FULL);
    expect(tabDensity(80, 1)).toBe(TAB_DENSITY.FULL);
  });

  it('goes compact when full chips would clip names to a glyph', () => {
    // 13 tabs in ~1000px is the reported screenshot: ~72px each.
    expect(tabDensity(1000, 13)).toBe(TAB_DENSITY.COMPACT);
  });

  it('drops names entirely when even compact chips would be too narrow', () => {
    expect(tabDensity(600, 13)).toBe(TAB_DENSITY.ICON);
  });

  it('gives the full width to inactive tabs when no tab is active (home)', () => {
    // 10 tabs in 700px: with an active tab reserved they fall under COMPACT_MIN_PX.
    expect(tabDensity(700, 10, true)).toBe(TAB_DENSITY.ICON);
    expect(tabDensity(700, 10, false)).toBe(TAB_DENSITY.COMPACT);
  });
});

describe('tabHitSizing', () => {
  it('leaves full density to the default styles', () => {
    expect(tabHitSizing(TAB_DENSITY.FULL, true)).toBeNull();
    expect(tabHitSizing(TAB_DENSITY.FULL, false)).toBeNull();
  });

  it('pins the active tab so its name never clips', () => {
    expect(tabHitSizing(TAB_DENSITY.ICON, true).minWidth).toBe(`${ACTIVE_TAB_PX}px`);
  });

  it('sizes inactive chips per density', () => {
    expect(tabHitSizing(TAB_DENSITY.COMPACT, false).minWidth).toBe(`${COMPACT_MIN_PX}px`);
    expect(tabHitSizing(TAB_DENSITY.ICON, false).flex).toBe(`0 0 ${ICON_TAB_PX}px`);
  });
});
