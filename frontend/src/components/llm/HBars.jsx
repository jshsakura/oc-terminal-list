import { tokens as designTokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { formatTokens } from './LlmDashboard';

const { color, font, fontSize, fontWeight, radius } = designTokens;

/** 이름 → 팔레트 색. **순위가 아니라 이름으로** 정한다 — 순위로 칠하면 어제 3등이던 모델이
    오늘 1등이 되며 색이 바뀌어, 색이 아무것도 뜻하지 않게 된다. */
const hueFor = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return color.dotPalette[h % color.dotPalette.length];
};

/**
 * Horizontal magnitude bars — llm-watcher's HBars.
 *
 * `colorOf` 는 색이 곧 정체성인 축(에이전트·호스트)에서만 쓴다. `varied` 는 그런 정체성이
 * 없지만 줄이 여러 개라 단색이면 덩어리로 보이는 축(모델·프로젝트)을 위한 것 — 이름 기반
 * 해시라 순서가 바뀌어도 같은 모델은 같은 색이다.
 *
 * **행은 하나의 그리드를 공유한다.** 행마다 grid 를 따로 두면 `auto` 열이 그 행의 값 길이에
 * 맞춰지고 `1fr` 이 남은 폭을 나눠, 막대 시작점이 줄마다 어긋난다(실제로 그랬다).
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
                /* 토큰이 없는 계열(터미널 사용 시간)도 이 막대를 쓴다 — 없는 값을
                   "0" 으로 적으면 그건 틀린 정보다. 있을 때만 붙인다. */
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
/* 이름 34% · 막대 나머지 · 값 84px 고정. 값 열을 `auto` 로 두면 행마다 폭이 달라져 막대
   시작점과 숫자 오른쪽이 둘 다 어긋난다 — 열 폭은 **모든 행이 같아야** 표로 읽힌다. */
const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 34%) 1fr 84px',
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
  textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis',
};
const stateStyle = { padding: '10px', textAlign: 'center', color: color.subtext, fontSize: fontSize['12'] };
