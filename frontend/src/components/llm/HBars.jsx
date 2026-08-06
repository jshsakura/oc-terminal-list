import { tokens as designTokens } from '../../styles/tokens';
import { formatTokens } from './LlmDashboard';

const { color, font, fontSize, fontWeight, radius } = designTokens;

/**
 * Horizontal magnitude bars — llm-watcher's HBars.
 *
 * One series means one hue. `colorOf` exists only for dimensions where colour
 * carries identity (agent, host) and must stay stable as rows come and go —
 * never assigned by rank.
 */
export const HBars = ({ title, rows = [], limit = 8, colorOf, money, t }) => {
  const top = rows.slice(0, limit);
  const max = Math.max(...top.map((r) => Number(r.cost) || 0), 1e-9);
  return (
    <section style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      {top.length === 0 ? (
        <div style={stateStyle}>{t?.('noLlmUsage') || 'No data.'}</div>
      ) : (
        <div style={listStyle}>
          {top.map((row) => {
            const accent = colorOf ? colorOf(row.name) : color.accent;
            const pct = Math.max(2, ((Number(row.cost) || 0) / max) * 100);
            return (
              <div
                key={row.name}
                style={rowStyle}
                title={`${row.name} · ${formatTokens(row.tokens)} · ${money(row.cost)}`}
              >
                <div style={nameStyle}>
                  {colorOf && <span style={{ ...dotStyle, background: accent }} />}
                  <span style={nameTextStyle}>{row.name}</span>
                </div>
                <div style={trackStyle}>
                  <div style={{ ...fillStyle, width: `${pct}%`, background: accent }} />
                </div>
                <div style={valueStyle}>{row.ok === false ? (t?.('unreachable') || 'n/a') : money(row.cost)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: '8px',
  padding: '12px', background: color.surface0,
  border: `1px solid ${color.border}`, borderRadius: radius.md,
};
const titleStyle = {
  margin: 0, fontSize: fontSize['11'], fontWeight: fontWeight.semibold,
  color: color.subtext, fontFamily: font.sans, letterSpacing: '0.02em',
};
const listStyle = { display: 'flex', flexDirection: 'column', gap: '7px' };
const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 2fr auto',
  alignItems: 'center', gap: '8px',
};
const nameStyle = { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 };
const nameTextStyle = {
  fontSize: fontSize['10.5'] || '10.5px', color: color.text, fontFamily: font.sans,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const dotStyle = { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 };
const trackStyle = {
  height: '6px', background: color.crust, borderRadius: '3px', overflow: 'hidden',
};
const fillStyle = { height: '100%', borderRadius: '3px' };
const valueStyle = {
  fontSize: fontSize['10'], color: color.subtext,
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};
const stateStyle = { padding: '10px', textAlign: 'center', color: color.subtext, fontSize: fontSize['11'] };
