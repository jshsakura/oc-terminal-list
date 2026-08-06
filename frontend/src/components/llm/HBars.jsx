import { tokens as designTokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { formatTokens } from './LlmDashboard';

const { color, font, fontSize, fontWeight, radius } = designTokens;

/**
 * Horizontal magnitude bars — llm-watcher's HBars.
 *
 * One series means one hue. `colorOf` exists only for dimensions where colour
 * carries identity (agent, host) and must stay stable as rows come and go —
 * never assigned by rank.
 */
export const HBars = ({ title, icon: TitleIcon = null, rows = [], limit = 8, colorOf, money, t }) => {
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
            const accent = colorOf ? colorOf(row.name) : color.accent;
            const pct = Math.max(2, ((Number(row.cost) || 0) / max) * 100);
            return (
              <div
                key={row.name}
                style={rowStyle}
                /* 토큰이 없는 계열(터미널 사용 시간)도 이 막대를 쓴다 — 없는 값을
                   "0" 으로 적으면 그건 틀린 정보다. 있을 때만 붙인다. */
                title={[row.name, row.tokens != null && formatTokens(row.tokens), money(row.cost)]
                  .filter(Boolean).join(' · ')}
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
  ...dashboardCardStyle({ padding: '12px' }),
};
const titleStyle = {
  margin: 0, fontSize: fontSize['12'], fontWeight: fontWeight.semibold,
  color: color.text, fontFamily: font.sans, letterSpacing: '0.02em',
  display: 'flex', alignItems: 'center', gap: '6px',
};
const listStyle = { display: 'flex', flexDirection: 'column', gap: '7px' };
const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 2fr auto',
  alignItems: 'center', gap: '8px',
};
const nameStyle = { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 };
/* 토큰에 없는 치수(10, 10.5)를 쓰면 `fontSize['10']` 은 undefined 가 되어 상속 크기로
   렌더된다 — 의도한 크기가 아니라 아무 크기다. 스케일 안의 값만 쓴다. */
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
};
const stateStyle = { padding: '10px', textAlign: 'center', color: color.subtext, fontSize: fontSize['12'] };
