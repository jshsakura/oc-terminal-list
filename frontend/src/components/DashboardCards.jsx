import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Server, Monitor, BarChart3, Layers, Clock } from 'lucide-react';
import { tokens } from '../styles/tokens';
import { glassPanelStyle, glassSectionStyle } from '../styles/glass';
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
 *  │ 7d 총 시간 카세트 릴 + 3타일 │  카드 C: 원격 vs 로컬 + 평균 세션
 *  └─────────────────────────────┘
 *
 * 비주얼: 글래스모피즘(glass.js) + 헤드라인 총 시간을 스피닝 카세트 릴로 표현.
 * 릴 회전은 순수 CSS @keyframes(transform: rotate) — JS rAF 루프 없음, prefers-reduced-motion 존중.
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
      {/* 릴 회전 + 스켈레톤 펄스 — 카드 두 장이 공유하는 단일 keyframes 블록.
          prefers-reduced-motion: reduce 에서는 릴이 멈추고 스켈레톤도 정적 opacity 로. */}
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
  const accent = color.accent;

  return (
    <CardShell icon={Activity} title={title || (t?.('atAGlance') || 'Overview')} accent={accent}>
      {err ? <ErrorState message={err} /> : (
        <div style={overviewBodyStyle}>
          {/* 헤드라인 — 총 시간을 스피닝 카세트 릴로. 라벨창은 릴 사이, 숫자는 항상 또렷하게. */}
          <CassetteHero
            value={formatDuration(totalSeconds)}
            caption={`${t?.('totalTime') || 'Total'} · ${windowDays}d`}
            accent={accent}
            loading={loading}
          />
          <div style={heroBarTrackStyle}>
            <div style={{ ...heroBarFillStyle(accent), width: `${loading ? 0 : totalPct}%` }} />
          </div>
          {/* 서포팅 3 타일 — 세션 / 활성(비율 링) / 평균. 넉넉한 간격, 모바일서 감싸짐. */}
          <div style={tileRowStyle}>
            <StatTile icon={Layers} value={loading ? '—' : String(sessionCount)} label={t?.('sessions') || 'Sessions'} accent={color.info} />
            <StatTile value={loading ? '—' : `${activeTargets}/${totalKnownTargets}`} label={t?.('activeHosts') || 'Active'} accent={color.success} ring={loading ? 0 : activePct} />
            <StatTile icon={Clock} value={loading ? '—' : formatDuration(avgSeconds)} label={t?.('avgSession') || 'Avg'} accent={color.warning} />
          </div>
        </div>
      )}
    </CardShell>
  );
};

/* ─── 헤드라인: 스피닝 카세트 / 릴투릴 ──────────────────────────────────
 * SVG 로 카세트 본체 + 좌우 릴을 그리고, 릴은 CSS @keyframes(transform: rotate)
 * 로 계속 회전(GPU 합성, rAF 없음). 총 시간 숫자는 릴 사이 "라벨창"에 HTML 오버레이
 * 로 얹어 배율에 상관없이 항상 또렷하게 유지한다.
 */
const CASSETTE_VB_W = 300;
const CASSETTE_VB_H = 130;
const REEL_SPOKE_ANGLES = [0, 60, 120, 180, 240, 300];

const CassetteHero = ({ value, caption, accent, loading }) => (
  <div style={cassetteWrapStyle}>
    <svg
      viewBox={`0 0 ${CASSETTE_VB_W} ${CASSETTE_VB_H}`}
      style={cassetteSvgStyle}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="dcShellGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.06)" />
        </linearGradient>
        <linearGradient id="dcTapeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={accent} stopOpacity="0.7" />
          <stop offset="50%" stopColor={accent} stopOpacity="0.15" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* 카세트 셸 — 유리 질감 그라디언트 채움 + 액센트 헤어라인 */}
      <rect
        x="4" y="4" width={CASSETTE_VB_W - 8} height={CASSETTE_VB_H - 8} rx="18"
        fill="url(#dcShellGrad)"
        stroke={`color-mix(in srgb, ${accent} 32%, transparent)`}
        strokeWidth="1.2"
      />

      {/* 릴 사이를 지나는 테이프 리본 */}
      <path
        d="M96 66 C132 44, 168 44, 204 66 C168 88, 132 88, 96 66 Z"
        fill="none"
        stroke="url(#dcTapeGrad)"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <Reel cx={68} cy={66} r={35} accent={accent} speed="6.4s" />
      <Reel cx={232} cy={66} r={35} accent={accent} speed="5.1s" />

      {/* 나사 구멍 — 레트로 카세트 디테일 */}
      {[[18, 14], [282, 14], [18, 118], [282, 118]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.4} fill="rgba(0,0,0,0.28)" />
      ))}
    </svg>

    {/* 라벨창 — 릴 사이 위에 얹히는 HTML 오버레이. 숫자는 항상 크리스프. */}
    <div style={cassetteLabelStyle(accent)}>
      <span className={loading ? 'dc-skel' : undefined} style={cassetteValueStyle(accent)}>
        {loading ? '—' : value}
      </span>
      <span style={cassetteCaptionStyle}>{caption}</span>
    </div>
  </div>
);

/* 릴 하나 — 허브 + 스포크 + 톱니 링. transform-box: fill-box 로 자기 자신의
 * 바운딩박스 중심을 기준삼아 회전(브라우저 좌표 계산 없이 안전). */
const Reel = ({ cx, cy, r, accent, speed }) => (
  <g
    className="dc-reel"
    style={{
      transformBox: 'fill-box',
      transformOrigin: 'center',
      animation: `dc-reel-spin ${speed} linear infinite`,
      willChange: 'transform',
    }}
  >
    <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.03)" stroke={`color-mix(in srgb, ${accent} 42%, transparent)`} strokeWidth="1.4" />
    <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke={`color-mix(in srgb, ${accent} 20%, transparent)`} strokeWidth="1" strokeDasharray="2 4.5" />
    {REEL_SPOKE_ANGLES.map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return (
        <line
          key={deg}
          x1={cx} y1={cy}
          x2={cx + (r - 9) * Math.cos(rad)}
          y2={cy + (r - 9) * Math.sin(rad)}
          stroke={`color-mix(in srgb, ${accent} 55%, transparent)`}
          strokeWidth="2"
          strokeLinecap="round"
        />
      );
    })}
    <circle cx={cx} cy={cy} r={6.5} fill={accent} opacity="0.9" />
    <circle cx={cx} cy={cy} r={2.4} fill="rgba(0,0,0,0.45)" />
  </g>
);

// 서포팅 타일 — 기본은 아이콘 배지+큰 숫자+라벨. ring 이 주어지면(활성 비율) 작은 링으로 감싼다.
const StatTile = ({ icon: Icon, value, label, accent, ring = null }) => (
  <div style={statTileStyle(accent)}>
    {ring != null ? (
      <RadialGauge size={44} thickness={4} pct={ring} accent={accent}>
        <span style={{ ...statTileRingValueStyle, color: accent }}>{value}</span>
      </RadialGauge>
    ) : (
      <>
        {Icon && (
          <span style={statTileIconStyle(accent)}>
            <Icon size={12} strokeWidth={2.2} />
          </span>
        )}
        <span style={{ ...statTileValueStyle, color: accent }}>{value}</span>
      </>
    )}
    <span style={statTileLabelStyle}>{label}</span>
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
          stroke={`color-mix(in srgb, ${color.text} 12%, transparent)`} strokeWidth={thickness} fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={accent} strokeWidth={thickness} fill="none"
          strokeDasharray={cir}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            transition: 'stroke-dashoffset 320ms cubic-bezier(0.16, 1, 0.3, 1)',
            filter: `drop-shadow(0 0 4px color-mix(in srgb, ${accent} 55%, transparent))`,
          }}
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

/* ─── 카드 B: 호스트별 막대 (top 5) ───────────────────────────────────── */
const HostRankingCard = ({ loading, err, targets, t }) => {
  const top = (targets || []).slice(0, 5);
  const max = top.length ? Math.max(...top.map((x) => x.total_seconds), 1) : 1;
  return (
    <CardShell icon={BarChart3} title={t?.('byHost') || 'By host'} accent={color.accent}>
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
                  <span style={rankIconStyle(tg.accent)}>
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
                      boxShadow: `0 0 8px ${tg.accent}55, 0 0 0 1px ${tg.accent}33`,
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

const RankSkeletonRow = () => (
  <li style={rankRowStyle} aria-hidden="true">
    <div style={rankHeaderStyle}>
      <span style={{ ...rankIconStyle(color.muted), opacity: 0.5 }} />
      <span className="dc-skel" style={rankSkelNameStyle} />
    </div>
    <div style={rankBarTrackStyle} className="dc-skel" />
  </li>
);

/* ─── 공용 카드 셸 — 글래스모피즘 + 그라디언트 헤어라인 링 ─────────────────
 * 바깥 래퍼(1px padding + 그라디언트 배경)가 헤어라인 보더를 흉내내고,
 * 안쪽은 glassPanelStyle(blur + 반투명) 로 유리 표면을 만든다.
 */
const CardShell = ({ icon: Icon, title, children, accent = color.accent }) => (
  <div style={cardOuterStyle(accent)}>
    <div style={cardInnerStyle}>
      <div style={cardSheenStyle} aria-hidden="true" />
      <div style={cardContentStyle}>
        <div style={cardHeadStyle}>
          {Icon && (
            <span style={cardIconBadgeStyle(accent)}>
              <Icon size={12} strokeWidth={2.3} />
            </span>
          )}
          <span style={cardTitleStyle}>{title}</span>
        </div>
        <div style={cardBodyStyle}>{children}</div>
      </div>
    </div>
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

/* ─── keyframes — 릴 회전 + 스켈레톤 펄스. 두 카드가 공유하는 단일 <style> 블록.
 * transform 기반 CSS 애니메이션만 사용(합성 스레드, rAF/레이아웃 스래싱 없음).
 * prefers-reduced-motion: reduce 에서는 릴 정지 + 스켈레톤도 정적 opacity 로 대체. */
const DASHBOARD_KEYFRAMES = `
  @keyframes dc-reel-spin { to { transform: rotate(360deg); } }
  @keyframes dc-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.92; } }
  .dc-skel { animation: dc-pulse 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .dc-reel { animation: none !important; }
    .dc-skel { animation: none !important; opacity: 0.7; }
  }
`;

/* ─── 스타일 (HostRow / Section 톤과 통일) ─────────────────────────── */
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
  gap: '14px',
};

/* 카드 — 바깥은 그라디언트 헤어라인 링 + 앰비언트 글로우, 안쪽은 glass 표면. */
const cardOuterStyle = (accent = color.accent) => ({
  position: 'relative',
  borderRadius: radius.xl,
  padding: '1px',
  background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 60%, transparent) 0%, color-mix(in srgb, ${accent} 4%, transparent) 45%, color-mix(in srgb, ${accent} 4%, transparent) 55%, color-mix(in srgb, ${accent} 45%, transparent) 100%)`,
  boxShadow: `0 20px 46px -22px color-mix(in srgb, ${accent} 50%, transparent), 0 10px 30px rgba(0, 0, 0, 0.30)`,
});
const cardInnerStyle = {
  ...glassPanelStyle({}, { borderRadius: `calc(${radius.xl} - 1px)` }),
  position: 'relative',
  overflow: 'hidden',
  padding: '18px 20px',
  minHeight: '120px',
  boxSizing: 'border-box',
  fontFamily: font.sans,
};
// 상단 유리 하이라이트 — 콘텐츠보다 뒤(zIndex 0)에 깔리는 장식용 그라디언트.
const cardSheenStyle = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 55%)',
  pointerEvents: 'none',
  zIndex: 0,
};
const cardContentStyle = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: space['4'],
  height: '100%',
};
const cardHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};
const cardIconBadgeStyle = (accent = color.accent) => ({
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.sm,
  color: accent,
  background: `color-mix(in srgb, ${accent} 16%, transparent)`,
  border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
  flexShrink: 0,
});
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

/* Overview — 카세트 헤드라인 + 슬림 윈도우 바 + 서포팅 3 타일 */
const overviewBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

/* 카세트 릴 헤드라인 — SVG 는 배경, 숫자/라벨은 HTML 오버레이(항상 크리스프). */
const cassetteWrapStyle = {
  position: 'relative',
  width: '100%',
  aspectRatio: `${CASSETTE_VB_W} / ${CASSETTE_VB_H}`,
  maxHeight: '176px',
};
const cassetteSvgStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
};
const cassetteLabelStyle = (accent) => ({
  position: 'absolute',
  left: '50%',
  top: '52%',
  transform: 'translate(-50%, -50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  padding: '5px 12px',
  borderRadius: radius.md,
  background: `color-mix(in srgb, ${color.base} 62%, transparent)`,
  border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`,
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
  pointerEvents: 'none',
  maxWidth: '72%',
  boxSizing: 'border-box',
});
const cassetteValueStyle = (accent) => ({
  fontSize: 'clamp(20px, 6.4vw, 30px)',
  fontWeight: fontWeight.bold,
  fontFamily: font.mono,
  color: color.text,
  letterSpacing: '-0.02em',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  textShadow: `0 0 18px color-mix(in srgb, ${accent} 45%, transparent)`,
});
const cassetteCaptionStyle = {
  fontSize: '10px',
  fontWeight: fontWeight.medium,
  color: color.muted,
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
};

const heroBarTrackStyle = {
  height: '6px',
  width: '100%',
  background: `color-mix(in srgb, ${color.crust} 65%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color.border} 80%, transparent)`,
  borderRadius: radius.full,
  overflow: 'hidden',
};
const heroBarFillStyle = (accent = color.accent) => ({
  height: '100%',
  borderRadius: radius.full,
  background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 55%, transparent), ${accent})`,
  boxShadow: `0 0 10px color-mix(in srgb, ${accent} 50%, transparent)`,
  transition: 'width 340ms cubic-bezier(0.16, 1, 0.3, 1)',
});

/* 타일 행 — 좁아지면 자동으로 감싸져 모바일서 답답하지 않게 */
const tileRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
  gap: '10px',
};
const statTileStyle = (accent = color.accent) => ({
  ...glassSectionStyle({}, { borderRadius: radius.lg }),
  border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '6px',
  padding: '10px 6px',
  minWidth: 0,
  boxSizing: 'border-box',
});
const statTileIconStyle = (accent = color.accent) => ({
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.sm,
  color: accent,
  background: `color-mix(in srgb, ${accent} 16%, transparent)`,
});
const statTileValueStyle = {
  fontSize: 'clamp(15px, 4.5vw, 19px)',
  fontWeight: fontWeight.bold,
  fontFamily: font.mono,
  letterSpacing: '-0.01em',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};
const statTileRingValueStyle = {
  fontSize: '12px',
  fontWeight: fontWeight.bold,
  fontFamily: font.mono,
  letterSpacing: '-0.02em',
  whiteSpace: 'nowrap',
};
const statTileLabelStyle = {
  fontSize: fontSize['11'],
  letterSpacing: '0.03em',
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '12px 16px',
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
  gridTemplateColumns: '20px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};
const rankIconStyle = (accent) => ({
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${accent}33`,
  borderRadius: radius.sm,
  background: `${accent}14`,
  color: accent,
  flexShrink: 0,
  boxSizing: 'border-box',
});
const rankNameStyle = {
  fontSize: fontSize['12'],
  fontWeight: fontWeight.medium,
  color: color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};
const rankSkelNameStyle = {
  height: '11px',
  width: '70%',
  borderRadius: radius.xs,
  background: `color-mix(in srgb, ${color.text} 14%, transparent)`,
};
const rankBarTrackStyle = {
  position: 'relative',
  height: '14px',
  width: '100%',
  background: `color-mix(in srgb, ${color.crust} 65%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color.border} 80%, transparent)`,
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
