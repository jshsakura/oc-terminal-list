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
 * 채움/테두리의 **비율도** var 이다(--glass-fill-* / --glass-line-*). 리터럴 퍼센트를
 * 박으면 이북 모드가 유리를 불투명으로 못 바꾼다 — 이 값들이 인라인 style 객체로 나가서
 * CSS 특이도로는 닿지 않기 때문이다. 기본값은 main.jsx 의 :root 에 있다. */
export const glassMenuStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'surface0', ui.surface0)} var(--glass-fill-menu, 34%), transparent)`,
  border: `1px solid color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line-menu, 24%), transparent)`,
  borderRadius: '8px',
  boxShadow: '0 6px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.02)',
  backdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  padding: '3px',
  ...overrides,
});

export const glassPanelStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} var(--glass-fill-panel, 72%), transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line-panel, 72%), transparent)`,
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
  background: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line-section, 70%), transparent)`,
  ...overrides,
});

export const glassSectionStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} var(--glass-fill-section, 44%), transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} var(--glass-line-section, 70%), transparent)`,
  ...overrides,
});
