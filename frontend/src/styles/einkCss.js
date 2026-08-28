/**
 * The e-ink stylesheet — injected once, inert until <html data-eink="1"> is set.
 *
 * Everything here is `!important` on purpose. This app's glass, transitions and shadows
 * are mostly **inline styles** (glass.js and dashboardCard.js hand back style objects),
 * and specificity cannot beat an inline style — only `!important` can.
 *
 * Read it as three groups: kill motion, kill translucency, keep the feedback that motion
 * used to carry. The third group matters — "did my tap register?" still has to be
 * answerable on a screen that takes a quarter second to redraw.
 */
export const EINK_CSS = `
html[data-eink="1"] {
  /* Blur is per-frame GPU work and the single most expensive thing on this class of
     device. The whole app already routes blur through these vars, so zeroing them here
     turns every glass surface off at once. */
  --glass-blur-menu: 0px;
  --glass-blur-panel: 0px;
  --glass-blur-overlay: 0px;
  --glass-blur-card: 0px;

  /* With the blur gone, "translucent" is just "you can see through it" — a menu with the
     terminal showing through it is unreadable on paper. Every neutral surface in the app
     mixes its fill through these two names, so this pair turns them all opaque at once.
     ⚠️ Accent tints are deliberately NOT routed here: they sit on a face that is already
     opaque, and at 100% they would become colour blocks over the text. */
  --glass-fill: 100%;
  --glass-line: 100%;

  /* buildThemeUI derives light-theme borders as 10% black. That is invisible on e-ink,
     and once shadows are gone the border is the ONLY thing separating two panels.
     These beat applyThemeVars' inline custom properties because !important outranks
     a normal inline declaration. */
  --ui-border: #6b6b6b !important;
  --ui-border-strong: #000000 !important;
  --ui-border-subtle: #a8a8a8 !important;

  /* A dark scrim means repainting the whole screen to grey and back. Cover the page with
     paper instead — and **fully**: a translucent scrim leaves the terminal ghosting
     through the modal, which is exactly the thing this mode exists to remove. */
  --ui-scrim: var(--ui-crust, #ffffff) !important;
  --modal-scrim: var(--ui-crust, #ffffff);
}

html[data-eink="1"] *,
html[data-eink="1"] *::before,
html[data-eink="1"] *::after {
  animation: none !important;
  transition: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  scroll-behavior: auto !important;
}

/* The pressed state stays — but as a still frame, not a movement. The global rule in
   main.jsx scales and brightens; both are cheap on a compositor and ruinous on paper.
   An inset outline says the same thing and costs one redraw of the button's own box. */
html[data-eink="1"] button:not(:disabled):active,
html[data-eink="1"] .iterm-pressable:not([aria-disabled="true"]):active {
  transform: none !important;
  filter: none !important;
  outline: 2px solid var(--ui-text, #000000) !important;
  outline-offset: -2px !important;
}

/* A blinking cursor is the most expensive decoration there is: it asks for a refresh
   once or twice a second while the machine is doing nothing at all. xterm's own blink
   is off via cursorBlink (createXtermInstance); this catches the DOM renderer's class
   and any CSS caret we do not own. */
html[data-eink="1"] .xterm-cursor-blink,
html[data-eink="1"] .xterm-cursor-blink-block {
  animation: none !important;
}

/* Skeletons and the "breathing" liveness dot are both pure opacity loops. On paper they
   are a refresh every few seconds forever. Freeze them at full strength — the colour
   already says what the pulse was saying. */
html[data-eink="1"] .iterm-breathe,
html[data-eink="1"] .dc-spin {
  opacity: 1 !important;
}
`;

export default EINK_CSS;
