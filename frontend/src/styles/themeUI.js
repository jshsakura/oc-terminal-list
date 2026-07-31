/**
 * 테마별 UI 팔레트 도출 (CSS 변수 매핑).
 *
 * 각 테마의 terminal 팔레트(theme.background/foreground/blue/red/...)에서
 * 사이드바/헤더/모달이 쓰는 ui-* 변수 셋을 생성.
 *
 * 다크 vs 라이트는 background 밝기로 자동 분기.
 */

const LIGHT_BACKGROUNDS = new Set(['#ffffff', '#fdf6e3', '#fbf1c7', '#fafafa', '#9bbc0f']);

export const isLight = (bg) => {
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

// hex 섞기 (col1 과 col2 를 t 비율로) — 사이드바 surface 단계 도출용
const mix = (col1, col2, t) => {
  const p1 = parseInt(col1.replace('#', ''), 16);
  const p2 = parseInt(col2.replace('#', ''), 16);
  const r1 = (p1 >> 16) & 0xff, g1 = (p1 >> 8) & 0xff, b1 = p1 & 0xff;
  const r2 = (p2 >> 16) & 0xff, g2 = (p2 >> 8) & 0xff, b2 = p2 & 0xff;
  const rr = Math.round(r1 + (r2 - r1) * t);
  const gg = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return `#${[rr, gg, bb].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export const buildThemeUI = (theme) => {
  const bg = theme.background || '#1a1a25';
  const fg = theme.foreground || '#e4e6f1';
  const accent = theme.ui?.accent || theme.blue || theme.cyan || '#89b4fa';
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

  // 다크 테마: 크롬이 콘텐츠보다 **위로 뜬다** (Termius/Warp 모델).
  //
  // 이전엔 crust/mantle 을 bg 에서 검정 쪽으로 25~40% 깎아 사이드바·탭바를 콘텐츠보다
  // 더 깊게 눌렀다(Zed/VSCode 관행). 그러면 크롬이 거의 순검정이 되고 그 위에 fg 가
  // 그대로 올라가 대비가 18:1 근처까지 벌어진다 — "고대비 모드" 같은 투박한 인상의 정체.
  //
  // 뒤집어서 터미널(base)이 가장 깊은 면이 되고 그걸 감싸는 크롬이 살짝 밝은 프레임이
  // 되게 한다. 부수 효과로 활성 탭(base)이 아래 터미널과 같은 톤으로 이어지고 비활성
  // 탭(mantle)이 그 위에 얹힌다.
  //
  // 사다리는 단조 증가여야 한다 — base < mantle < crust < surface0 < 1 < 2.
  // hover(surface0)가 크롬 바닥(crust)보다 확실히 밝아야 반응이 읽힌다.
  const white = '#ffffff';
  return {
    crust:    mix(bg, white, 0.06),    // 가장 바깥 프레임 (탭바·사이드바 바탕)
    mantle:   mix(bg, white, 0.035),   // 그 위 한 단계 (비활성 탭 등)
    base:     bg,                      // 콘텐츠(터미널) — 가장 깊은 면
    surface0: mix(bg, white, 0.10),
    surface1: mix(bg, white, 0.145),
    surface2: mix(bg, white, 0.20),
    text:     fg,
    // 크롬이 밝아진 만큼 보조 텍스트를 한 단계 내려 대비를 좁힌다.
    // muted/faint 는 건드리지 않는다 — 비활성 탭 라벨(12px)이 이미 AA 하한 근처라
    // 더 흐리면 가독성이 깨진다.
    subtext:  mix(fg, bg, 0.32),
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
