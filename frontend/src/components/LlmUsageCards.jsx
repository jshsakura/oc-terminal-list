import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Server, RefreshCw, CornerUpRight, CalendarDays } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import { authHeaders } from '../utils/auth';
import { attachPaneTargets } from '../utils/llmSessionPane';
import { LLM_USAGE_CHANGED_EVENT } from '../utils/llmUsageBus';
import { formatMoney, describeMoney, resolveCurrency } from '../utils/money';
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

/* ─── 포맷터 — 셀이 좁아 항상 축약형. 통화는 설정(자동=언어 따름)에서 온다. */

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
  settings = {},
  onJumpPane,          // (tabId, paneId) => void
  days = DEFAULT_DAYS,
  // bare: 부모가 이미 그리드·소제목을 갖고 있다. 카드만 내놓는다.
  bare = false,
  // 대시보드 화면에서는 꺼져 있어도 자리를 남긴다 — 왜 비었는지 말해줘야 한다.
  alwaysShow = false,
  t,
}) => {
  const { data, err, busy, refresh } = useLlmUsage(days);

  /* 통화 — 한국어면 자동으로 원. 환율은 서버가 하루 한 번 받아 summary 에 실어준다.
     money 는 이 컨텍스트를 받아야 하므로 컴포넌트 안에서 만든다(전역 포맷터 금지). */
  const currency = resolveCurrency(settings.currency, settings.language);
  const fx = data?.fx || null;
  const money = (usd) => formatMoney(usd, { currency, fx });
  const moneyTitle = (usd) => describeMoney(usd, { currency, fx });

  // 설정에서 켜면 즉시 다시 읽는다. 홈은 마운트 때 한 번만 읽으므로(폴링 없음)
  // 이 신호가 없으면 새로고침 전까지 아무 변화가 없다.
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener(LLM_USAGE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LLM_USAGE_CHANGED_EVENT, onChanged);
  }, [refresh]);

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

  const totals = data?.totals || {};
  const isOff = !data || !data.enabled || !data.ok_count;

  // 홈의 연결 화면에서는 꺼져 있으면 **구획 자체가 없다**(소제목까지). 대시보드
  // 화면에서는 자리를 비워두지 않고 왜 비었는지 한 줄로 말한다.
  if (isOff && !alwaysShow) return null;
  if (isOff) {
    return (
      <CardShell icon={Coins} title={t?.('llmUsageSection') || 'LLM usage'}>
        <EmptyState message={data && !data.enabled
          ? (t?.('llmUsageOff') || 'Turn on LLM usage in settings to see it here.')
          : (t?.('noLlmUsage') || 'No usage collected yet.')} />
      </CardShell>
    );
  }

  const cards = (
    <>
      <OverviewCard
        totals={totals}
        days={data.days ?? days}
        agents={data.by_agent || []}
        err={err}
        busy={busy}
        onRefresh={refresh}
        money={money}
        moneyTitle={moneyTitle}
        t={t}
      />
      <DailyCostCard days={data.by_day || []} hosts={hostRows} money={money} t={t} />
      <HostCostCard rows={hostRows} err={err} money={money} t={t} />
      <RecentSessionsCard rows={sessionRows} onJumpPane={onJumpPane} money={money} t={t} />
    </>
  );

  if (bare) return cards;

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
      <div style={gridStyle}>{cards}</div>
    </DashboardSection>
  );
};

/* ─── 카드 1: 개요 — 비용이 히어로, 나머지는 보조 ────────────────────── */
const OverviewCard = ({ totals, days, agents, err, busy, onRefresh, money, moneyTitle, t }) => (
  <CardShell
    icon={Coins}
    title={t?.('llmCost') || 'Estimated cost'}
    action={onRefresh ? (
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        title={t?.('refresh') || 'Refresh'}
        style={{ ...refreshBtnStyle, opacity: busy ? 0.4 : 1 }}
      >
        <RefreshCw size={12} strokeWidth={2} />
      </button>
    ) : null}
  >
    {err ? <ErrorState message={err} /> : (
      <div style={overviewBodyStyle}>
        <div style={heroRowStyle}>
          <span style={heroValueStyle} title={moneyTitle?.(totals.cost)}>{money(totals.cost)}</span>
        </div>
        {/* 정액제면 실제 청구액이 아니라는 사실은 숨기지 않되, 각주 크기로 둔다.
            히어로 숫자 밑에서 두 줄을 차지하면 그게 본문처럼 읽힌다. 긴 설명은
            title 로 넘긴다. */}
        <div
          style={heroNoteStyle}
          title={t?.('llmCostNoteFull') || 'List-price estimate — not your bill on a flat-rate plan'}
        >
          {t?.('llmCostNote') || 'list price, not your bill'}
        </div>
        <div style={statRowStyle}>
          <Stat label={t?.('tokens') || 'Tokens'} value={formatTokens(totals.tokens)} />
          <Stat label={t?.('sessions') || 'Sessions'} value={Math.round(totals.sessions || 0)} />
          <Stat label={t?.('days') || 'Days'} value={`${days || totals.days || 0}d`} />
        </div>
        {agents.length > 0 && (
          <div style={agentChipsStyle}>
            {agents.slice(0, 4).map((a) => (
              <span
                key={a.name}
                style={agentChipStyle(agentAccent(a.name))}
                title={`${a.name} · ${money(a.cost)}`}
              >
                <span style={agentDotStyle(agentAccent(a.name))} />
                {a.name}
                <span style={agentChipCostStyle}>{money(a.cost)}</span>
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
const HostCostCard = ({ rows, err, money, t }) => {
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
                    {row.ok ? money(row.cost) : (t?.('unreachable') || 'n/a')}
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

/* ─── 카드 2: 일자별 비용 — 호스트 색으로 쌓는다 ─────────────────────
   막대 하나가 하루, 세그먼트 하나가 호스트다. 색은 호스트 카드·탭과 같은 팔레트라
   "저 파란 게 어느 기계" 를 다시 배울 필요가 없다 — 색은 **호스트를 따르지 그날의
   순위를 따르지 않는다.**

   색만으로 구분하게 두지 않는다: 아래 범례에 이름이 늘 붙고(색각 이상·흑백에서도
   읽힌다), 막대를 누르면 그날 수치가 뜬다. 세그먼트 사이 2px 틈은 인접한 두 색이
   비슷할 때 경계를 만들어 준다. */
const CHART_HEIGHT = 88;
const BAR_GAP = 2;
const SEGMENT_GAP = 2;
const MAX_LEGEND = 5;

const DailyCostCard = ({ days = [], hosts = [], money, t }) => {
  const [picked, setPicked] = useState(null);   // 탭/호버한 날
  const accentOf = useMemo(() => {
    const map = new Map(hosts.map((h) => [h.source_id, h.accent]));
    return (id) => map.get(id) || color.subtext;
  }, [hosts]);
  const nameOf = useMemo(() => {
    const map = new Map(hosts.map((h) => [h.source_id, h.name]));
    return (id) => map.get(id) || id;
  }, [hosts]);

  const max = days.reduce((m, d) => Math.max(m, Number(d.cost) || 0), 0);
  const shown = picked || days[days.length - 1] || null;

  return (
    <CardShell icon={CalendarDays} title={t?.('llmDaily') || 'Daily cost'} wide>
      {days.length === 0 ? (
        <EmptyState message={t?.('noLlmUsage') || 'No usage collected yet.'} />
      ) : (
        <div style={chartBodyStyle}>
          {/* 읽는 값 한 줄 — 고른 날(없으면 마지막 날). 막대마다 숫자를 박으면 못 읽는다. */}
          <div style={chartReadoutStyle}>
            <span style={chartReadoutDayStyle}>{shown ? shortDay(shown.day) : ''}</span>
            <span style={chartReadoutCostStyle}>{shown ? money(shown.cost) : ''}</span>
          </div>

          <div
            style={{ ...chartRowStyle, height: `${CHART_HEIGHT}px`, gap: `${BAR_GAP}px` }}
            onMouseLeave={() => setPicked(null)}
          >
            {days.map((d) => {
              const total = Number(d.cost) || 0;
              const isOn = shown && shown.day === d.day;
              const segments = Object.entries(d.hosts || {})
                .filter(([, v]) => (Number(v) || 0) > 0)
                .sort((a, b) => b[1] - a[1]);
              return (
                <button
                  key={d.day}
                  type="button"
                  onMouseEnter={() => setPicked(d)}
                  onClick={() => setPicked(d)}
                  title={`${d.day} · ${money(total)}`}
                  style={barButtonStyle}
                >
                  <span style={barTrackStyle}>
                    <span
                      style={{
                        ...barStackStyle,
                        height: max > 0 ? `${Math.max(2, (total / max) * 100)}%` : '2px',
                        opacity: !shown || isOn ? 1 : 0.55,
                      }}
                    >
                      {segments.length === 0 ? (
                        <span style={{ flex: 1, background: color.surface2 }} />
                      ) : segments.map(([id, v], i) => (
                        <span
                          key={id}
                          style={{
                            flexGrow: Number(v) || 0,
                            flexBasis: 0,
                            minHeight: '2px',
                            background: accentOf(id),
                            marginTop: i === 0 ? 0 : `${SEGMENT_GAP}px`,
                            borderRadius: i === 0 ? '3px 3px 0 0' : 0,
                          }}
                        />
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 범례 — 2개 이상이면 언제나. 이름이 없으면 색은 그냥 색이다. */}
          {hosts.length > 1 && (
            <div style={legendStyle}>
              {hosts.filter((h) => h.ok && h.cost > 0).slice(0, MAX_LEGEND).map((h) => (
                <span key={h.source_id} style={legendItemStyle}>
                  <span style={{ ...legendDotStyle, background: h.accent }} />
                  {h.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
};

/** 2026-08-05 → 8/5 — 축 라벨은 없앴고, 읽는 줄에만 짧게 쓴다. */
function shortDay(day) {
  const parts = String(day || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(day || '');
}

/* ─── 카드 3: 최근 세션 — 살아있는 pane 이 있으면 거기로 데려간다 ───── */
const RecentSessionsCard = ({ rows, onJumpPane, money, t }) => (
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
                  <span style={sessionCostStyle}>{money(s.cost)}</span>
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
const heroNoteStyle = {
  fontSize: '9.5px',
  color: color.muted,
  lineHeight: 1.3,
  marginTop: '-2px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
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
/* 에이전트 고유색 — 이름이 곧 정체성이라 색도 이름을 따른다(순위가 아니라).
   dotPalette 에서 서로 먼 색을 골랐고, 색만으로 구분하게 두지 않는다: 점 옆에 항상
   이름이 붙는다(색각 이상·흑백 인쇄에서도 읽힌다). */
const AGENT_ACCENT = {
  claude: color.dotPalette[7] || '#fb923c',   // orange
  codex: color.dotPalette[0] || '#89b4fa',    // blue
  opencode: color.dotPalette[4] || '#4ade80', // green
  gemini: color.dotPalette[11] || '#d946ef',  // fuchsia
};
const agentAccent = (name) => AGENT_ACCENT[String(name).toLowerCase()] || color.subtext;

const agentChipsStyle = { display: 'flex', flexWrap: 'wrap', gap: '4px' };
const agentChipStyle = (accent) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  fontSize: fontSize['10'],
  fontWeight: fontWeight.medium,
  color: color.text,
  background: `color-mix(in srgb, ${accent} 10%, transparent)`,
  border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
  borderRadius: radius.sm,
  padding: '2px 7px',
  whiteSpace: 'nowrap',
});
const agentDotStyle = (accent) => ({
  width: '6px', height: '6px', borderRadius: '50%',
  background: accent, flexShrink: 0,
});
const agentChipCostStyle = { color: color.subtext, fontVariantNumeric: 'tabular-nums' };
const chartBodyStyle = { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 };
const chartReadoutStyle = {
  display: 'flex', alignItems: 'baseline', gap: '8px',
  fontFamily: font.sans, minHeight: '18px',
};
const chartReadoutDayStyle = { fontSize: fontSize['10'], color: color.subtext };
const chartReadoutCostStyle = {
  fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text,
  fontVariantNumeric: 'tabular-nums',
};
const chartRowStyle = { display: 'flex', alignItems: 'flex-end', width: '100%' };
const barButtonStyle = {
  flex: 1, minWidth: 0, height: '100%', padding: 0, margin: 0,
  background: 'transparent', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'flex-end',
};
const barTrackStyle = { display: 'flex', alignItems: 'flex-end', width: '100%', height: '100%' };
const barStackStyle = {
  display: 'flex', flexDirection: 'column-reverse', width: '100%',
  transition: 'opacity 120ms',
};
const legendStyle = { display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 'auto' };
const legendItemStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  fontSize: fontSize['10'], color: color.subtext, whiteSpace: 'nowrap',
};
const legendDotStyle = { width: '7px', height: '7px', borderRadius: '2px', flexShrink: 0 };
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
