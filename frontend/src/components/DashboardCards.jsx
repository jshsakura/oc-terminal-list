import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Server, Monitor, BarChart3 } from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import { authHeaders } from '../utils/auth';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * EmptyPane 의 사용 통계 카드 2장.
 *
 * 데이터 출처: /api/usage/summary (이벤트 로그 집계).
 * 폴링 없음 — 마운트 + 빈 패널이 viewport 에 다시 들어올 때마다 1회. 30초 안 가까운 재트리거는 skip.
 *
 *  카드 A: Overview (총 시간 + 슬림 진행바 + 세션/활성/평균 3칸)
 *  카드 B: 호스트별 랭킹 (top 5, 얇은 막대)
 *
 * 비주얼: 미니멀 — 평평한 surface0 카드 + 헤어라인 보더. 글로우/그라디언트 보더/스핀 없음.
 * 유일한 애니메이션은 로딩 스켈레톤 펄스(opacity) 뿐 — prefers-reduced-motion 존중.
 */
const VISIBLE_REFETCH_COOLDOWN_MS = 30 * 1000;
// 모듈레벨 캐시 — App-level + EmptyPane 두 인스턴스가 동시 마운트 시 burst 방지
const _summaryCache = new Map(); // `days` → { data, ts }
const SUMMARY_CACHE_TTL_MS = 10 * 1000;
// 진행 중인 in-flight promise — 같은 days 키에 대해 단 하나만 유지
const _summaryInFlight = new Map(); // `days` → Promise

// entrance 애니메이션 — 전부 마운트 1회 bounded. 무한 타이머/매초 리렌더 없음.
const COUNTUP_MS = 900;
const GAUGE_SWEEP_MS = 600;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/* prefers-reduced-motion 감지 — reduce 면 모든 entrance 애니메이션을 생략하고 최종값 즉시. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/* 0→target 카운트업 — requestAnimationFrame ease-out, ~900ms 후 반드시 종료(영구 루프 X).
 * target 이 바뀔 때마다(days 변경/새 데이터) 1회만 재실행. reduce 면 즉시 최종값. */
function useCountUp(target, enabled) {
  const prefersReduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const [running, setRunning] = useState(false);
  const rafRef = useRef(0);
  const startedForRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (startedForRef.current === target) return undefined; // 같은 target 재애니메이션 금지
    startedForRef.current = target;

    if (prefersReduced || target <= 0) {
      setValue(target);
      setRunning(false);
      return undefined;
    }

    setRunning(true);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / COUNTUP_MS);
      setValue(Math.round(target * easeOutCubic(t)));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target); // 정확한 최종값으로 정착
        setRunning(false);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, target, prefersReduced]);

  return { value, running };
}

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
      {/* 스켈레톤 펄스 전용 — 두 카드가 공유하는 단일 <style> 블록. */}
      <style>{DASHBOARD_KEYFRAMES}</style>
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

  return (
    <CardShell icon={Activity} title={title || (t?.('atAGlance') || 'Overview')}>
      {err ? <ErrorState message={err} /> : (
        <div style={overviewBodyStyle}>
          {/* 히어로 — 총 시간이 이 카드의 주인공. 크고 또렷한 mono 숫자를 카드 중앙에 당당하게,
              캡션은 작고 muted. 아래 얇은 진행바 하나가 유일한 accent 포인트. */}
          <div style={heroStyle}>
            <span style={heroCaptionStyle}>{`${t?.('totalTime') || 'Total'} · ${windowDays}d`}</span>
            <HeroDuration seconds={totalSeconds} loading={loading} />
            <div style={heroBarTrackStyle}>
              <div style={heroBarFillStyle(loading ? 0 : totalPct)} />
            </div>
          </div>
          {/* 서포팅 3 칸 — 세션 / 활성(얇은 링) / 평균. 조용한 아래 줄, 헤어라인 구분선. */}
          <div style={statCellsRowStyle}>
            <StatCell>
              <span style={statValueStyle}>{loading ? '—' : String(sessionCount)}</span>
              <span style={statLabelStyle}>{t?.('sessions') || 'Sessions'}</span>
            </StatCell>
            <StatCell divider>
              <RadialGauge pct={loading ? 0 : activePct}>
                <span style={statRingValueStyle}>{loading ? '—' : `${activeTargets}/${totalKnownTargets}`}</span>
              </RadialGauge>
              <span style={statLabelStyle}>{t?.('activeHosts') || 'Active'}</span>
            </StatCell>
            <StatCell divider>
              <span style={statValueStyle}>{loading ? '—' : formatDuration(avgSeconds)}</span>
              <span style={statLabelStyle}>{t?.('avgSession') || 'Avg'}</span>
            </StatCell>
          </div>
        </div>
      )}
    </CardShell>
  );
};

/* 히어로 총 시간 — 한 문자열이 아니라 숫자/단위 세그먼트로 렌더.
 * 숫자는 크고 볼드, 단위(d/h/m/s)는 작게 muted, baseline 정렬.
 * 첫(가장 큰) 단위의 숫자에만 절제된 accent 포인트 하나. */
const HeroDuration = ({ seconds, loading }) => {
  // 데이터 로드(=!loading) 되면 0→seconds 카운트업. 도중엔 초까지 흐르고, 끝나면 coarse 로 정착.
  const { value, running } = useCountUp(seconds, !loading);
  if (loading) return <span className="dc-skel" style={heroValueStyle}>—</span>;
  const parts = running ? durationPartsFull(value) : durationParts(seconds);
  return (
    <span style={heroValueStyle} aria-label={formatDuration(seconds)}>
      {parts.map((p, i) => (
        <span key={p.unit} style={heroSegStyle}>
          <span style={i === 0 ? heroNumAccentStyle : heroNumStyle}>{p.value}</span>
          <span style={heroUnitStyle}>{p.unit}</span>
        </span>
      ))}
    </span>
  );
};

// 서포팅 칸 — 값 + 라벨을 세로로, 왼쪽에 얇은 구분선(첫 칸 제외).
const StatCell = ({ divider = false, children }) => (
  <div style={statCellStyle(divider)}>{children}</div>
);

/* SVG 라디얼 게이지 — 가운데에 children 표시. 얇고 절제된 톤, 글로우 없음.
 * 마운트 시 stroke 를 0→목표로 스윕인(~600ms ease-out). reduce 면 즉시 목표값. */
const RadialGauge = ({ pct = 0, size = 36, thickness = 3, children }) => {
  const prefersReduced = usePrefersReducedMotion();
  const safe = Math.max(0, Math.min(100, pct));
  const [shown, setShown] = useState(prefersReduced ? safe : 0);
  useEffect(() => {
    if (prefersReduced) { setShown(safe); return undefined; }
    // 다음 프레임에 목표값으로 — 초기 0 에서 CSS transition 이 스윕을 그린다(bounded, RAF 1회).
    const id = requestAnimationFrame(() => setShown(safe));
    return () => cancelAnimationFrame(id);
  }, [safe, prefersReduced]);

  const r = (size - thickness) / 2;
  const cir = 2 * Math.PI * r;
  const offset = cir * (1 - shown / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={`color-mix(in srgb, ${color.text} 10%, transparent)`} strokeWidth={thickness} fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color.accent} strokeWidth={thickness} fill="none"
          strokeDasharray={cir}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: prefersReduced ? 'none' : `stroke-dashoffset ${GAUGE_SWEEP_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        {children}
      </div>
    </div>
  );
};

/* ─── 카드 B: 호스트별 막대 (top 5) ───────────────────────────────────── */
const HostRankingCard = ({ loading, err, targets, t }) => {
  const top = (targets || []).slice(0, 5);
  const max = top.length ? Math.max(...top.map((x) => x.total_seconds), 1) : 1;
  return (
    <CardShell icon={BarChart3} title={t?.('byHost') || 'By host'}>
      {err ? (
        <ErrorState message={err} />
      ) : loading ? (
        <ul style={rankListStyle}>
          {[0, 1, 2].map((i) => <RankSkeletonRow key={i} />)}
        </ul>
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
                  <span style={{ ...rankIconStyle, color: tg.accent }}>
                    <HostIcon value={tg.iconValue} fallback={tg.fallbackIcon} size={12} strokeWidth={1.8} />
                  </span>
                  <span style={rankNameStyle} title={tg.name}>{tg.name}</span>
                  <span style={rankValueStyle}>{formatDuration(tg.total_seconds)}</span>
                </div>
                <div style={rankBarTrackStyle}>
                  <div style={{ ...rankBarFillStyle, width: `${pct}%`, background: tg.accent }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
};

const RankSkeletonRow = () => (
  <li style={rankRowStyle} aria-hidden="true">
    <div style={rankHeaderStyle}>
      <span style={{ ...rankIconStyle, opacity: 0.5 }} />
      <span className="dc-skel" style={rankSkelNameStyle} />
    </div>
    <div style={rankBarTrackStyle} className="dc-skel" />
  </li>
);

/* ─── 공용 카드 셸 — 평평한 surface0 + 헤어라인 보더. 글로우/그라디언트/시인 없음. */
const CardShell = ({ icon: Icon, title, children }) => (
  <div style={cardStyle}>
    <div style={cardHeadStyle}>
      {Icon && <Icon size={12} strokeWidth={2.2} color={color.subtext} />}
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

/* 히어로 렌더용 — formatDuration 과 같은 규칙이되 [{value, unit}] 세그먼트로 반환.
 * (숫자 대 / 단위 소 대비를 주려면 문자열이 아니라 조각이 필요해서 별도 함수.) */
function durationParts(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return [{ value: s, unit: 's' }];
  const m = Math.floor(s / 60);
  if (m < 60) return [{ value: m, unit: 'm' }];
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) {
    const out = [{ value: h, unit: 'h' }];
    if (remM) out.push({ value: remM, unit: 'm' });
    return out;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  const out = [{ value: d, unit: 'd' }];
  if (remH) out.push({ value: remH, unit: 'h' });
  return out;
}

/* 카운트업 도중 전용 — 초 granularity 까지 쪼개서 마지막 세그먼트가 촤르륵 흐르게.
 * 선두 0 단위는 생략하되 항상 초로 끝나 "다이나믹"하게 보이도록. */
function durationPartsFull(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const out = [];
  if (d) out.push({ value: d, unit: 'd' });
  if (d || h) out.push({ value: h, unit: 'h' });
  if (d || h || m) out.push({ value: m, unit: 'm' });
  out.push({ value: sec, unit: 's' });
  return out;
}

/* ─── keyframes — 로딩 스켈레톤 펄스뿐. transform 없는 순수 opacity 애니메이션.
 * prefers-reduced-motion: reduce 에서는 정적 opacity 로 대체. */
const DASHBOARD_KEYFRAMES = `
  @keyframes dc-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
  .dc-skel { animation: dc-pulse 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .dc-skel { animation: none !important; opacity: 0.7; }
  }
`;

/* ─── 스타일 ───────────────────────────────────────────────────────── */
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
  gap: '14px',
};

/* 카드 — HostList/Sidebar 의 row 와 동일한 톤: 평평한 surface0 + 1px 헤어라인 보더 + radius.md.
 * 그림자/글로우/그라디언트 없음 — 앱 전역 카드 관례 그대로. */
const cardStyle = {
  background: color.surface0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  padding: `${space['4']} ${space['5']}`,
  minHeight: '150px',
  boxSizing: 'border-box',
  fontFamily: font.sans,
  display: 'flex',
  flexDirection: 'column',
  gap: space['4'],
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

/* Overview — 총 시간 히어로가 주인공, 그 아래 조용한 서포팅 3칸. */
const overviewBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  flex: 1,
};

/* 히어로 — 카드 중앙에 총 시간을 크게. 캡션(위) → 큰 숫자 → 얇은 진행바 순. */
const heroStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px',
  padding: '8px 0 4px',
};
const heroCaptionStyle = {
  fontSize: fontSize['11'],
  color: color.muted,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
// 히어로 값 컨테이너 — 세그먼트들을 baseline 정렬로 가로 배치.
const heroValueStyle = {
  display: 'inline-flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: '10px',
  fontFamily: font.mono,
  lineHeight: 1,
  textAlign: 'center',
};
const heroSegStyle = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '2px',
};
const heroNumStyle = {
  fontSize: 'clamp(30px, 8vw, 44px)',
  fontWeight: fontWeight.semibold,
  color: color.text,
  letterSpacing: '-0.02em',
};
// 가장 큰 단위의 숫자에만 절제된 accent 포인트 하나.
const heroNumAccentStyle = { ...heroNumStyle, color: color.accent };
const heroUnitStyle = {
  fontSize: 'clamp(13px, 3vw, 15px)',
  fontWeight: fontWeight.medium,
  color: color.muted,
  letterSpacing: '0.01em',
};

const heroBarTrackStyle = {
  width: 'min(200px, 75%)',
  height: '6px',
  background: color.crust,
  border: `1px solid ${color.border}`,
  borderRadius: radius.xs,
  overflow: 'hidden',
};
const heroBarFillStyle = (pct = 0) => ({
  height: '100%',
  width: `${pct}%`,
  borderRadius: radius.xs,
  background: color.accent,
  transition: `width ${motion.normal}`,
});

/* 서포팅 3칸 — 헤어라인 구분선으로만 나뉘는 조용한 셀. */
const statCellsRowStyle = {
  display: 'flex',
  alignItems: 'stretch',
};
const statCellStyle = (divider) => ({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  padding: '2px 8px',
  borderLeft: divider ? `1px solid ${color.border}` : 'none',
  boxSizing: 'border-box',
});
const statValueStyle = {
  fontSize: fontSize['14'],
  fontWeight: fontWeight.semibold,
  fontFamily: font.mono,
  color: color.text,
  letterSpacing: '-0.01em',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};
const statRingValueStyle = {
  fontSize: '10px',
  fontWeight: fontWeight.semibold,
  fontFamily: font.mono,
  color: color.text,
  whiteSpace: 'nowrap',
};
const statLabelStyle = {
  fontSize: fontSize['11'],
  letterSpacing: '0.02em',
  color: color.muted,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  textAlign: 'center',
};

/* Host ranking — 단일 세로 목록. 헤더(아이콘 · 이름 · 값) + 얇은 막대. */
const rankListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const rankRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  minWidth: 0,
};
const rankHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};
// HostList.jsx 의 hostIcon 배지와 동일한 톤 — surface0 배경 + 헤어라인 보더 + radius.xs.
const rankIconStyle = {
  flexShrink: 0,
  width: '18px',
  height: '18px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: color.surface0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.xs,
  boxSizing: 'border-box',
};
const rankNameStyle = {
  flex: 1,
  fontSize: fontSize['12'],
  fontWeight: fontWeight.medium,
  color: color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};
const rankValueStyle = {
  fontSize: '11px',
  fontFamily: font.mono,
  color: color.muted,
  flexShrink: 0,
  whiteSpace: 'nowrap',
};
const rankSkelNameStyle = {
  height: '11px',
  width: '50%',
  borderRadius: radius.xs,
  background: `color-mix(in srgb, ${color.text} 14%, transparent)`,
};
const rankBarTrackStyle = {
  height: '6px',
  width: '100%',
  background: color.crust,
  border: `1px solid ${color.border}`,
  borderRadius: radius.xs,
  overflow: 'hidden',
};
const rankBarFillStyle = {
  height: '100%',
  borderRadius: radius.xs,
  transition: `width ${motion.normal}`,
};

export default DashboardCards;
