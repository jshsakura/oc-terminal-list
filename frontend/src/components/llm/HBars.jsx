import { tokens as designTokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { formatTokens } from './LlmDashboard';

const { color, font, fontSize, fontWeight, radius } = designTokens;

/** Name → palette colour, decided **by name, never by rank**. Colour by rank and the model
    that was third yesterday changes colour when it becomes first, so colour means nothing. */
const hueFor = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return color.dotPalette[h % color.dotPalette.length];
};

/**
 * Horizontal magnitude bars — llm-watcher's HBars.
 *
 * `colorOf` is for axes where colour *is* identity (agent, host). `varied` is for axes
 * without that identity but with enough rows that one hue reads as a single blob (model,
 * project) — a name hash, so the same model keeps its colour when the order changes.
 *
 * **All rows share one grid.** Give each row its own grid and the `auto` column sizes to
 * that row's value while `1fr` splits what is left, so the bars start at different x
 * positions (which is exactly what happened).
 */
export const HBars = ({ title, icon: TitleIcon = null, rows = [], limit = 8, colorOf, varied = false, money, t }) => {
  const top = rows.slice(0, limit);
  const max = Math.max(...top.map((r) => Number(r.cost) || 0), 1e-9);
  return (
    <section style={cardStyle}>
      <h3 style={titleStyle}>
        {TitleIcon && <TitleIcon size={12} strokeWidth={2} style={{ color: color.subtext }} />}
        {title}
      </h3>
      {top.length === 0 ? (
        <div style={stateStyle}>{t?.('noLlmUsage') || 'No data.'}</div>
      ) : (
        <div style={listStyle}>
          {top.map((row) => {
            const accent = colorOf ? colorOf(row.name) : (varied ? hueFor(row.name) : color.accent);
            const showDot = !!colorOf || varied;
            const pct = Math.max(2, ((Number(row.cost) || 0) / max) * 100);
            return (
              <div
                key={row.name}
                style={rowStyle}
                /* Series without tokens (terminal time) use these bars too — writing "0" for
                   a value that does not exist is simply wrong. Only include it when present. */
                title={[row.name, row.tokens != null && formatTokens(row.tokens), money(row.cost)]
                  .filter(Boolean).join(' · ')}
              >
                <div style={nameStyle}>
                  {showDot && <span style={{ ...dotStyle, background: accent }} />}
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
  ...dashboardCardStyle({ padding: '12px' }),
};
const titleStyle = {
  margin: 0, fontSize: fontSize['12'], fontWeight: fontWeight.semibold,
  color: color.text, fontFamily: font.sans, letterSpacing: '0.02em',
  display: 'flex', alignItems: 'center', gap: '6px',
};
const listStyle = { display: 'flex', flexDirection: 'column', gap: '7px' };
/* Name 34% · bar the rest · value fixed at 84px. Left as `auto`, the value column differs
   per row and both the bar start and the right edge of the numbers drift — column widths
   have to be **identical across rows** for this to read as a table. */
const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 34%) 1fr 84px',
  alignItems: 'center', gap: '8px',
};
const nameStyle = { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 };
/* Sizes outside the token scale (10, 10.5) make `fontSize['10']` undefined, which renders
   at the inherited size — not the size you meant, just some size. Use scale values only. */
const nameTextStyle = {
  fontSize: fontSize['11'], color: color.text, fontFamily: font.sans,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const dotStyle = { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 };
const trackStyle = {
  height: '6px', background: color.crust, borderRadius: '3px', overflow: 'hidden',
};
const fillStyle = { height: '100%', borderRadius: '3px' };
const valueStyle = {
  fontSize: fontSize['11'], color: color.text, fontWeight: fontWeight.medium,
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis',
};
const stateStyle = { padding: '10px', textAlign: 'center', color: color.subtext, fontSize: fontSize['12'] };
