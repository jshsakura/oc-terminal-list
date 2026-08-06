import { Wallet, Hash, MessagesSquare, DatabaseZap } from 'lucide-react';
import { tokens as designTokens } from '../../styles/tokens';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { formatTokens } from './LlmDashboard';

const { color, font, fontSize, fontWeight, radius, space } = designTokens;

/**
 * The four headline tiles and the derived key-stats row, from llm-watcher.
 *
 * Each tile carries a one-line note under the value: the headline answers "how
 * much", the note answers "compared to what" (per day, per session, share). A
 * number with nothing to compare it to is trivia.
 *
 * The cost tile shows 원 with the dollar figure beside it, not instead of it —
 * the conversion is an estimate on top of an estimate, so the source number stays
 * visible.
 */
export const LlmTiles = ({ totals, money, moneyTitle, t }) => {
  const cost = Number(totals.cost) || 0;
  const sessions = Number(totals.sessions) || 0;
  const days = Number(totals.days) || 0;
  const tokenTotal = Number(totals.tokens) || 0;
  const cacheShare = tokenTotal > 0
    ? ((Number(totals.cache_read) || 0) + (Number(totals.cache_creation) || 0)) / tokenTotal * 100
    : 0;

  const tiles = [
    {
      icon: Wallet,
      key: t?.('llmCost') || 'Estimated cost',
      value: money(cost),
      title: moneyTitle?.(cost),
      note: `${money(days > 0 ? cost / days : 0)}/${t?.('unitDay') || 'd'}`
        + ` · ${money(sessions > 0 ? cost / sessions : 0)}/${t?.('sessionUnit') || 'session'}`,
    },
    {
      icon: Hash,
      key: t?.('llmTotalTokens') || 'Total tokens',
      value: formatTokens(tokenTotal),
      note: `${formatTokens(totals.output)} ${t?.('tokensOutput') || 'output'}`
        + ` · ${formatTokens(totals.input)} ${t?.('tokensInput') || 'input'}`,
    },
    {
      icon: MessagesSquare,
      key: t?.('sessions') || 'Sessions',
      value: Math.round(sessions).toLocaleString(),
      note: `${Math.round(Number(totals.agents) || 0)} ${t?.('llmAgents') || 'agents'}`
        + ` · ${Math.round(days)} ${t?.('llmActiveDays') || 'active days'}`,
    },
    {
      icon: DatabaseZap,
      key: t?.('llmCacheShare') || 'Cache share',
      value: `${cacheShare.toFixed(0)}%`,
      note: `${formatTokens(totals.cache_read)} ${t?.('llmRead') || 'read'}`
        + ` · ${formatTokens(totals.cache_creation)} ${t?.('llmWritten') || 'written'}`,
    },
  ];

  return <TileRow tiles={tiles} />;
};

/** 타일 한 줄 — 대시보드의 모든 숫자가 같은 모양을 쓰도록 여기 하나만 둔다.
    터미널 사용량과 LLM 비용이 서로 다른 카드처럼 생기면 한 화면으로 안 읽힌다. */
export const TileRow = ({ tiles }) => (
  <div style={tilesStyle}>
    {tiles.map((tile) => {
      const Mark = tile.icon;
      return (
        <div key={tile.key} style={tileStyle}>
          {/* 워터마크 — 무엇에 대한 숫자인지 한 눈에. 모서리 밖으로 흘려보내고 7% 로 눕혀
              **읽는 것이 아니라 느끼는** 크기로 둔다. 또렷하게 그리면 값과 경쟁한다. */}
          {Mark && (
            <span aria-hidden="true" style={tileMarkStyle}>
              <Mark size={64} strokeWidth={1.4} />
            </span>
          )}
          <div style={tileKeyStyle}>{tile.key}</div>
          <div style={tileValueStyle} title={tile.title}>{tile.value}</div>
          {tile.note && <div style={tileNoteStyle}>{tile.note}</div>}
        </div>
      );
    })}
  </div>
);

/** Derived efficiency numbers — all computable from what we already fetched. */
export const KeyStats = ({ totals, sessions, money, t }) => {
  const tokenTotal = Number(totals.tokens) || 0;
  const costs = sessions.map((s) => Number(s.cost) || 0).sort((a, b) => a - b);
  const median = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
  const peak = costs.length ? costs[costs.length - 1] : 0;
  const stats = [
    [t?.('llmPerMTokens') || 'Per 1M tokens', money(tokenTotal > 0 ? (Number(totals.cost) || 0) / (tokenTotal / 1e6) : 0)],
    [t?.('llmMedianSession') || 'Median session', money(median)],
    [t?.('llmPeakSession') || 'Peak session', money(peak)],
    [t?.('llmOutputShare') || 'Output share',
      `${tokenTotal > 0 ? ((Number(totals.output) || 0) / tokenTotal * 100).toFixed(1) : '0.0'}%`],
    [t?.('llmTokensPerSession') || 'Tokens / session',
      formatTokens(Number(totals.sessions) > 0 ? tokenTotal / Number(totals.sessions) : 0)],
  ];
  return (
    <div style={keyStatsStyle}>
      {stats.map(([label, value]) => (
        <div key={label} style={keyStatStyle}>
          <div style={keyStatLabelStyle}>{label}</div>
          <div style={keyStatValueStyle}>{value}</div>
        </div>
      ))}
    </div>
  );
};

const tilesStyle = {
  display: 'grid', gap: space['3'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
};
const tileStyle = {
  display: 'flex', flexDirection: 'column', gap: '4px',
  // 워터마크가 모서리 밖으로 나가되 카드 밖으로는 새지 않게.
  position: 'relative', overflow: 'hidden',
  ...dashboardCardStyle(),
};
const tileMarkStyle = {
  position: 'absolute', right: '-14px', bottom: '-16px',
  color: color.text, opacity: 0.07, pointerEvents: 'none', display: 'flex',
};
const tileKeyStyle = { fontSize: fontSize['11'], color: color.subtext, fontFamily: font.sans };
const tileValueStyle = {
  fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: fontWeight.semibold, color: color.text,
  fontFamily: font.sans, letterSpacing: '-0.02em', lineHeight: 1.15,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  fontVariantNumeric: 'tabular-nums',
};
/* 보조 줄은 조용해야 하지만 읽혀야 한다 — faint 는 surface0 위에서 대비가 2:1 도 안 된다.
   "조용하다" 와 "안 보인다" 는 다르다. */
const tileNoteStyle = {
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const keyStatsStyle = {
  display: 'grid', gap: '8px',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))',
};
const keyStatStyle = {
  display: 'flex', flexDirection: 'column', gap: '2px',
  ...dashboardCardStyle({ padding: '8px 10px', corner: radius.sm }),
};
/* 라벨은 값보다 조용해야 한다 — "백만 토큰당" 같은 긴 한국어 라벨이 값만큼 크면
   숫자가 아니라 설명이 먼저 읽힌다. micro label(10px). */
const keyStatLabelStyle = { fontSize: fontSize['10'], color: color.subtext };
const keyStatValueStyle = {
  fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text,
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};
