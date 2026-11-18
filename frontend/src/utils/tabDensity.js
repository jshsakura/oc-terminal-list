/**
 * How much of each tab chip fits, decided once for the whole bar.
 *
 *  full    — number tile · host tile · name · ⋯ slot (the normal chip)
 *  compact — inactive chips merge the number into the host tile and drop the ⋯ slot,
 *            so the name gets ~4-5 glyphs instead of 1
 *  icon    — inactive chips are the merged tile alone; the name lives in the tooltip
 *
 * The active tab never shrinks below ACTIVE_TAB_PX: "where am I" is the one thing the
 * bar must always say. Measured on the list once, not per tab (one ResizeObserver).
 */

export const TAB_DENSITY = Object.freeze({ FULL: 'full', COMPACT: 'compact', ICON: 'icon' });

// Must match tabBarStyles.tabHit.flex basis and tabList.gap.
export const ACTIVE_TAB_PX = 156;
export const TAB_GAP_PX = 6;
// Full chip fixed cost is ~80px (padding, two tiles, ⋯ slot, gaps); below 120 the name
// gets under ~40px and starts reading as a single clipped glyph.
export const FULL_MIN_PX = 120;
// Compact fixed cost is ~33px; 60 leaves ~27px ≈ 4 glyphs. Below that one glyph + "…"
// is noise, so the name goes away entirely.
export const COMPACT_MIN_PX = 60;
export const ICON_TAB_PX = 34;

const perTab = (space, count) => (count > 0 ? space / count : Infinity);

export function tabDensity(listWidth, tabCount, hasActive = true) {
  if (!(listWidth > 0) || tabCount <= 1) return TAB_DENSITY.FULL;
  const gaps = TAB_GAP_PX * (tabCount - 1);
  if (perTab(listWidth - gaps, tabCount) >= FULL_MIN_PX) return TAB_DENSITY.FULL;
  const others = hasActive ? tabCount - 1 : tabCount;
  const rest = listWidth - gaps - (hasActive ? ACTIVE_TAB_PX : 0);
  return perTab(rest, others) >= COMPACT_MIN_PX ? TAB_DENSITY.COMPACT : TAB_DENSITY.ICON;
}

/** Outer hit-area sizing override for a tab, or null to keep the default. */
export function tabHitSizing(density, isActive) {
  if (density === TAB_DENSITY.FULL) return null;
  if (isActive) return { flex: `0 0 ${ACTIVE_TAB_PX}px`, minWidth: `${ACTIVE_TAB_PX}px`, maxWidth: `${ACTIVE_TAB_PX}px` };
  if (density === TAB_DENSITY.COMPACT) {
    return { flex: '1 1 0', minWidth: `${COMPACT_MIN_PX}px`, maxWidth: `${ACTIVE_TAB_PX}px` };
  }
  return { flex: `0 0 ${ICON_TAB_PX}px`, minWidth: `${ICON_TAB_PX}px`, maxWidth: `${ICON_TAB_PX}px` };
}
