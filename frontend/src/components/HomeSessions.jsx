import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Server, Monitor, Terminal as TerminalIcon, Anchor, Loader2,
  ArrowRight, Play, Square, AlertCircle,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * Home 의 Sessions 섹션.
 *
 * 두 종류의 카드를 한 그리드에 보여준다:
 *  - Open: 현재 열려있는 탭 (jump only)
 *  - Resumable: 호스트의 tmux 세션 중, 현재 열려있는 탭에 없는 것 (resume / terminate)
 *
 * 스켈레톤 — 호스트 tmux 조회 진행 중일 때 카드 자리에 깜빡이는 placeholder + 아이콘.
 */
const HomeSessions = ({
  tabs = [],            // [{ id, type, hostId, name, color_index, icon, isPersistent? }]
  hosts = [],
  onJumpTab,            // (tabId) =>
  onResumeHostSession,  // (host, sessionName) => — 호스트에 해당 tmux 세션으로 신규 탭
  onTerminateHostSession, // (host, sessionName) => Promise — kill-tmux
  t,
}) => {
  // host_id → { loading, error, sessions: [{name, created, attached}] }
  const tmuxHosts = useMemo(
    () => hosts.filter((h) => h.use_remote_tmux),
    [hosts],
  );
  const [tmuxByHost, setTmuxByHost] = useState({});

  const fetchHostSessions = useCallback(async (host) => {
    setTmuxByHost((prev) => ({ ...prev, [host.id]: { loading: true } }));
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/hosts/${host.id}/tmux-sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTmuxByHost((prev) => ({
        ...prev,
        [host.id]: { loading: false, sessions: json.sessions || [] },
      }));
    } catch (e) {
      setTmuxByHost((prev) => ({
        ...prev,
        [host.id]: { loading: false, error: e.message || 'fetch failed' },
      }));
    }
  }, []);

  useEffect(() => {
    tmuxHosts.forEach(fetchHostSessions);
  }, [tmuxHosts, fetchHostSessions]);

  // 현재 탭에서 (host, baseSession) 로 점유 중인 세션명 set — 중복 노출 방지
  const occupiedByHost = useMemo(() => {
    const map = new Map(); // host_id → Set<sessionName>
    tabs.forEach((tab) => {
      if (tab.type !== 'host' || !tab.hostId) return;
      const host = hosts.find((h) => h.id === tab.hostId);
      const base = host?.remote_tmux_session || 'mobile';
      // App.jsx 의 close 로직 참고: pane[0]=base, pane[i>0]=base.{i+1}
      const panes = tab.panes || [{}];
      const set = map.get(tab.hostId) || new Set();
      panes.forEach((_, idx) => set.add(idx === 0 ? base : `${base}.${idx + 1}`));
      map.set(tab.hostId, set);
    });
    return map;
  }, [tabs, hosts]);

  const openTabs = tabs;
  const hasAnyResumable = tmuxHosts.some((h) => {
    const entry = tmuxByHost[h.id];
    if (!entry || entry.loading || entry.error) return false;
    const occupied = occupiedByHost.get(h.id) || new Set();
    return entry.sessions.some((s) => !occupied.has(s.name));
  });
  const anyLoading = tmuxHosts.some((h) => tmuxByHost[h.id]?.loading);

  if (openTabs.length === 0 && !hasAnyResumable && !anyLoading) return null;

  return (
    <section style={S.section}>
      <style>{`
        @keyframes home-skel-pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }
        @keyframes home-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={S.head}>
        <span style={S.title}>{t?.('sessions') || 'Sessions'}</span>
        {anyLoading && (
          <span style={S.headHint}>
            <Loader2 size={11} strokeWidth={2.4} style={{ animation: 'home-spin 0.9s linear infinite' }} />
            {t?.('loadingSessions') || 'Scanning hosts…'}
          </span>
        )}
      </div>

      <div style={S.grid}>
        {openTabs.map((tab) => (
          <OpenCard key={`tab-${tab.id}`} tab={tab} onJump={() => onJumpTab?.(tab.id)} t={t} />
        ))}

        {tmuxHosts.map((host) => {
          const entry = tmuxByHost[host.id];
          if (!entry || entry.loading) {
            return <SkeletonCard key={`skel-${host.id}`} host={host} t={t} />;
          }
          if (entry.error) {
            return <ErrorCard key={`err-${host.id}`} host={host} message={entry.error} onRetry={() => fetchHostSessions(host)} t={t} />;
          }
          const occupied = occupiedByHost.get(host.id) || new Set();
          const resumable = entry.sessions.filter((s) => !occupied.has(s.name));
          return resumable.map((s) => (
            <ResumableCard
              key={`tmx-${host.id}-${s.name}`}
              host={host}
              session={s}
              onResume={() => onResumeHostSession?.(host, s.name)}
              onTerminate={async () => {
                await onTerminateHostSession?.(host, s.name);
                fetchHostSessions(host);
              }}
              t={t}
            />
          ));
        })}
      </div>
    </section>
  );
};

// ─── Cards ───────────────────────────────────────────────────────────────

const OpenCard = ({ tab, onJump, t }) => {
  const accent = color.dotPalette[(tab.color_index || 0) % color.dotPalette.length];
  const Icon = tab.type === 'host' ? Server : Monitor;
  return (
    <Card accent={accent} onClick={onJump}>
      <Badge tone="open" t={t} />
      <IconBox accent={accent}>
        <HostIcon value={tab.icon || ''} fallback={Icon} size={18} />
      </IconBox>
      <Body
        name={tab.name || (t?.('untitled') || 'Untitled')}
        sub={tab.type === 'host' ? (t?.('remote') || 'remote') : (t?.('localhost') || 'localhost')}
        rightAdornment={tab.isPersistent
          ? <Anchor size={11} strokeWidth={2} style={{ color: color.muted, opacity: 0.7, marginLeft: 4 }} />
          : null}
      />
      <Actions>
        <CardBtn title={t?.('jumpToTab') || 'Jump'} onClick={onJump} primary>
          <ArrowRight size={13} strokeWidth={2.2} />
        </CardBtn>
      </Actions>
    </Card>
  );
};

const ResumableCard = ({ host, session, onResume, onTerminate, t }) => {
  const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
  return (
    <Card accent={accent} onClick={onResume}>
      <Badge tone="resumable" t={t} />
      <IconBox accent={accent}>
        <HostIcon value={host.icon || ''} fallback={Server} size={18} />
      </IconBox>
      <Body
        name={host.name}
        sub={`${session.name}${session.attached ? ` · ${t?.('attached') || 'attached'}` : ''}`}
        rightAdornment={<Anchor size={11} strokeWidth={2} style={{ color: color.muted, opacity: 0.7, marginLeft: 4 }} />}
      />
      <Actions>
        <CardBtn title={t?.('resume') || 'Resume'} onClick={(e) => { e.stopPropagation(); onResume?.(); }} primary>
          <Play size={13} strokeWidth={2.2} />
        </CardBtn>
        <CardBtn title={t?.('terminate') || 'Terminate'} tone="danger" onClick={(e) => { e.stopPropagation(); onTerminate?.(); }}>
          <Square size={12} strokeWidth={2.2} />
        </CardBtn>
      </Actions>
    </Card>
  );
};

const SkeletonCard = ({ host, t }) => {
  const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
  return (
    <div style={{ ...S.card, ...S.cardSkel, borderColor: color.border, cursor: 'default' }} aria-busy>
      <Badge tone="loading" t={t} />
      <IconBox accent={accent} subdued>
        <HostIcon value={host.icon || ''} fallback={Server} size={18} />
      </IconBox>
      <div style={S.body}>
        <div style={{ ...S.skelLine, width: '60%' }} />
        <div style={{ ...S.skelLine, width: '40%', height: 9 }} />
      </div>
      <Loader2 size={14} strokeWidth={2.2} style={{ color: color.muted, animation: 'home-spin 0.9s linear infinite', flexShrink: 0 }} />
    </div>
  );
};

const ErrorCard = ({ host, message, onRetry, t }) => {
  const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
  return (
    <Card accent={color.danger} onClick={onRetry}>
      <Badge tone="error" t={t} />
      <IconBox accent={color.danger}>
        <AlertCircle size={18} strokeWidth={2} />
      </IconBox>
      <Body
        name={host.name}
        sub={`${t?.('cannotReach') || 'Cannot reach host'} · ${message}`}
      />
      <Actions>
        <CardBtn title={t?.('retry') || 'Retry'} onClick={(e) => { e.stopPropagation(); onRetry?.(); }}>
          <ArrowRight size={13} strokeWidth={2.2} />
        </CardBtn>
      </Actions>
    </Card>
  );
};

// ─── Atoms ───────────────────────────────────────────────────────────────

const Card = ({ children, accent, onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...S.card,
        background: hover ? color.surface1 : color.surface0,
        borderColor: hover ? accent : color.border,
        boxShadow: hover ? `0 4px 14px ${accent}22, 0 0 0 1px ${accent}` : 'none',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {children}
    </div>
  );
};

const Badge = ({ tone, t }) => {
  const palette = {
    open:      { bg: color.accentSubtle, fg: color.accent, label: t?.('badgeOpen') || 'OPEN' },
    resumable: { bg: 'transparent',      fg: color.subtext, label: t?.('badgeResumable') || 'RESUME' },
    loading:   { bg: 'transparent',      fg: color.muted,   label: t?.('badgeLoading') || 'LOADING' },
    error:     { bg: 'transparent',      fg: color.danger,  label: t?.('badgeError') || 'ERROR' },
  }[tone];
  return (
    <span style={{ ...S.badge, background: palette.bg, color: palette.fg, borderColor: palette.fg + '33' }}>
      {tone === 'open' && <TerminalIcon size={9} strokeWidth={2.4} />}
      {tone === 'resumable' && <Anchor size={9} strokeWidth={2.4} />}
      {tone === 'loading' && <Loader2 size={9} strokeWidth={2.4} style={{ animation: 'home-spin 0.9s linear infinite' }} />}
      {tone === 'error' && <AlertCircle size={9} strokeWidth={2.4} />}
      {palette.label}
    </span>
  );
};

const IconBox = ({ children, accent, subdued = false }) => (
  <div
    style={{
      ...S.iconBox,
      color: accent,
      borderColor: subdued ? color.border : accent + '66',
      background: subdued ? color.crust : accent + '1a',
      animation: subdued ? 'home-skel-pulse 1.4s ease-in-out infinite' : 'none',
    }}
  >
    {children}
  </div>
);

const Body = ({ name, sub, rightAdornment }) => (
  <div style={S.body}>
    <div style={S.row}>
      <span style={S.name}>{name}</span>
      {rightAdornment}
    </div>
    <div style={S.sub}>{sub}</div>
  </div>
);

const Actions = ({ children }) => (
  <div style={S.actions} onClick={(e) => e.stopPropagation()}>
    {children}
  </div>
);

const CardBtn = ({ children, onClick, title, primary, tone }) => {
  const [hover, setHover] = useState(false);
  const fg =
    tone === 'danger' ? color.danger
    : primary ? color.accent
    : color.subtext;
  const bg = hover
    ? (tone === 'danger' ? color.danger + '22' : primary ? color.accentSubtle : color.surface2)
    : (primary ? color.accentSubtle : color.surface0);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...S.btn,
        color: fg,
        background: bg,
        borderColor: hover ? fg + '99' : color.border,
      }}
    >
      {children}
    </button>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────

const S = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    width: '100%',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  headHint: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: fontSize['11'],
    color: color.muted,
  },
  grid: {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}, transform ${motion.fast}, box-shadow ${motion.fast}`,
    fontFamily: font.sans,
    minHeight: '60px',
    boxSizing: 'border-box',
    position: 'relative',
  },
  cardSkel: {
    background: color.surface0,
  },
  badge: {
    position: 'absolute',
    top: '6px',
    right: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    height: '15px',
    padding: '0 5px',
    fontSize: '9px',
    fontFamily: font.mono,
    fontWeight: 600,
    letterSpacing: '0.06em',
    border: '1px solid',
    borderRadius: '3px',
  },
  iconBox: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: '1px solid',
    borderRadius: radius.md,
    transition: `background ${motion.fast}, border-color ${motion.fast}`,
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  name: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    fontSize: fontSize['11'],
    color: color.subtext,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: font.mono,
  },
  actions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  btn: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: radius.sm,
    cursor: 'pointer',
    padding: 0,
    transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
  },
  skelLine: {
    height: 11,
    width: '70%',
    borderRadius: 4,
    background: color.surface2,
    marginBottom: 4,
    animation: 'home-skel-pulse 1.4s ease-in-out infinite',
  },
};

export default HomeSessions;
