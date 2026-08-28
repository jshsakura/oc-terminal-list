import { describe, it, expect } from 'vitest';
import { buildThemeUI, isLight } from './themeUI';

/* Nothing here throws when it is wrong — a bad mix just produces a colour, and the only
   way to notice is to look at the screen. So the tests assert the property that matters:
   a tone derived from black and white must be *neutral*. */
const rgbOf = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const isNeutral = (hex) => {
  const [r, g, b] = rgbOf(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) <= 2;
};

describe('buildThemeUI', () => {
  it('keeps light-theme secondary text neutral, not tinted', () => {
    // The regression: mix(fg, '#fff', …) parsed 'fff' as 0x000fff — blue, not white — so
    // muted/faint on every light theme drifted navy.
    const ui = buildThemeUI({ background: '#ffffff', foreground: '#000000' });
    expect(isNeutral(ui.muted)).toBe(true);
    expect(isNeutral(ui.faint)).toBe(true);
    expect(isNeutral(ui.subtext)).toBe(true);
  });

  it('orders light-theme secondary text from darkest to faintest', () => {
    const ui = buildThemeUI({ background: '#ffffff', foreground: '#000000' });
    const lum = (hex) => rgbOf(hex).reduce((a, c) => a + c, 0);
    expect(lum(ui.subtext)).toBeLessThan(lum(ui.muted));
    expect(lum(ui.muted)).toBeLessThan(lum(ui.faint));
  });

  it('keeps the dark-theme surface ladder monotonically increasing', () => {
    const ui = buildThemeUI({ background: '#1a1a25', foreground: '#e4e6f1' });
    const lum = (hex) => rgbOf(hex).reduce((a, c) => a + c, 0);
    expect(lum(ui.base)).toBeLessThan(lum(ui.crust));
    expect(lum(ui.crust)).toBeLessThan(lum(ui.surface0));
    expect(lum(ui.surface0)).toBeLessThan(lum(ui.surface1));
    expect(lum(ui.surface1)).toBeLessThan(lum(ui.surface2));
  });

  it('reads the eink theme as a light theme', () => {
    expect(isLight('#ffffff')).toBe(true);
  });
});
