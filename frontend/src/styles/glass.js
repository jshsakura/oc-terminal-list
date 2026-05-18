import { tokens } from './tokens';

const { color } = tokens;

const ui = {
  base: `var(--ui-base, ${color.base})`,
  surface0: `var(--ui-surface0, ${color.surface0})`,
  surface1: `var(--ui-surface1, ${color.surface1})`,
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

export const glassMenuItemHover = (theme = {}) =>
  `color-mix(in srgb, ${pick(theme, 'surface1', ui.surface1)} 78%, transparent)`;

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
