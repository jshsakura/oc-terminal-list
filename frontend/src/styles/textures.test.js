import { describe, it, expect } from 'vitest';
import { scanlines, vignette, canvasTexture } from './textures';

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

  it('inks the lines with the theme text colour, not black', () => {
    // 검정 선은 어두운 테마에서 배경과 3 RGB 차이라 보이지 않는다(실측). 글자색이어야
    // 어두운 테마엔 밝은 선, 밝은 테마엔 어두운 선이 되어 한 공식으로 양쪽이 성립한다.
    expect(canvasTexture({})).toContain('var(--ui-text');
  });

  it('goes fainter on light themes', () => {
    const alphaOf = (css) => Number(/([\d.]+)%/.exec(css)[1]);
    expect(alphaOf(canvasTexture({}, { light: true })))
      .toBeLessThan(alphaOf(canvasTexture({}, { light: false })));
  });
});
