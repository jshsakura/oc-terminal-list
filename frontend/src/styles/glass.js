import { tokens } from './tokens';

const { color } = tokens;

const ui = {
  base: `var(--ui-base, ${color.base})`,
  surface0: `var(--ui-surface0, ${color.surface0})`,
  surface1: `var(--ui-surface1, ${color.surface1})`,
  surface2: `var(--ui-surface2, ${color.surface2})`,
  border: `var(--ui-border, ${color.border})`,
};

const pick = (theme, key, fallback) => theme?.[key] || fallback;

/* blur 양은 var(--glass-blur-*) 로 — main.jsx 가 모바일에서 더 작은 값으로 override 함.
 *
 * 채움/테두리의 **비율도** var 이다: `var(--glass-fill, 34%)`. 이름은 하나뿐이고
 * **각 자리가 자기 기본값을 fallback 으로 들고 있다** — 그래서 :root 에 기본값을 둘
 * 필요가 없고, 이북 모드는 스위치 하나(`--glass-fill: 100%`)로 전부를 불투명으로 만든다.
 *
 * ⚠️ 리터럴 퍼센트를 박으면 그 면만 이북 모드에서 투명하게 남는다 — 인라인 style 객체로
 * 나가는 값이라 CSS 특이도로는 못 닿는다. `styles/glassFill.test.js` 가 그것을 막는다.
 * ⚠️ 액센트/위험색 **틴트**는 대상이 아니다. 그건 이미 불투명한 면 *위에* 얹는 색이라
 * 100% 로 만들면 글자를 덮는 색 블록이 된다. 이 var 는 **중립 면**(surface/base/mantle)만. */
export const glassMenuStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'surface0', ui.surface0)} var(--glass-fill, 34%), transparent)`,
  border: `1px solid color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line, 24%), transparent)`,
  borderRadius: '8px',
  boxShadow: '0 6px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.02)',
  backdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  padding: '3px',
  ...overrides,
});

export const glassPanelStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} var(--glass-fill, 72%), transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line, 72%), transparent)`,
  boxShadow: '0 10px 34px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
  backdropFilter: 'blur(var(--glass-blur-panel, 18px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 18px))',
  ...overrides,
});

/* 메뉴 행 호버는 **CSS 한 규칙**이다 — `main.jsx` 의 `.iterm-menu-item`.
   예전엔 메뉴마다 JS 로 인라인 background 를 바꿨는데, 같은 것을 여섯 군데가 각자 배선하니
   한 곳을 고쳐도 나머지는 옛 모습으로 남았다(설정 서브메뉴에서 그게 드러났다). */

export const glassDividerStyle = (theme = {}, overrides = {}) => ({
  height: '1px',
  background: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line, 70%), transparent)`,
  ...overrides,
});

export const glassSectionStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} var(--glass-fill, 44%), transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line, 70%), transparent)`,
  ...overrides,
});
