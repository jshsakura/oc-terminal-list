import { tokens } from '../../styles/tokens';

const { color, fontSize, fontWeight, radius, space } = tokens;

export const toolsStyles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  pickerRow: { display: 'flex', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  select: {
    flex: 1, minWidth: '160px', height: '30px',
    padding: `0 ${space['2']}`,
    background: color.surface0, color: color.text,
    border: `1px solid ${color.border}`, borderRadius: radius.sm,
    fontSize: fontSize['12'],
  },
  list: { display: 'flex', flexDirection: 'column', gap: space['2'] },
  row: {
    display: 'flex', flexDirection: 'column', gap: space['1.5'],
    padding: space['2'],
    border: `1px solid ${color.border}`, borderRadius: radius.md,
  },
  rowHead: { display: 'flex', alignItems: 'center', gap: space['2'] },
  name: { fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text },
  desc: { fontSize: fontSize['12'], color: color.subtext, lineHeight: 1.5 },
  cmd: {
    padding: '4px 6px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 60%, transparent)`,
    borderRadius: '4px', color: color.subtext,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: fontSize['11'], wordBreak: 'break-all', userSelect: 'all',
  },
  actions: { display: 'flex', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' },
  spacer: { flex: 1 },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    fontSize: fontSize['11'], color: color.muted, whiteSpace: 'nowrap',
  },
  muted: { fontSize: fontSize['11'], color: color.muted, lineHeight: 1.5 },
  warn: { fontSize: fontSize['12'], color: 'var(--ui-warning, #f9e2af)', lineHeight: 1.5 },
  error: { fontSize: fontSize['12'], color: color.danger, lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: space['2'] },
  label: { fontSize: fontSize['11'], color: color.muted },
  input: {
    width: '100%', height: '30px', padding: `0 ${space['2']}`,
    background: color.surface0, color: color.text,
    border: `1px solid ${color.border}`, borderRadius: radius.sm,
    fontSize: fontSize['12'], boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', minHeight: '54px', padding: space['2'],
    background: color.surface0, color: color.text,
    border: `1px solid ${color.border}`, borderRadius: radius.sm,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: fontSize['12'], boxSizing: 'border-box', resize: 'vertical',
  },
  link: { color: 'var(--ui-accent)', fontSize: fontSize['11'], textDecoration: 'none' },
};

export default toolsStyles;
