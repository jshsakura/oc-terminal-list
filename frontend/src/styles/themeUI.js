/**
 * 테마별 UI 팔레트 도출 (CSS 변수 매핑).
 *
 * 각 테마의 terminal 팔레트(theme.background/foreground/blue/red/...)에서
 * 사이드바/헤더/모달이 쓰는 ui-* 변수 셋을 생성.
 *
 * 다크 vs 라이트는 background 밝기로 자동 분기.
 */

const LIGHT_BACKGROUNDS = new Set(['#ffffff', '#fdf6e3', '#fbf1c7', '#fafafa']);

const isLight = (bg) => {
  if (!bg) return false;
  if (LIGHT_BACKGROUNDS.has(bg.toLowerCase())) return true;
  // hex → 밝기 추정
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // perceived luminance
  return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
};

// hex + alpha (0~1) → rgba 문자열
const rgba = (hex, alpha) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// hex 섞기 (a 와 b 를 t 비율로) — 사이드바 surface 단계 도출용
const mix = (a, b, t) => {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b = Math.round(ab + (bb - ab) * t);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export const buildThemeUI = (theme) => {
  const bg = theme.background || '#1a1a25';
  const fg = theme.foreground || '#e4e6f1';
  const accent = theme.blue || theme.cyan || '#89b4fa';
  const success = theme.green || '#a6e3a1';
  const warning = theme.yellow || '#f9e2af';
  const danger  = theme.red || '#f38ba8';
  const info    = theme.cyan || theme.blue || '#74c7ec';
  const light = isLight(bg);

  if (light) {
    // 라이트 테마: 거의 흰 surface, 어두운 텍스트
    const black = '#000000';
    return {
      crust:    '#ffffff',
      mantle:   mix(bg, black, 0.04),
      base:     bg,
      surface0: mix(bg, black, 0.05),
      surface1: mix(bg, black, 0.10),
      surface2: mix(bg, black, 0.16),
      text:     fg,
      subtext:  mix(fg, '#000', 0.25),
      muted:    mix(fg, '#fff', 0.40),
      faint:    mix(fg, '#fff', 0.60),
      accent,
      'accent-subtle':  rgba(accent, 0.12),
      'accent-border':  rgba(accent, 0.40),
      success, warning, danger, info,
      border:        rgba('#000000', 0.10),
      'border-strong': rgba('#000000', 0.18),
      'border-subtle': rgba('#000000', 0.05),
      scrim:         rgba('#000000', 0.40),
    };
  }

  // 다크 테마: 사이드바를 base 보다 한 단계 더 깊게 (Zed 톤)
  const black = '#000000';
  return {
    crust:    mix(bg, black, 0.40),
    mantle:   mix(bg, black, 0.25),
    base:     bg,
    surface0: mix(bg, '#ffffff', 0.05),
    surface1: mix(bg, '#ffffff', 0.10),
    surface2: mix(bg, '#ffffff', 0.16),
    text:     fg,
    subtext:  mix(fg, bg, 0.25),
    muted:    mix(fg, bg, 0.50),
    faint:    mix(fg, bg, 0.70),
    accent,
    'accent-subtle': rgba(accent, 0.12),
    'accent-border': rgba(accent, 0.32),
    success, warning, danger, info,
    border:        rgba(fg, 0.06),
    'border-strong': rgba(fg, 0.12),
    'border-subtle': rgba(fg, 0.03),
    scrim:         rgba('#000000', 0.55),
  };
};

export const applyThemeVars = (theme) => {
  const root = document.documentElement;
  const ui = buildThemeUI(theme);
  for (const [key, value] of Object.entries(ui)) {
    root.style.setProperty(`--ui-${key}`, value);
  }
};
