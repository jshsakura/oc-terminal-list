import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TrendingUp, History, Bot, Server, Cpu, FolderGit2 } from 'lucide-react';
import { tokens as designTokens } from '../../styles/tokens';
import { authHeaders } from '../../utils/auth';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { segmentedTrackStyle, segmentedItemStyle, segmentedHoverBackground } from '../../styles/segmented';
import { attachPaneTargets } from '../../utils/llmSessionPane';
import { LLM_USAGE_CHANGED_EVENT, emitLlmUsageBusy } from '../../utils/llmUsageBus';
import { formatMoney, describeMoney, resolveCurrency, formatCount } from '../../utils/money';
import { CHART_W, CHART_H, PAD_L, PAD_R, PAD_T, TOKEN_SERIES, buildChart, fillDayGaps, shortDay } from './llmChartGeometry';
import { LlmTiles, KeyStats } from './LlmTiles.jsx';
import { HBars } from './HBars.jsx';
import { TileRowSkeleton, ChartCardSkeleton, BarsCardSkeleton } from './DashboardSkeleton.jsx';

const { color, font, fontSize, fontWeight, radius, space } = designTokens;

/**
 * LLM usage dashboard — the llm-watcher screen, brought into this app.
 *
 * The layout is the original's, because the original works: one filter row that
 * scopes everything under it, four headline tiles, a row of derived key stats, a
 * daily chart with cost/tokens and chart/table switches, then the breakdowns and
 * the recent sessions. Per-card filters and per-card time ranges are exactly what
 * this avoids — two cards on different windows in one screen cannot be compared.
 *
 * Data comes from our own backend (`/api/llm-usage/summary`), which collects over
 * SSH instead of from a resident watcher, so `by_host` is ours to add.
 */

const RANGES = [7, 30, 90, 0];
const SESSION_ROWS = 8;

// Token buckets get the fixed slot order (identity by position, never by rank).
const TOKEN_COLORS = [
  color.dotPalette[0], color.dotPalette[4], color.dotPalette[7], color.dotPalette[10],
];
const AGENT_ACCENT = {
  claude: color.dotPalette[7],
  codex: color.dotPalette[0],
  opencode: color.dotPalette[4],
  gemini: color.dotPalette[11],
  copilot: color.dotPalette[2],
  cursor: color.dotPalette[9],
};
const agentAccent = (name) => AGENT_ACCENT[String(name).toLowerCase()] || color.subtext;

const _cache = new Map();     // days → { data, ts }
const _inFlight = new Map();
const CACHE_TTL_MS = 60 * 1000;

function useUsage(days) {
  const [data, setData] = useState(() => _cache.get(days)?.data || null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback((force = false) => {
    const cached = _cache.get(days);
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) { setData(cached.data); return; }
    if (!force && _inFlight.has(days)) {
      _inFlight.get(days).then((d) => { if (alive.current) setData(d); }).catch(() => {});
      return;
    }
    setBusy(true);
    setErr(null);
    const url = force ? `/api/llm-usage/refresh?days=${days}` : `/api/llm-usage/summary?days=${days}`;
    const p = fetch(url, { method: force ? 'POST' : 'GET', headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { _cache.set(days, { data: d, ts: Date.now() }); return d; })
      .finally(() => { _inFlight.delete(days); });
    if (!force) _inFlight.set(days, p);
    p.then((d) => { if (alive.current) { setData(d); setBusy(false); } })
      .catch((e) => { if (alive.current) { setErr(e.message || 'fetch failed'); setBusy(false); } });
  }, [days]);

  useEffect(() => { load(false); }, [load]);
  return { data, err, busy, refresh: () => load(true) };
}

/**
 * `days` 는 밖에서 온다 — 대시보드 상단의 범위 한 줄이 터미널 카드와 이 카드들을
 * **함께** 좁힌다. 여기에 또 범위를 두면 한 화면에 서로 다른 창이 생긴다.
 */
const LlmDashboard = ({ hosts = [], tabs = [], settings = {}, days = 7, onJumpPane, t }) => {
  const { data, err, busy, refresh } = useUsage(days);

  /* 수집 중임을 상단 갱신 버튼에 알린다(다른 컴포넌트라 이벤트로 건넨다).
     끝날 때 못 읽은 호스트가 있으면 이름만 함께 넘긴다 — 화면에 상주하는 경고 대신
     그때 한 번 알림으로 뜨고 사라진다. 매번 같은 문장이 서 있으면 그건 배경이다. */
  useEffect(() => {
    const failed = busy ? null : (data?.by_host || []).filter((h) => !h.ok).map((h) => h.name);
    emitLlmUsageBusy(busy, failed);
  }, [busy, data]);

  // Turning the switch on in settings must show up here without a reload.
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener(LLM_USAGE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LLM_USAGE_CHANGED_EVENT, onChanged);
  }, [refresh]);

  setUsageLocale(settings.language);
  const currency = resolveCurrency(settings.currency, settings.language);
  const fx = data?.fx || null;
  const money = useCallback((usd) => formatMoney(usd, { currency, fx }), [currency, fx]);
  const moneyTitle = useCallback((usd) => describeMoney(usd, { currency, fx }), [currency, fx]);

  const hostRows = useMemo(() => {
    const meta = new Map(hosts.map((h) => [h.id, h]));
    return (data?.by_host || [])
      .map((row) => {
        const m = meta.get(row.source_id);
        return {
          name: row.name,
          cost: row.cost,
          tokens: row.tokens,
          sessions: row.sessions,
          ok: row.ok,
          error: row.error,
          accent: m
            ? color.dotPalette[(m.color_index ?? 0) % color.dotPalette.length]
            : color.accent,
        };
      })
      .sort((a, b) => (b.cost || 0) - (a.cost || 0));
  }, [data, hosts]);

  const sessionRows = useMemo(
    () => attachPaneTargets(data?.sessions || [], tabs).slice(0, SESSION_ROWS),
    [data, tabs],
  );

  const totals = data?.totals || {};
  /* 켜져 있고 **실제로 쓴 게 있을 때만** 카드를 낸다. 켰는데 아직 아무것도 없으면
     빈 카드가 다섯 장 서는 것보다 없는 편이 낫다 — 왜 비었는지는 설정 화면이 답한다.
     (로딩 중에는 직전 데이터를 계속 보여준다. 깜빡임이 곧 체감 지연이다.) */
  if (!data && busy) return <LoadingCards t={t} />;
  if (!data || !data.enabled) return null;
  if (!(Number(totals.cost) > 0 || Number(totals.tokens) > 0)) return null;

  return (
    <div style={rootStyle}>
      {err && <div style={{ ...stateStyle, color: color.danger }}>{err}</div>}
      {/* 실패한 호스트를 화면에 뿌리지 않는다 — 매번 같은 문장이 상단에 서면 그건
          경고가 아니라 배경이 된다. 아래 "호스트별" 줄에 n/a 로 남고(툴팁에 사유),
          전체 진단은 설정 화면이 답한다. */}

      <LlmTiles totals={totals} money={money} moneyTitle={moneyTitle} t={t} />
      <KeyStats totals={totals} sessions={data.sessions || []} money={money} t={t} />

      <DailyChart rows={data.by_day || []} money={money} t={t} />

      <div style={colsStyle}>
        <HBars
          icon={Bot}
          title={t?.('llmByAgent') || 'By agent'}
          rows={data.by_agent || []}
          colorOf={agentAccent}
          money={money}
          t={t}
        />
        <HBars
          icon={Server}
          title={t?.('llmByHost') || 'By host'}
          rows={hostRows}
          colorOf={(name) => hostRows.find((h) => h.name === name)?.accent || color.accent}
          money={money}
          t={t}
        />
      </div>
      <div style={colsStyle}>
        <HBars icon={Cpu} title={t?.('llmByModel') || 'By model'} rows={data.by_model || []} money={money} t={t} />
        <HBars icon={FolderGit2} title={t?.('llmByProject') || 'Top projects'} rows={data.by_project || []} limit={10} money={money} t={t} />
      </div>

      <RecentSessions rows={sessionRows} onJumpPane={onJumpPane} money={money} t={t} />
    </div>
  );
};

/* 첫 수집은 호스트마다 SSH 를 타므로 몇 초가 걸린다. 그동안 빈 화면을 두면 "멈췄나"
   로 읽히고, 그게 곧 체감 지연이다. 카드 자리를 미리 세워 둔다. */
/* 로딩 자리는 대시보드 위쪽(터미널 사용량)과 **같은 조각**을 쓴다 — 한 화면에서 두 종류의
   스켈레톤이 서로 다른 모양·다른 펄스로 뛰면 그게 로딩이 아니라 고장으로 보인다. */
const LoadingCards = ({ t }) => (
  <div style={rootStyle} aria-busy="true">
    <div style={{ ...stateStyle, textAlign: 'left' }}>{t?.('llmCollecting') || 'Collecting…'}</div>
    <TileRowSkeleton count={4} />
    <ChartCardSkeleton />
    <div style={colsStyle}>
      <BarsCardSkeleton />
      <BarsCardSkeleton />
    </div>
  </div>
);

/** "전체 기간 · 07-06 - 08-06 · 85 세션 · 860만원" — 원판의 첫 줄. */
function summaryLine({ data, totals, money, t }) {
  const daysRows = data.by_day || [];
  const range = daysRows.length
    ? `${shortDay(daysRows[0].day)} – ${shortDay(daysRows[daysRows.length - 1].day)}`
    : '';
  const label = data.days === 0
    ? (t?.('rangeAll') || 'All time')
    : (t?.('lastNDays') || 'last {n} days').replace('{n}', String(data.days));
  const parts = [
    label,
    range,
    `${Math.round(totals.sessions || 0)} ${t?.('sessions') || 'sessions'}`,
    money(totals.cost),
  ].filter(Boolean);
  return parts.join(' · ');
}

/* ─── 일별 지출 — 비용/토큰 · 차트/표 ──────────────────────────────── */
const DailyChart = ({ rows, money, t }) => {
  const [metric, setMetric] = useState('cost');
  const [view, setView] = useState('chart');
  const [hover, setHover] = useState(null);
  const days = useMemo(() => fillDayGaps(rows), [rows]);
  const palette = metric === 'tokens' ? TOKEN_COLORS : [color.accent];
  const chart = useMemo(() => buildChart(days, metric, palette), [days, metric, palette]);

  const plotW = CHART_W - PAD_L - PAD_R;
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * CHART_W;
    const i = Math.round(((rel - PAD_L) / plotW) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };
  const shown = hover == null ? null : days[hover];
  /* 값은 **커서 옆**에 띄운다. 차트 위 왼쪽 구석에 적으면 눈이 그래프와 구석을 왕복해야
     하고, 그 줄은 호버하지 않는 동안 빈칸으로 남아 카드에 구멍이 뚫린 것처럼 보인다.
     터치에는 호버가 없어 손가락이 값을 가리므로, 폰에서는 지금처럼 위에 적는다. */
  const pointerTooltip = !isTouchPointer();
  const tooltipLeftPct = hover != null && chart.xs[hover] != null
    ? (chart.xs[hover] / CHART_W) * 100
    : null;
  const tooltipTopPct = hover != null && chart.bands.length
    ? (Math.min(...chart.bands.map((b) => b.tops[hover] ?? CHART_H)) / CHART_H) * 100
    : null;

  return (
    <section style={cardStyle}>
      <div style={cardHeadStyle}>
        <div>
          <h3 style={cardTitleStyle}>
            <TrendingUp size={12} strokeWidth={2} style={{ color: color.subtext }} />
            {t?.('llmDailySpend') || 'Daily spend'}
          </h3>
          <p style={cardHintStyle}>{t?.('llmDailyHint') || 'Switch to tokens for the per-type breakdown.'}</p>
        </div>
        <span style={{ flex: 1 }} />
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[['cost', t?.('llmCost') || 'Cost'], ['tokens', t?.('tokens') || 'Tokens']]}
        />
        <Segmented
          value={view}
          onChange={setView}
          options={[['chart', t?.('viewChart') || 'Chart'], ['table', t?.('viewTable') || 'Table']]}
        />
      </div>

      {days.length === 0 ? (
        <div style={stateStyle}>{t?.('noLlmUsage') || 'No usage collected yet.'}</div>
      ) : view === 'table' ? (
        <DailyTable days={days} money={money} t={t} />
      ) : (
        <>
          {!pointerTooltip && (
            <div style={chartReadoutStyle}>
              {shown && (
                <>
                  <span style={{ color: color.subtext }}>{shortDay(shown.day)}</span>
                  <strong style={{ color: color.text }}>
                    {metric === 'tokens' ? formatTokens(shown.tokens) : money(shown.cost)}
                  </strong>
                </>
              )}
            </div>
          )}
          <div style={chartWrapStyle}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            style={chartSvgStyle}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={t?.('llmDailySpend') || 'Daily spend'}
          >
            <defs>
              {chart.bands.map((band, i) => (
                <linearGradient key={band.key} id={`llmg-${metric}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={band.accent} stopOpacity="0.42" />
                  <stop offset="100%" stopColor={band.accent} stopOpacity="0.02" />
                </linearGradient>
              ))}
            </defs>

            {chart.ticks.map((tick) => (
              <line key={tick.value} x1={PAD_L} x2={CHART_W - PAD_R} y1={tick.y} y2={tick.y}
                stroke={color.border} strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={PAD_L} x2={CHART_W - PAD_R} y1={chart.baseY} y2={chart.baseY}
              stroke={color.border} strokeWidth="1" vectorEffect="non-scaling-stroke" />

            {/* 위 층부터 그려 아래 층이 가려지지 않게 — 원판과 같은 순서. */}
            {[...chart.bands].reverse().map((band) => {
              const i = chart.bands.indexOf(band);
              return (
                <g key={band.key}>
                  <path d={band.area} fill={`url(#llmg-${metric}-${i})`} />
                  <path d={band.line} fill="none" stroke={band.accent} strokeWidth="2"
                    strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}

            {hover != null && chart.xs[hover] != null && (
              <g>
                <line x1={chart.xs[hover]} x2={chart.xs[hover]} y1={PAD_T} y2={chart.baseY}
                  stroke={color.text} strokeWidth="1" opacity="0.45" vectorEffect="non-scaling-stroke" />
                {chart.bands.map((band) => (
                  <circle key={band.key} cx={chart.xs[hover]} cy={band.tops[hover]} r="3.5"
                    fill={band.accent} stroke={color.base} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}

          </svg>

          {/* 축 라벨은 HTML — SVG text 는 preserveAspectRatio=none 에서 폭에 따라
              가로로 눌린다(폰에서 특히 심하다). 위치만 %로 얹으면 왜곡이 없다. */}
          {chart.ticks.map((tick) => (
            <span
              key={tick.value}
              style={{ ...yTickStyle, top: `${(tick.y / CHART_H) * 100}%`, width: `${(PAD_L / CHART_W) * 100}%` }}
            >
              {metric === 'tokens' ? formatTokens(tick.value) : money(tick.value)}
            </span>
          ))}
          {chart.xLabels.map((label) => (
            <span
              key={label.day}
              style={{ ...xTickStyle, left: `${(label.x / CHART_W) * 100}%` }}
            >
              {shortDay(label.day)}
            </span>
          ))}

          {/* 커서 옆 툴팁 — 값이 있는 지점 바로 위에 뜬다. 가장자리에서는 좌우로 밀지 않고
              **꼬리만 옮긴다**(translate 비율 보정): 툴팁이 튀어나가지 않으면서 어느 점을
              가리키는지는 그대로 유지된다. 포인터 이벤트는 통과시켜 호버가 끊기지 않게. */}
          {pointerTooltip && shown && tooltipLeftPct != null && (
            <div
              style={{
                ...chartTooltipStyle,
                left: `${Math.max(4, Math.min(96, tooltipLeftPct))}%`,
                top: `${Math.max(0, (tooltipTopPct ?? 0))}%`,
                transform: `translate(${tooltipLeftPct < 12 ? '0' : tooltipLeftPct > 88 ? '-100%' : '-50%'}, calc(-100% - 10px))`,
              }}
            >
              <span style={{ color: color.subtext }}>{shortDay(shown.day)}</span>
              <strong style={{ color: color.text, fontVariantNumeric: 'tabular-nums' }}>
                {metric === 'tokens' ? formatTokens(shown.tokens) : money(shown.cost)}
              </strong>
            </div>
          )}
          </div>

          {metric === 'tokens' && (
            <div style={legendStyle}>
              {TOKEN_SERIES.map((s, i) => (
                <span key={s.key} style={legendItemStyle}>
                  <span style={{ ...legendDotStyle, background: TOKEN_COLORS[i] }} />
                  {t?.(s.label) || s.key}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};

const DailyTable = ({ days, money, t }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>{t?.('day') || 'Day'}</th>
          {TOKEN_SERIES.map((s) => (
            <th key={s.key} style={{ ...thStyle, textAlign: 'right' }}>{t?.(s.label) || s.key}</th>
          ))}
          <th style={{ ...thStyle, textAlign: 'right' }}>{t?.('llmCost') || 'Cost'}</th>
        </tr>
      </thead>
      <tbody>
        {[...days].reverse().map((d) => (
          <tr key={d.day}>
            <td style={tdStyle}>{d.day}</td>
            {TOKEN_SERIES.map((s) => (
              <td key={s.key} style={{ ...tdStyle, textAlign: 'right' }}>{formatTokens(d[s.key])}</td>
            ))}
            <td style={{ ...tdStyle, textAlign: 'right', color: color.text }}>{money(d.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const RecentSessions = ({ rows, onJumpPane, money, t }) => (
  <section style={cardStyle}>
    <h3 style={cardTitleStyle}>
      <History size={12} strokeWidth={2} style={{ color: color.subtext }} />
      {t?.('llmRecentSessions') || 'Recent agent sessions'}
    </h3>
    {rows.length === 0 ? (
      <div style={stateStyle}>{t?.('noLlmSessions') || 'No sessions in this window.'}</div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <tbody>
            {rows.map((s) => {
              const jumpable = !!(s.pane && onJumpPane);
              return (
                <tr
                  key={`${s.host_id}:${s.session_id}`}
                  onClick={jumpable ? () => onJumpPane(s.pane.tabId, s.pane.paneId) : undefined}
                  style={{ cursor: jumpable ? 'pointer' : 'default' }}
                  title={jumpable ? (t?.('jumpToPane') || 'Jump to pane') : (s.cwd || '')}
                >
                  <td style={{ ...tdStyle, color: color.text, maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || s.project || s.session_id}
                  </td>
                  <td style={{ ...tdStyle, color: agentAccent(s.agent) }}>{s.agent}</td>
                  <td style={tdStyle}>{s.host_name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: color.text }}>{money(s.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

/* 홈의 터미널/대시보드·기간 스위치와 **같은 모양**을 쓴다 — 성격이 같은 컨트롤이
   화면마다 달라 보이면 그건 다른 컨트롤로 읽힌다(styles/segmented.js). */
const Segmented = ({ value, onChange, options }) => (
  <div style={segmentedTrackStyle({ radius: '8px' })} role="group">
    {options.map(([key, label]) => {
      const isOn = value === key;
      return (
        <button
          key={key}
          type="button"
          aria-pressed={isOn}
          onClick={() => onChange(key)}
          style={segmentedItemStyle({ active: isOn, compact: true })}
          onMouseEnter={(e) => { if (!isOn) e.currentTarget.style.background = segmentedHoverBackground; }}
          onMouseLeave={(e) => { if (!isOn) e.currentTarget.style.background = 'transparent'; }}
        >
          {label}
        </button>
      );
    })}
  </div>
);

/* 토큰 수도 통화와 같은 규칙 — 읽는 사람이 말하는 단위로. "7.8B" 는 한국어 숫자가
   아니다. 언어는 컴포넌트가 알고 있으므로 모듈 레벨 변수로 건네받는다(포맷터를
   프롭으로 다 흘리면 카드마다 인자가 하나씩 늘어난다). */
let _locale = 'en';
export const setUsageLocale = (locale) => { _locale = locale || 'en'; };
export function formatTokens(n) {
  return formatCount(n, _locale);
}

/* ─── styles — 앱의 카드 언어(평평한 면 + 헤어라인) 그대로. */
const rootStyle = { display: 'flex', flexDirection: 'column', gap: space['3'] };
const headRowStyle = { display: 'flex', alignItems: 'center', gap: space['2'] };
const headSummaryStyle = { fontSize: fontSize['11'], color: color.subtext, fontFamily: font.sans };
const iconBtnStyle = {
  background: 'transparent', border: 'none', color: color.subtext,
  cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center',
};
const filterRowStyle = {
  display: 'flex', flexWrap: 'wrap', gap: '4px',
  ...dashboardCardStyle({ padding: '8px' }),
};
const rangeBtnStyle = {
  padding: '4px 12px', minHeight: '30px', border: '1px solid',
  borderRadius: radius.sm, fontSize: fontSize['11'], fontWeight: fontWeight.medium,
  fontFamily: font.sans, cursor: 'pointer', whiteSpace: 'nowrap',
};
const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: '8px',
  ...dashboardCardStyle(),
};
const cardHeadStyle = { display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' };
/* 제목은 카드가 무엇인지 말하는 유일한 줄이다 — 값보다 작게 두되 본문 색을 유지한다.
   subtext + 11px 로 내렸더니 카드 이름부터 안 읽혔다. */
const cardTitleStyle = {
  margin: 0, fontSize: fontSize['12'], fontWeight: fontWeight.semibold,
  color: color.text, fontFamily: font.sans, letterSpacing: '0.02em',
  display: 'flex', alignItems: 'center', gap: '6px',
};
const cardHintStyle = { margin: '2px 0 0', fontSize: fontSize['11'], color: color.subtext };
const colsStyle = {
  display: 'grid', gap: space['3'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
};
const chartSvgStyle = { display: 'block', width: '100%', height: `${CHART_H}px` };
const chartReadoutStyle = {
  display: 'flex', gap: '8px', alignItems: 'baseline',
  minHeight: '16px', fontSize: fontSize['11'], fontFamily: font.sans,
};
const chartWrapStyle = { position: 'relative', width: '100%' };
/* 호버가 없는 입력(터치)에서는 커서 툴팁이 손가락 밑에 깔린다 — 그때는 상단 readout 을 쓴다. */
const isTouchPointer = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none)').matches;
};
const chartTooltipStyle = {
  position: 'absolute',
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '6px',
  padding: '4px 8px',
  whiteSpace: 'nowrap',
  fontSize: fontSize['11'],
  fontFamily: font.sans,
  borderRadius: radius.sm,
  background: `color-mix(in srgb, ${color.surface1} 92%, transparent)`,
  border: `1px solid ${color.borderStrong}`,
  boxShadow: `0 4px 14px color-mix(in srgb, ${color.crust} 60%, transparent)`,
  backdropFilter: 'blur(var(--glass-blur-card, 12px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-card, 12px))',
  pointerEvents: 'none',
  zIndex: 3,
};
/* 눈금 라벨은 그림 위에 얹는 HTML 이다 — 늘어나는 것은 그래프뿐이고 글자는 아니다. */
const yTickStyle = {
  position: 'absolute', left: 0, transform: 'translateY(-50%)',
  paddingRight: '6px', textAlign: 'right',
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
  pointerEvents: 'none', whiteSpace: 'nowrap',
};
const xTickStyle = {
  position: 'absolute', bottom: 0, transform: 'translateX(-50%)',
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
  pointerEvents: 'none', whiteSpace: 'nowrap',
};
const legendStyle = { display: 'flex', flexWrap: 'wrap', gap: '4px 12px' };
const legendItemStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  fontSize: fontSize['10'], color: color.subtext,
};
const legendDotStyle = { width: '7px', height: '7px', borderRadius: '2px', flexShrink: 0 };
const stateStyle = {
  padding: '14px', textAlign: 'center', color: color.subtext,
  fontSize: fontSize['11'], fontFamily: font.sans,
};
const warnStyle = {
  padding: '6px 10px', fontSize: fontSize['11'], color: color.warning,
  background: `color-mix(in srgb, ${color.warning} 10%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color.warning} 25%, transparent)`,
  borderRadius: radius.sm,
};
const tableStyle = {
  width: '100%', borderCollapse: 'collapse',
  fontSize: fontSize['11'], fontFamily: font.sans,
};
const thStyle = {
  textAlign: 'left', padding: '4px 8px', color: color.subtext,
  fontWeight: fontWeight.medium, borderBottom: `1px solid ${color.border}`, whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '5px 8px', color: color.subtext,
  borderBottom: `1px solid color-mix(in srgb, ${color.border} 50%, transparent)`,
  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
};

export default LlmDashboard;
