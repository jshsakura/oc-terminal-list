import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EINK_ATTR,
  EINK_POLL_FACTOR,
  einkPollMs,
  isEinkActive,
  EINK_SETTINGS_OVERRIDE,
  EINK_THEME_ID,
  applyEinkAttribute,
  applyEinkSettings,
  isEinkEnabled,
  readStoredEinkMode,
  resolveEinkThemeId,
} from './einkMode';
import themes from '../styles/themes';

describe('einkMode', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(EINK_ATTR);
    localStorage.clear();
  });

  it('leaves settings untouched when the mode is off', () => {
    const settings = { theme: 'dracula', smoothScroll: true, useWebgl: true };
    // Same reference — the override must not churn effectiveSettings for everyone else.
    expect(applyEinkSettings(settings)).toBe(settings);
  });

  it('overrides only its own keys and never mutates the original', () => {
    const settings = { theme: 'dracula', smoothScroll: true, useWebgl: true, fontSize: 14 };
    const next = applyEinkSettings({ ...settings, einkMode: true });

    expect(next.theme).toBe(EINK_THEME_ID);
    expect(next.smoothScroll).toBe(false);
    expect(next.predictiveEcho).toBe(false);
    expect(next.useWebgl).toBe(false);
    expect(next.terminalContrast).toBe('original');
    // Untouched keys survive...
    expect(next.fontSize).toBe(14);
    // ...and the user's own values are still there to come back to.
    expect(settings.theme).toBe('dracula');
    expect(settings.smoothScroll).toBe(true);
  });

  it('ships a theme for every id the override names', () => {
    // A typo here is invisible until a real e-ink device renders catppuccin.
    expect(themes[EINK_SETTINGS_OVERRIDE.theme]).toBeTruthy();
    expect(themes[EINK_THEME_ID].texture).toBe('flat');
  });

  it('beats a per-pane theme override', () => {
    expect(resolveEinkThemeId('gruvboxDark', true)).toBe(EINK_THEME_ID);
    expect(resolveEinkThemeId('gruvboxDark', false)).toBe('gruvboxDark');
  });

  it('treats anything but true as off', () => {
    expect(isEinkEnabled({ einkMode: 'yes' })).toBe(false);
    expect(isEinkEnabled({})).toBe(false);
    expect(isEinkEnabled(null)).toBe(false);
    expect(isEinkEnabled({ einkMode: true })).toBe(true);
  });

  describe('einkPollMs', () => {
    it('stretches a period only when the mode is on', () => {
      expect(einkPollMs(30000, false)).toBe(30000);
      expect(einkPollMs(30000, true)).toBe(30000 * EINK_POLL_FACTOR);
    });

    it('leaves "not polling" alone', () => {
      // 0 means no timer at all. Multiplying it would still be 0, but a caller passing a
      // falsy period must never come back with one armed.
      expect(einkPollMs(0, true)).toBe(0);
      expect(einkPollMs(undefined, true)).toBe(undefined);
    });

    it('reads the live flag off <html> when none is given', () => {
      // Module-level timers have no settings in scope; this is how they ask.
      applyEinkAttribute(false);
      expect(isEinkActive()).toBe(false);
      expect(einkPollMs(1000)).toBe(1000);

      applyEinkAttribute(true);
      expect(isEinkActive()).toBe(true);
      expect(einkPollMs(1000)).toBe(1000 * EINK_POLL_FACTOR);
    });
  });

  describe('applyEinkAttribute', () => {
    it('sets and clears the html flag', () => {
      applyEinkAttribute(true);
      expect(document.documentElement.getAttribute(EINK_ATTR)).toBe('1');
      applyEinkAttribute(false);
      expect(document.documentElement.hasAttribute(EINK_ATTR)).toBe(false);
    });
  });

  describe('readStoredEinkMode', () => {
    const KEY = 'terminal_settings';

    it('reads the flag out of the cached settings blob', () => {
      localStorage.setItem(KEY, JSON.stringify({ einkMode: true, theme: 'nord' }));
      expect(readStoredEinkMode(KEY)).toBe(true);
    });

    it('is off when there is nothing cached', () => {
      expect(readStoredEinkMode(KEY)).toBe(false);
    });

    it('is off — not a thrown boot — when the cache is corrupt', () => {
      // This runs before React mounts. A throw here is a blank page, not a wrong colour.
      localStorage.setItem(KEY, '{not json');
      expect(readStoredEinkMode(KEY)).toBe(false);
    });
  });
});
