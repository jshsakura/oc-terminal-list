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

// blur 양은 var(--glass-blur-*) 로 — main.jsx 가 모바일에서 더 작은 값으로 override 함.
export const glassMenuStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'surface0', ui.surface0)} 34%, transparent)`,
  border: `1px solid color-mix(in srgb, ${pick(theme, 'border', ui.border)} 24%, transparent)`,
  borderRadius: '8px',
  boxShadow: '0 6px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.02)',
  backdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-menu, 20px))',
  padding: '3px',
  ...overrides,
});

export const glassPanelStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} 72%, transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} 72%, transparent)`,
  boxShadow: '0 10px 34px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
  backdropFilter: 'blur(var(--glass-blur-panel, 18px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 18px))',
  ...overrides,
});

/* 메뉴 항목 호버.
 *
 * 유리 위에서는 반투명 하이라이트가 뒤에 비치는 것과 섞여 거의 안 보인다 — 78% surface1 은
 * 배경이 무엇이냐에 따라 있는 듯 없는 듯했다. 호버는 "지금 이 줄이 선택된다" 는 유일한
 * 신호라 애매하면 안 된다. 한 단 위 면(surface2)을 거의 불투명하게 깔고, 왼쪽에 액센트
 * 실마리를 더해 어느 줄인지 눈이 바로 잡게 한다. */
export const glassMenuItemHover = (theme = {}) =>
  `color-mix(in srgb, ${pick(theme, 'surface2', ui.surface2)} 92%, transparent)`;

export const glassDividerStyle = (theme = {}, overrides = {}) => ({
  height: '1px',
  background: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} 70%, transparent)`,
  ...overrides,
});

export const glassSectionStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'base', ui.base)} 44%, transparent)`,
  borderColor: `color-mix(in srgb, ${pick(theme, 'border', ui.border)} 70%, transparent)`,
  ...overrides,
});
