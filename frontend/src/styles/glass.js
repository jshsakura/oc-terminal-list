import { tokens } from './tokens';

const { color } = tokens;

const ui = {
  base: `var(--ui-base, ${color.base})`,
  surface0: `var(--ui-surface0, ${color.surface0})`,
  surface1: `var(--ui-surface1, ${color.surface1})`,
  border: `var(--ui-border, ${color.border})`,
  borderStrong: `var(--ui-border-strong, ${color.borderStrong})`,
};

const pick = (theme, key, fallback) => theme?.[key] || fallback;

export const glassMenuStyle = (theme = {}, overrides = {}) => ({
  background: `color-mix(in srgb, ${pick(theme, 'surface0', ui.surface0)} 70%, transparent)`,
  border: `1px solid color-mix(in srgb, ${pick(theme, 'borderStrong', pick(theme, 'border', ui.borderStrong))} 62%, transparent)`,
  borderRadius: '8px',
  boxShadow: '0 8px 26px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  padding: '3px',
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
