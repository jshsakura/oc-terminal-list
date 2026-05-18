import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Server, Monitor, BarChart3 } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

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

const DashboardCards = ({ hosts = [], settings = {}, days = 7, t }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const containerRef = useRef(null);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const fetchSummary = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setErr(null);
    const token = localStorage.getItem('auth_token');
    fetch(`/api/usage/summary?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setData(d);
        setLoading(false);
        lastFetchRef.current = Date.now();
      })
      .catch((e) => {
        setErr(e.message || 'fetch failed');
        setLoading(false);
      })
      .finally(() => { inFlightRef.current = false; });
  }, [days]);

  useEffect(() => {
    setLoading(true);
    fetchSummary();
  }, [fetchSummary]);

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
    return data.by_target.map((tg) => {
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
      const accent = host
        ? color.dotPalette[(host.color_index ?? 0) % color.dotPalette.length]
        : color.muted;
      return {
        ...tg,
        name: host?.name || (t?.('removedHost') || 'Removed host'),
        accent,
        iconValue: host?.icon || '',
        fallbackIcon: Server,
      };
    });
  }, [data, hostMetaById, localMeta, t]);

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
          <StatCell value={loading ? '—' : formatDuration(totalSeconds, t)} label={t?.('totalTime') || 'Total'} accent={color.accent} pct={loading ? 0 : totalPct} />
          <StatCell value={loading ? '—' : String(sessionCount)} label={t?.('sessions') || 'Sessions'} accent={color.info} dim />
          <StatCell value={loading ? '—' : `${activeTargets}/${totalKnownTargets}`} label={t?.('activeHosts') || 'Active'} accent={color.success} pct={loading ? 0 : activePct} />
          <StatCell value={loading ? '—' : formatDuration(avgSeconds, t)} label={t?.('avgSession') || 'Avg'} accent={color.warning} pct={loading ? 0 : avgPct} />
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
                  <span style={rankValueStyle}>{formatDuration(tg.total_seconds, t)}</span>
                </div>
                {/* 모든 막대 track 폭 동일 (row 전체) — 길이 차이는 fill 비율만으로. */}
                <div style={rankBarTrackStyle}>
                  <div
                    style={{
                      ...rankBarFillStyle,
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${tg.accent}aa, ${tg.accent})`,
                      boxShadow: `0 0 0 1px ${tg.accent}33`,
                    }}
                  />
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

/* ─── 포맷터 (i18n) ───────────────────────────────────────────────────
 * 단위 라벨은 t() 로 받아 영문은 'd/h/m/s', 한글은 '일/시간/분/초' 처럼 자연스럽게.
 * 한글 라벨은 띄어쓰기가 필요하지만 영문은 약어라 붙여도 자연 — `7d` vs `7 일` 양쪽 케이스 분기.
 */
function formatDuration(seconds, t) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const u = (key, fallback) => {
    const v = t?.(key);
    return v && v !== key ? v : fallback;
  };
  const dU = u('uptimeDayUnit', 'd');
  const hU = u('uptimeHourUnit', 'h');
  const mU = u('uptimeMinuteUnit', 'm');
  const sU = u('uptimeSecondUnit', 's');
  // 영문 약어(`d`)는 숫자에 붙이고, 한글(`일`)처럼 1글자 초과 라벨은 공백을 두어 가독성 확보.
  const join = (n, unit) => (unit.length > 1 ? `${n} ${unit}` : `${n}${unit}`);
  if (s < 60) return join(s, sU);
  const m = Math.floor(s / 60);
  if (m < 60) return join(m, mU);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${join(h, hU)} ${join(remM, mU)}` : join(h, hU);
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${join(d, dU)} ${join(remH, hU)}` : join(d, dU);
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

/* Host ranking — row = (header [icon name duration]) + (full-width bar) 2단 */
const rankListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
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
  gridTemplateColumns: '18px minmax(0, 1fr) auto',
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
  height: '10px',
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
const rankValueStyle = {
  fontSize: fontSize['11'],
  fontFamily: font.mono,
  color: color.subtext,
  whiteSpace: 'nowrap',
};

export default DashboardCards;
