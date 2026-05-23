import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Server, Monitor, BarChart3 } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import { authHeaders } from '../utils/auth';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * EmptyPane 의 사용 통계 카드 3장.
 *
 * 데이터 출처: /api/usage/summary (이벤트 로그 집계).
 * 폴링 없음 — 마운트 + 빈 패널이 viewport 에 다시 들어올 때마다 1회. 30초 안 가까운 재트리거는 skip.
 *
 *  ┌─ 카드 A: At-a-glance ───────┐  카드 B: 호스트 랭킹 막대 (top 5)
 *  │ 7d 총 시간 / 활성 / 세션 수 │  카드 C: 원격 vs 로컬 + 평균 세션
 *  └─────────────────────────────┘
 */
const VISIBLE_REFETCH_COOLDOWN_MS = 30 * 1000;
// 모듈레벨 캐시 — App-level + EmptyPane 두 인스턴스가 동시 마운트 시 burst 방지
const _summaryCache = new Map(); // `days` → { data, ts }
const SUMMARY_CACHE_TTL_MS = 10 * 1000;
// 진행 중인 in-flight promise — 같은 days 키에 대해 단 하나만 유지
const _summaryInFlight = new Map(); // `days` → Promise

const DashboardCards = ({ hosts = [], settings = {}, days = 7, t }) => {
  const [data, setData] = useState(() => _summaryCache.get(days)?.data ?? null);
  const [loading, setLoading] = useState(() => !_summaryCache.get(days));
  const [err, setErr] = useState(null);
  const containerRef = useRef(null);
  const lastFetchRef = useRef(_summaryCache.get(days)?.ts ?? 0);

  const fetchSummary = useCallback(() => {
    const cached = _summaryCache.get(days);
    if (cached && Date.now() - cached.ts < SUMMARY_CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      lastFetchRef.current = cached.ts;
      return;
    }
    // 동일 days 를 여러 인스턴스가 동시에 요청하면 in-flight promise 공유
    if (_summaryInFlight.has(days)) {
      _summaryInFlight.get(days).then((d) => {
        setData(d); setLoading(false); setErr(null);
      }).catch((e) => { setErr(e.message || 'fetch failed'); setLoading(false); });
      return;
    }
    setErr(null);
    const p = fetch(`/api/usage/summary?days=${days}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        _summaryCache.set(days, { data: d, ts: Date.now() });
        return d;
      })
      .finally(() => { _summaryInFlight.delete(days); });
    _summaryInFlight.set(days, p);
    p.then((d) => {
      setData(d);
      setLoading(false);
      lastFetchRef.current = Date.now();
    }).catch((e) => { setErr(e.message || 'fetch failed'); setLoading(false); });
  }, [days]);

  useEffect(() => {
    if (!_summaryCache.has(days)) setLoading(true);
    fetchSummary();
  }, [fetchSummary, days]);

  // 빈 패널이 viewport 에 다시 들어올 때 1회 — 다른 pane 보다가 돌아왔을 때 통계가 신선하게.
  // cooldown 으로 짧은 시간 안 반복 트리거 방지.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (Date.now() - lastFetchRef.current < VISIBLE_REFETCH_COOLDOWN_MS) return;
        fetchSummary();
      });
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchSummary]);

  // 호스트 id → 메타 매핑 (이름/아이콘/색상 — 카드 B 에서 사용)
  const hostMetaById = useMemo(() => {
    const map = new Map();
    hosts.forEach((h) => map.set(h.id, h));
    return map;
  }, [hosts]);

  const localMeta = useMemo(
    () => ({
      name: (settings.localName || '').trim() || (t?.('thisMachine') || 'This machine'),
      icon: settings.localIcon || '',
      accent: color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length],
    }),
    [settings.localName, settings.localIcon, settings.localColorIndex, t],
  );

  const enrichedTargets = useMemo(() => {
    if (!data?.by_target) return [];
    return data.by_target
      // 삭제된 호스트(현재 hosts 목록에 없는 host target) 는 통계에서 제외 — local 은 항상 통과.
      .filter((tg) => tg.target_type === 'local' || hostMetaById.has(tg.target_id))
      .map((tg) => {
        if (tg.target_type === 'local') {
          return {
            ...tg,
            name: localMeta.name,
            accent: localMeta.accent,
            iconValue: localMeta.icon,
            fallbackIcon: Monitor,
          };
        }
        const host = hostMetaById.get(tg.target_id);
        const accent = color.dotPalette[(host.color_index ?? 0) % color.dotPalette.length];
        return {
          ...tg,
          name: host.name,
          accent,
          iconValue: host.icon || '',
          fallbackIcon: Server,
        };
      });
  }, [data, hostMetaById, localMeta]);

  return (
    <div ref={containerRef} style={gridStyle}>
      <StatStripCard
        loading={loading}
        err={err}
        totalSeconds={data?.total_seconds || 0}
        sessionCount={data?.session_count || 0}
        activeTargets={data?.active_targets || 0}
        avgSeconds={data?.avg_session_seconds || 0}
        windowDays={data?.window_days || days}
        totalKnownTargets={hosts.length + 1}
        t={t}
      />
      <HostRankingCard
        loading={loading}
        err={err}
        targets={enrichedTargets}
        t={t}
      />
    </div>
  );
};

const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

const StatStripCard = ({
  title, loading, err, totalSeconds, sessionCount, activeTargets, avgSeconds,
  windowDays = 7, totalKnownTargets = 1, t,
}) => {
  const totalWindow = windowDays * HOURS_PER_DAY * SECONDS_PER_HOUR;
  const totalPct = totalWindow > 0 ? Math.min(100, (totalSeconds / totalWindow) * 100) : 0;
  const activePct = totalKnownTargets > 0 ? Math.min(100, (activeTargets / totalKnownTargets) * 100) : 0;
  const avgPct = Math.min(100, (avgSeconds / SECONDS_PER_HOUR) * 100);

  return (
    <CardShell icon={Activity} title={title || (t?.('atAGlance') || 'Overview')}>
      {err ? <ErrorState message={err} /> : (
        <div style={statQuadStyle}>
          <StatCell value={loading ? '—' : formatDuration(totalSeconds)} label={t?.('totalTime') || 'Total'} accent={color.accent} pct={loading ? 0 : totalPct} />
          <StatCell value={loading ? '—' : String(sessionCount)} label={t?.('sessions') || 'Sessions'} accent={color.info} dim />
          <StatCell value={loading ? '—' : `${activeTargets}/${totalKnownTargets}`} label={t?.('activeHosts') || 'Active'} accent={color.success} pct={loading ? 0 : activePct} />
          <StatCell value={loading ? '—' : formatDuration(avgSeconds)} label={t?.('avgSession') || 'Avg'} accent={color.warning} pct={loading ? 0 : avgPct} />
        </div>
      )}
    </CardShell>
  );
};

// 4 칸 동일 패턴. dim=true 는 비율 없는 stat(Sessions) — 호는 흐린 풀링.
const StatCell = ({ value, label, accent, pct = null, dim = false }) => (
  <div style={statCellStyle}>
    <RadialGauge size={46} thickness={4} pct={dim ? 100 : (pct ?? 0)} accent={dim ? `${accent}55` : accent}>
      <span style={statCellValueStyle}>{value}</span>
    </RadialGauge>
    <span style={statCellLabelStyle}>{label}</span>
  </div>
);

/* SVG 라디얼 게이지 — 가운데에 children 표시. -90도 회전으로 12시 부터 시작. */
const RadialGauge = ({ pct = 0, accent, size = 96, thickness = 8, children }) => {
  const safe = Math.max(0, Math.min(100, pct));
  const r = (size - thickness) / 2;
  const cir = 2 * Math.PI * r;
  const offset = cir * (1 - safe / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color.crust} strokeWidth={thickness} fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={accent} strokeWidth={thickness} fill="none"
          strokeDasharray={cir}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 320ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '1px', pointerEvents: 'none',
      }}>
        {children}
      </div>
    </div>
  );
};

const MiniStat = ({ icon: Icon, label, value, accent, pct = null, loading = false }) => (
  <div style={miniStatStyle}>
    {pct != null ? (
      <RadialGauge size={36} thickness={4} pct={loading ? 0 : pct} accent={accent}>
        <Icon size={11} strokeWidth={2.1} style={{ color: accent }} />
      </RadialGauge>
    ) : (
      <div style={miniStatIconBoxStyle}>
        <Icon size={14} strokeWidth={2.1} style={{ color: accent }} />
      </div>
    )}
    <div style={miniStatTextStyle}>
      <span style={miniStatValueStyle}>{value}</span>
      <span style={miniStatLabelStyle}>{label}</span>
    </div>
  </div>
);

/* ─── 카드 B: 호스트별 막대 (top 5) ───────────────────────────────────── */
const HostRankingCard = ({ loading, err, targets, t }) => {
  const top = (targets || []).slice(0, 5);
  const max = top.length ? Math.max(...top.map((x) => x.total_seconds), 1) : 1;
  return (
    <CardShell icon={BarChart3} title={t?.('byHost') || 'By host'}>
      {err ? (
        <ErrorState message={err} />
      ) : loading ? (
        <EmptyState message={t?.('loading') || 'Loading…'} />
      ) : top.length === 0 ? (
        <EmptyState message={t?.('noUsageYet') || 'No usage yet — connect to a host to start tracking.'} />
      ) : (
        <ul style={rankListStyle}>
          {top.map((tg) => {
            // pct = max 호스트 대비 비율 (최대값 = 100%). 0 이어도 흔적 보이게 최소 3%.
            const pct = Math.max(3, Math.round((tg.total_seconds / max) * 100));
            return (
              <li key={`${tg.target_type}:${tg.target_id}`} style={rankRowStyle}>
                <div style={rankHeaderStyle}>
                  <span
                    style={{
                      ...rankIconStyle,
                      color: tg.accent,
                      borderColor: `${tg.accent}33`,
                      background: `${tg.accent}10`,
                    }}
                  >
                    <HostIcon value={tg.iconValue} fallback={tg.fallbackIcon} size={12} strokeWidth={1.9} />
                  </span>
                  <span style={rankNameStyle} title={tg.name}>{tg.name}</span>
                </div>
                {/* 막대 안에 duration 텍스트 오버레이 — 2열 그리드에서 헤더 폭 확보용. */}
                <div style={rankBarTrackStyle}>
                  <div
                    style={{
                      ...rankBarFillStyle,
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${tg.accent}aa, ${tg.accent})`,
                      boxShadow: `0 0 0 1px ${tg.accent}33`,
                    }}
                  />
                  <span style={rankBarValueStyle}>{formatDuration(tg.total_seconds)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
};

/* ─── 공용 카드 셸 ──────────────────────────────────────────────────── */
const CardShell = ({ icon: Icon, title, children }) => (
  <div style={cardStyle}>
    <div style={cardHeadStyle}>
      {Icon && <Icon size={11} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
      <span style={cardTitleStyle}>{title}</span>
    </div>
    <div style={cardBodyStyle}>{children}</div>
  </div>
);

const EmptyState = ({ message }) => (
  <div style={emptyStateStyle}>{message}</div>
);
const ErrorState = ({ message }) => (
  <div style={{ ...emptyStateStyle, color: color.danger }}>{message}</div>
);

/* ─── 포맷터 ──────────────────────────────────────────────────────────
 * 게이지/막대 셀이 좁아서 항상 짧은 영문 약어(d/h/m/s) 사용 — 한글 '1일 18시간' 류 오버플로 방지.
 * (TerminalHeader 의 uptime 은 별도 — 거기는 가로 여유가 있어 i18n 유지.)
 */
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

/* ─── 스타일 (HostRow / Section 톤과 통일) ─────────────────────────── */
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: '8px',
};
const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '12px 14px',
  background: color.surface0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  fontFamily: font.sans,
  minHeight: '120px',
  boxSizing: 'border-box',
};
const cardHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};
const cardTitleStyle = {
  fontSize: fontSize['11'],
  fontWeight: fontWeight.semibold,
  color: color.subtext,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};
const cardBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flex: 1,
  minHeight: 0,
};
const emptyStateStyle = {
  fontSize: fontSize['12'],
  color: color.muted,
  textAlign: 'center',
  padding: '14px 4px',
  lineHeight: 1.45,
};

/* Overview / Last 30 days — 4 칸 라디얼 grid */
const statQuadStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '6px',
};
const statCellStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '4px',
  minWidth: 0,
};
const statCellValueStyle = {
  fontSize: '11px',
  fontWeight: fontWeight.semibold,
  fontFamily: font.mono,
  color: color.text,
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
};
const statCellLabelStyle = {
  fontSize: '9.5px',
  letterSpacing: '0.04em',
  color: color.muted,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  textAlign: 'center',
};

/* Host ranking — 가로 2열 그리드로 깔아 카드 높이 단축 (At-a-glance 와 균형).
   각 셀: 헤더 (icon name duration) + 전체 폭 막대. */
const rankListStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '10px 14px',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const rankRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  minWidth: 0,
};
const rankHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};
const rankIconStyle = {
  width: '18px',
  height: '18px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid transparent',
  borderRadius: radius.sm,
  flexShrink: 0,
};
const rankNameStyle = {
  fontSize: fontSize['12'],
  fontWeight: fontWeight.medium,
  color: color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};
const rankBarTrackStyle = {
  position: 'relative',
  height: '14px',
  width: '100%',
  background: color.crust,
  border: `1px solid ${color.border}`,
  borderRadius: radius.full,
  overflow: 'hidden',
};
const rankBarFillStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  borderRadius: radius.full,
  transition: 'width 300ms cubic-bezier(0.16, 1, 0.3, 1)',
};
/* duration 텍스트 — 막대 오른쪽 끝에 오버레이.
   흰색 고정 + 진한 다중 그림자로 라이트/다크 테마, fill/track 양쪽 모두 가독. */
const rankBarValueStyle = {
  position: 'absolute',
  top: 0,
  right: '6px',
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  fontSize: '9.5px',
  fontFamily: font.mono,
  fontWeight: fontWeight.semibold,
  color: '#ffffff',
  textShadow: '0 0 3px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.75), 0 0 1px rgba(0,0,0,1)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

export default DashboardCards;
