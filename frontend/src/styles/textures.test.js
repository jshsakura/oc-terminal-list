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
    // e-ink 계열은 질감의 **부재**가 정체성이다 — 주사선을 그으면 그 테마가 아니게 된다.
    expect(canvasTexture({ texture: 'flat' })).toBeNull();
  });

  it('lays scanlines on themes that say nothing about texture', () => {
    expect(canvasTexture({})).toContain('repeating-linear-gradient');
    expect(canvasTexture(undefined)).toContain('repeating-linear-gradient');
  });

  it('draws 1px on, 2px off — the reference cadence', () => {
    // game-and-what theme.css 의 `0 1px, transparent 1px 3px` 와 같은 주기.
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
