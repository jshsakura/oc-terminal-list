import {
  Wallet, Hash, MessagesSquare, DatabaseZap,
  Tag, Scale, Crown, PieChart, Divide,
} from 'lucide-react';
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

/** One row of tiles — kept in one place so every number on the dashboard shares a shape.
    If terminal usage and LLM cost look like different cards, they do not read as one screen. */
export const TileRow = ({ tiles }) => (
  <div style={tilesStyle}>
    {tiles.map((tile) => {
      const Mark = tile.icon;
      return (
        <div key={tile.key} style={tileStyle}>
          {/* Watermark — what the number is about, at a glance. Bled past the corner and laid
              down to 7% so it is **felt, not read**. Drawn sharply it competes with the value. */}
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
  /* 아이콘은 **하나도 겹치지 않아야 한다.** 위 타일(Wallet/Hash/MessagesSquare/DatabaseZap)과
     아래 막대(Bot/Server/Cpu/FolderGit2)에서 이미 쓰는 글리프를 재사용하면, 같은 그림이 서로
     다른 숫자를 가리켜 오히려 읽기를 방해한다. 여기 다섯은 그 목록 밖에서 고른다.
     타일의 워터마크와 달리 이 줄은 카드가 작아 배경에 깔 자리가 없다 — 라벨 앞에 작게 세운다. */
  const stats = [
    [Tag, t?.('llmPerMTokens') || 'Per 1M tokens',
      money(tokenTotal > 0 ? (Number(totals.cost) || 0) / (tokenTotal / 1e6) : 0)],
    [Scale, t?.('llmMedianSession') || 'Median session', money(median)],
    [Crown, t?.('llmPeakSession') || 'Peak session', money(peak)],
    [PieChart, t?.('llmOutputShare') || 'Output share',
      `${tokenTotal > 0 ? ((Number(totals.output) || 0) / tokenTotal * 100).toFixed(1) : '0.0'}%`],
    [Divide, t?.('llmTokensPerSession') || 'Tokens / session',
      formatTokens(Number(totals.sessions) > 0 ? tokenTotal / Number(totals.sessions) : 0)],
  ];
  return (
    <div style={keyStatsStyle}>
      {stats.map(([Mark, label, value]) => (
        <div key={label} style={keyStatStyle}>
          <div style={keyStatLabelStyle}>
            <Mark aria-hidden="true" size={11} strokeWidth={1.8} style={keyStatIconStyle} />
            <span style={keyStatLabelTextStyle}>{label}</span>
          </div>
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
  // Let the watermark run past the corner without leaking outside the card.
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
/* The secondary line should be quiet but still legible — `faint` does not even reach 2:1
   contrast on surface0. "Quiet" and "invisible" are not the same thing. */
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
/* Labels stay quieter than values — a long label at the value's size gets read before the
   number it describes. Micro label (10px). */
const keyStatLabelStyle = {
  fontSize: fontSize['10'], color: color.subtext,
  display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0,
};
/* 글리프는 라벨보다 한 단계 더 물러난다 — 라벨과 같은 세기면 다섯 줄이 아이콘 행처럼 보이고
   정작 숫자가 밀린다. 좁은 카드에서 라벨이 줄어들 때 아이콘까지 찌그러지지 않게 고정 폭. */
const keyStatIconStyle = { flexShrink: 0, opacity: 0.65 };
const keyStatLabelTextStyle = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
};
const keyStatValueStyle = {
  fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text,
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};
