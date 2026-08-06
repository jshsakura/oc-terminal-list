import { describe, it, expect } from 'vitest';
import { scanlines, vignette, canvasTexture, canvasWash } from './textures';

describe('scanlines', () => {
  it('draws a 1px line every period px', () => {
    const css = scanlines({ line: 'rgba(0, 0, 0, 0.1)', period: 4 });
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('rgba(0, 0, 0, 0.1) 1px');
    expect(css).toContain('transparent 4px');
  });
});

describe('vignette', () => {
  it('darkens only the outer edge', () => {
    expect(vignette(0.2)).toContain('transparent 66%');
  });
});

describe('canvasTexture', () => {
  it('lays nothing on a theme that declares itself flat', () => {
    // For the e-ink family the ABSENCE of texture is the identity — scanlines would
    // make it a different theme.
    expect(canvasTexture({ texture: 'flat' })).toBeNull();
  });

  it('lays scanlines on themes that say nothing about texture', () => {
    expect(canvasTexture({})).toContain('repeating-linear-gradient');
    expect(canvasTexture(undefined)).toContain('repeating-linear-gradient');
  });

  it('draws 1px on, 2px off — the reference cadence', () => {
    // Same cadence as game-and-what theme.css: `0 1px, transparent 1px 3px`.
    expect(canvasTexture({})).toContain('transparent 3px');
  });
});

describe('canvasWash', () => {
  it('lights the canvas from the top instead of a flat fill', () => {
    expect(canvasWash({})).toContain('circle at 50% 0%');
  });

  it('stays flat on a theme that declares itself flat', () => {
    expect(canvasWash({ texture: 'flat' })).toBeNull();
  });
});
