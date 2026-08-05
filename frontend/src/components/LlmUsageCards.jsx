import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Server, RefreshCw, CornerUpRight } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import { authHeaders } from '../utils/auth';
import { attachPaneTargets } from '../utils/llmSessionPane';
import {
  CardShell, EmptyState, ErrorState, gridStyle,
  rankListStyle, rankRowStyle, rankHeaderStyle, rankIconStyle,
  rankNameStyle, rankValueStyle, rankBarTrackStyle, rankBarFillStyle,
} from './DashboardCards';
import DashboardSection from './DashboardSection';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * LLM 토큰·비용 카드 — 각 호스트의 llm-watcher 를 백엔드가 합쳐준 것을 그린다.
 *
 * **watcher 가 한 대도 없으면 아무것도 렌더하지 않는다.** 에이전트 기능은 옵트인이고,
 * 안 쓰는 사람 화면에 빈 카드가 남으면 그건 그냥 노이즈다.
 *
 * 폴링 없음 — 마운트 1회. 백엔드가 하루 캐시하므로 새로고침을 눌러야 실제로
 * 호스트들을 다시 찌른다.
 */

// App 홈과 빈 pane 홈이 동시에 마운트될 수 있어 모듈 레벨에서 요청을 합친다.
const _cache = new Map();   // days → { data, ts }
const _inFlight = new Map(); // days → Promise
const CACHE_TTL_MS = 60 * 1000;

const TOP_HOSTS = 5;
const TOP_SESSIONS = 5;
const DEFAULT_DAYS = 30;

/* ─── 포맷터 — 셀이 좁아 항상 축약형. */
function formatCost(usd) {
  const v = Math.max(0, Number(usd) || 0);
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

function formatTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

function useLlmUsage(days) {
  const [data, setData] = useState(() => _cache.get(days)?.data || null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback((force = false) => {
    const cached = _cache.get(days);
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      return;
    }
    if (!force && _inFlight.has(days)) {
      _inFlight.get(days).then((d) => { if (alive.current) setData(d); }).catch(() => {});
      return;
    }
    setBusy(true);
    setErr(null);
    const url = force
      ? `/api/llm-usage/refresh?days=${days}`
      : `/api/llm-usage/summary?days=${days}`;
    const p = fetch(url, { method: force ? 'POST' : 'GET', headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { _cache.set(days, { data: d, ts: Date.now() }); return d; })
      .finally(() => { _inFlight.delete(days); });
    if (!force) _inFlight.set(days, p);
    p.then((d) => {
      if (!alive.current) return;
      setData(d); setBusy(false);
    }).catch((e) => {
      if (!alive.current) return;
      setErr(e.message || 'fetch failed'); setBusy(false);
    });
  }, [days]);

  useEffect(() => { load(false); }, [load]);
  return { data, err, busy, refresh: () => load(true) };
}

const LlmUsageCards = ({
  hosts = [],
  tabs = [],
  onJumpPane,          // (tabId, paneId) => void
  days = DEFAULT_DAYS,
  t,
}) => {
  const { data, err, busy, refresh } = useLlmUsage(days);

  const hostMetaById = useMemo(() => {
    const map = new Map();
    hosts.forEach((h) => map.set(h.id, h));
    return map;
  }, [hosts]);

  const hostRows = useMemo(() => {
    if (!data?.by_host) return [];
    return [...data.by_host]
      .sort((a, b) => (b.cost || 0) - (a.cost || 0))
      .map((row) => {
        const meta = hostMetaById.get(row.source_id);
        const accent = meta
          ? color.dotPalette[(meta.color_index ?? 0) % color.dotPalette.length]
          : color.accent;
        return { ...row, accent, iconValue: meta?.icon || '' };
      });
  }, [data, hostMetaById]);

  const sessionRows = useMemo(
    () => attachPaneTargets(data?.sessions || [], tabs).slice(0, TOP_SESSIONS),
    [data, tabs],
  );

  // 연동을 안 켰거나 watcher 가 한 대도 없으면 **이 구획은 존재하지 않는다** —
  // 소제목까지 통째로. 로딩 중에도 안 그려서 "떴다가 사라지는" 깜빡임을 만들지 않는다.
  if (!data || !data.enabled || !data.ok_count) return null;

  const totals = data.totals || {};

  return (
    <DashboardSection
      icon={Coins}
      title={t?.('llmUsageSection') || 'LLM usage'}
      action={(
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          title={t?.('refresh') || 'Refresh'}
          style={{ ...refreshBtnStyle, opacity: busy ? 0.4 : 1 }}
        >
          <RefreshCw size={12} strokeWidth={2} />
        </button>
      )}
    >
      <div style={gridStyle}>
        <OverviewCard
          totals={totals}
          days={data.days ?? days}
          agents={data.by_agent || []}
          err={err}
          t={t}
        />
        <HostCostCard rows={hostRows} err={err} t={t} />
        <RecentSessionsCard rows={sessionRows} onJumpPane={onJumpPane} t={t} />
      </div>
    </DashboardSection>
  );
};

/* ─── 카드 1: 개요 — 비용이 히어로, 나머지는 보조 ────────────────────── */
const OverviewCard = ({ totals, days, agents, err, t }) => (
  <CardShell icon={Coins} title={t?.('llmCost') || 'Estimated cost'}>
    {err ? <ErrorState message={err} /> : (
      <div style={overviewBodyStyle}>
        <div style={heroRowStyle}>
          <span style={heroValueStyle}>{formatCost(totals.cost)}</span>
        </div>
        {/* 정액제면 실제 청구액이 아니다 — 비교용 숫자라는 걸 숨기지 않는다. */}
        <div style={heroNoteStyle}>
          {t?.('llmCostNote') || 'List-price estimate — not your bill on a flat-rate plan'}
        </div>
        <div style={statRowStyle}>
          <Stat label={t?.('tokens') || 'Tokens'} value={formatTokens(totals.tokens)} />
          <Stat label={t?.('sessions') || 'Sessions'} value={Math.round(totals.sessions || 0)} />
          <Stat label={t?.('days') || 'Days'} value={`${days || totals.days || 0}d`} />
        </div>
        {agents.length > 0 && (
          <div style={agentChipsStyle}>
            {agents.slice(0, 4).map((a) => (
              <span key={a.name} style={agentChipStyle} title={`${a.name} · ${formatCost(a.cost)}`}>
                {a.name}
              </span>
            ))}
          </div>
        )}
      </div>
    )}
  </CardShell>
);

const Stat = ({ label, value }) => (
  <div style={statCellStyle}>
    <span style={statValueStyle}>{value}</span>
    <span style={statLabelStyle}>{label}</span>
  </div>
);

/* ─── 카드 2: 호스트별 비용 — 못 읽은 호스트도 사유를 달고 남는다 ───── */
const HostCostCard = ({ rows, err, t }) => {
  const top = rows.slice(0, TOP_HOSTS);
  const max = top.length ? Math.max(...top.map((r) => r.cost || 0), 0.01) : 1;
  return (
    <CardShell icon={Server} title={t?.('llmByHost') || 'LLM by host'}>
      {err ? <ErrorState message={err} /> : top.length === 0 ? (
        <EmptyState message={t?.('noLlmUsage') || 'No usage collected yet.'} />
      ) : (
        <ul style={rankListStyle}>
          {top.map((row) => {
            const pct = Math.max(3, Math.round(((row.cost || 0) / max) * 100));
            return (
              <li key={row.source_id} style={rankRowStyle}>
                <div style={rankHeaderStyle}>
                  <span style={{ ...rankIconStyle, color: row.accent }}>
                    <HostIcon value={row.iconValue} fallback={Server} size={12} strokeWidth={1.8} />
                  </span>
                  <span style={rankNameStyle} title={row.error || row.name}>{row.name}</span>
                  <span style={{ ...rankValueStyle, color: row.ok ? color.subtext : color.danger }}>
                    {row.ok ? formatCost(row.cost) : (t?.('unreachable') || 'n/a')}
                  </span>
                </div>
                <div style={rankBarTrackStyle}>
                  <div style={{
                    ...rankBarFillStyle,
                    width: row.ok ? `${pct}%` : '0%',
                    background: row.accent,
                  }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
};

/* ─── 카드 3: 최근 세션 — 살아있는 pane 이 있으면 거기로 데려간다 ───── */
const RecentSessionsCard = ({ rows, onJumpPane, t }) => (
  <CardShell icon={CornerUpRight} title={t?.('llmRecentSessions') || 'Recent agent sessions'}>
    {rows.length === 0 ? (
      <EmptyState message={t?.('noLlmSessions') || 'No sessions in this window.'} />
    ) : (
      <ul style={sessionListStyle}>
        {rows.map((s) => {
          const jumpable = !!(s.pane && onJumpPane);
          return (
            <li key={`${s.host_id}:${s.session_id}`} style={sessionRowStyle}>
              <button
                type="button"
                disabled={!jumpable}
                onClick={jumpable ? () => onJumpPane(s.pane.tabId, s.pane.paneId) : undefined}
                title={jumpable
                  ? `${t?.('jumpToPane') || 'Jump to pane'} — ${s.cwd || ''}`
                  : (s.title || s.cwd || '')}
                style={{ ...sessionBtnStyle, cursor: jumpable ? 'pointer' : 'default' }}
              >
                <span style={sessionTitleStyle}>
                  {s.title || s.project || s.session_id}
                </span>
                <span style={sessionMetaStyle}>
                  <span style={sessionAgentStyle}>{s.agent}</span>
                  <span>{s.host_name}</span>
                  <span style={sessionCostStyle}>{formatCost(s.cost)}</span>
                  {jumpable && <CornerUpRight size={11} strokeWidth={2} color={color.accent} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </CardShell>
);

/* ─── 스타일 — DashboardCards 의 톤 그대로: 평평한 면 + 헤어라인. */
const overviewBodyStyle = { display: 'flex', flexDirection: 'column', gap: space['3'], flex: 1 };
const heroRowStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space['2'] };
const heroValueStyle = {
  fontSize: '28px', fontWeight: fontWeight.semibold, color: color.text,
  fontFamily: font.sans, letterSpacing: '-0.02em', lineHeight: 1.1,
};
const heroNoteStyle = { fontSize: fontSize['10'], color: color.subtext, opacity: 0.75, lineHeight: 1.4 };
const refreshBtnStyle = {
  background: 'transparent', border: 'none', color: color.subtext,
  cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center',
};
const statRowStyle = { display: 'flex', gap: space['4'], marginTop: 'auto' };
const statCellStyle = { display: 'flex', flexDirection: 'column', gap: '2px' };
const statValueStyle = { fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text };
const statLabelStyle = {
  fontSize: fontSize['10'], color: color.subtext,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const agentChipsStyle = { display: 'flex', flexWrap: 'wrap', gap: '4px' };
const agentChipStyle = {
  fontSize: fontSize['10'], color: color.subtext,
  border: `1px solid ${color.border}`, borderRadius: radius.sm,
  padding: '1px 6px', whiteSpace: 'nowrap',
};
const sessionListStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' };
const sessionRowStyle = { display: 'block' };
const sessionBtnStyle = {
  width: '100%', textAlign: 'left', background: 'transparent',
  border: 'none', padding: '2px 0', display: 'flex', flexDirection: 'column',
  gap: '2px', fontFamily: font.sans,
};
const sessionTitleStyle = {
  fontSize: fontSize['12'], color: color.text,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
};
const sessionMetaStyle = {
  display: 'flex', alignItems: 'center', gap: '6px',
  fontSize: fontSize['10'], color: color.subtext,
};
const sessionAgentStyle = { color: color.accent };
const sessionCostStyle = { marginLeft: 'auto' };

export default LlmUsageCards;
