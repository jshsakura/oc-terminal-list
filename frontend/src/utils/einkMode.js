/**
 * E-ink ("이북") mode — everything one switch decides, in one file.
 *
 * An e-ink panel does not repaint, it *rewrites*. Every moving pixel is a partial
 * refresh, and one refresh costs ~100-300ms and leaves ghosting behind. So this mode
 * is not a colour scheme: it is a budget on **how often anything moves**.
 *
 * Three layers, one flag (`settings.einkMode`):
 *   1. CSS      `html[data-eink="1"]` kills transition/animation/blur/shadow — styles/einkCss.js
 *   2. settings EINK_SETTINGS_OVERRIDE below (smooth scroll, predictive echo, WebGL, contrast)
 *   3. theme    forced to the pure black-and-white `eink` theme
 *
 * ⚠️ It must be reversible. The user's own settings are never written — this module only
 *    hands out an *overridden copy*, so turning the mode off restores them untouched.
 *    That is also why the Settings modal still shows the user's real smoothScroll value.
 *
 * ⚠️ The flag is read at boot from localStorage **before React mounts** (main.jsx). If the
 *    attribute were only applied after the first render, an e-ink device would pay a full
 *    screen refresh for the animated first paint it is meant to avoid.
 */

export const EINK_THEME_ID = 'eink';
export const EINK_ATTR = 'data-eink';

/**
 * Settings this mode forces. Each one is a repaint source, not a taste:
 *  - smoothScroll     — interpolated scrolling is a repaint per frame; on paper it smears.
 *  - predictiveEcho   — ghost glyph then correction = two refreshes for one keystroke.
 *  - useWebgl         — e-ink devices are low-power Android; the DOM renderer draws real
 *                       text nodes, which their drivers refresh far better than a canvas.
 *  - terminalContrast — the eink theme is already pure grayscale, so the contrast pass
 *                       would recolour nothing while still costing per-cell work.
 *  - theme            — the mode *is* the monochrome theme; a colour theme on paper is mud.
 */
export const EINK_SETTINGS_OVERRIDE = Object.freeze({
  theme: EINK_THEME_ID,
  smoothScroll: false,
  predictiveEcho: false,
  useWebgl: false,
  terminalContrast: 'original',
});

export const isEinkEnabled = (settings) => settings?.einkMode === true;

/** A copy of `settings` with the mode's overrides applied. Returns the input untouched when off. */
export const applyEinkSettings = (settings) => {
  if (!isEinkEnabled(settings)) return settings;
  return { ...settings, ...EINK_SETTINGS_OVERRIDE };
};

/**
 * Which theme id actually renders. In e-ink mode the per-pane themeOverride (a host's own
 * colour) loses too — a mixed tab would otherwise put one coloured pane next to a paper one.
 */
export const resolveEinkThemeId = (themeId, einkMode) => (einkMode ? EINK_THEME_ID : themeId);

/** Reflect the flag onto <html> so styles/einkCss.js can take effect. */
export const applyEinkAttribute = (enabled) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (enabled) root.setAttribute(EINK_ATTR, '1');
  else root.removeAttribute(EINK_ATTR);
};

/**
 * Read the flag straight out of the settings cache, without React. Used only at boot, to
 * paint the very first frame in the right mode. A malformed cache is simply "off".
 */
export const readStoredEinkMode = (storageKey) => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    return JSON.parse(raw)?.einkMode === true;
  } catch {
    return false;
  }
};
