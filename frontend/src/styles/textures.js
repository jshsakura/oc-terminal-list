/**
 * CSS textures — all static gradients (no animation). They are composited only,
 * so they can sit anywhere on screen without costing a frame. This is the only
 * texture technique that respects the app's latency-first rule.
 *
 * The pane overlay (TerminalTexture) and the home canvas share one formula here;
 * defined twice, their period and density drift apart over time.
 */

/**
 * Scanlines: a 1px line every `period` px.
 * @param line   full CSS colour for the line. Ink differs over text vs. over a background.
 * @param period distance between lines, in px.
 */
export const scanlines = ({ line = 'rgba(0, 0, 0, 0.1)', period = 4 } = {}) => `repeating-linear-gradient(
  to bottom,
  ${line} 0px,
  ${line} 1px,
  transparent 1px,
  transparent ${period}px
)`;

/** Darkened edges — the other half of the CRT curvature illusion. */
export const vignette = (alpha = 0.2) => `radial-gradient(ellipse at center, transparent 66%, rgba(0,0,0,${alpha}) 100%)`;

/* ─── Home canvas = a screen; cards = glass panes laid on it ──────────────────
 *
 * The formula comes from the sibling project (game-and-what `frontend/src/theme.css`).
 * What it taught: lines over a flat fill are just wallpaper stripes; a wash lit
 * from the top is what turns the surface into a screen.
 *
 * That project overlays its scanlines on top of everything (`body::before`) — right
 * for an app that IS one LCD screen. Ours is not: the dashboard is a screen you read
 * numbers off, and lines printed across a card put a pattern on top of the values.
 * So the lines stay on the canvas only, and cards sit on them as glass. The blur
 * carries the texture into the card without a crisp line crossing a number.
 *
 * The ink is black. A light ink was tried because black lines sit only 3 RGB steps
 * from a dark background — but that was before the wash existed. With the wash
 * providing the light/dark modulation, black reads on light and dark themes alike.
 */
const CANVAS_LINE = 'rgba(0, 0, 0, 0.11)';
const CANVAS_PERIOD = 3;        // 1px line + 2px gap

/**
 * Scanlines for the home canvas. They sit BEHIND the cards.
 *
 * A theme that declares `texture: 'flat'` gets nothing — for the e-ink family the
 * ABSENCE of texture is the identity, and scanlines would make it a different theme.
 *
 * This pairs with the dashboard card glass (`styles/dashboardCard.js`): glass needs
 * something behind it to blur, and lines need glass to read as "behind the screen".
 *
 * @returns {string|null} a background-image value, or null for no texture
 */
export const canvasTexture = (theme) => {
  if (theme?.texture === 'flat') return null;
  return scanlines({ line: CANVAS_LINE, period: CANVAS_PERIOD });
};

/**
 * Canvas base — a wash lit from the top. A flat fill under scanlines still reads as
 * paper. Themes that refuse texture get no wash either; their flatness is deliberate.
 */
export const canvasWash = (theme) => {
  if (theme?.texture === 'flat') return null;
  return 'radial-gradient(circle at 50% 0%,'
    + ' color-mix(in srgb, var(--ui-text, #e4e6f1) 5%, var(--ui-base, #1a1a25)),'
    + ' var(--ui-base, #1a1a25))';
};
