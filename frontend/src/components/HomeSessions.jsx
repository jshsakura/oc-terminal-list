import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Server, Monitor, Anchor, Loader2,
  ArrowRight, Trash2, AlertCircle,
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
  busyTabIds = null,    // Set<tabId> — 활동 중인 탭 (TabBar 와 동일 신호)
  onJumpTab,            // (tabId) =>
  onResumeHostSession,  // (host, sessionName) => — 호스트에 해당 tmux 세션으로 신규 탭
  onTerminateHostSession, // (host, sessionName) => Promise — kill-tmux. throw 가능.
  onConfirm,            // ({title, message, onConfirm, danger?}) => 표준 ConfirmModal 호출
  onNotify,             // (message) => 표준 NotificationModal 호출 (에러 알림)
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

  // 현재 탭에서 점유 중인 tmux 세션명 set (host_id → Set<name>) — Resumable 에서 dedup.
  // 점유 규칙 (host_manager.effective_tmux_session 과 동기):
  //   - pane.tmuxSessionName 있으면 (Resume 된 탭) 그 이름 그대로
  //   - 없으면 base = host.remote_tmux_session (default 'mobile')
  //     · tab.tmuxSuffix 있으면 base = `${base}-${suffix}`
  //     · pane 0 → base, pane i>0 → `${base}_${i+1}` (`.` 은 tmux 가 pane spec 으로 오해)
  const occupiedByHost = useMemo(() => {
    const map = new Map();
    tabs.forEach((tab) => {
      if (tab.type !== 'host' || !tab.hostId) return;
      const host = hosts.find((h) => h.id === tab.hostId);
      const baseFromHost = host?.remote_tmux_session || 'mobile';
      const set = map.get(tab.hostId) || new Set();
      (tab.panes || [{}]).forEach((pane, idx) => {
        if (pane && pane.tmuxSessionName) {
          set.add(pane.tmuxSessionName);
          return;
        }
        const base = tab.tmuxSuffix ? `${baseFromHost}-${tab.tmuxSuffix}` : baseFromHost;
        set.add(idx === 0 ? base : `${base}_${idx + 1}`);
      });
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
        /* busy 인디케이터 — Jupyter 식 binary (ON/OFF). 깜빡임 없음.
           작업 중일 동안 dot 정적으로 켜짐, 끝나면 사라짐 → "끝났는지" 가 즉각 보임. */
      `}</style>

      {/* Open 그룹 — 현재 열려있는 탭 */}
      {openTabs.length > 0 && (
        <>
          <div style={S.head}>
            <span style={S.title}>{t?.('openSessions') || 'Open'}</span>
          </div>
          <div style={S.grid}>
            {openTabs.map((tab, idx) => (
              <OpenCard
                key={`tab-${tab.id}`}
                tab={tab}
                index={idx + 1}
                isBusy={!!busyTabIds && busyTabIds.has(tab.id)}
                onJump={() => onJumpTab?.(tab.id)}
                t={t}
              />
            ))}
          </div>
        </>
      )}

      {/* Resumable 그룹 — 호스트의 영속 tmux 세션 (열려있지 않은 것) */}
      {(hasAnyResumable || anyLoading) && (
        <>
          <div style={S.head}>
            <span style={S.title}>{t?.('resumableSessions') || 'Resumable'}</span>
            {anyLoading && (
              <span style={S.headHint}>
                <Loader2 size={11} strokeWidth={2.4} style={{ animation: 'home-spin 0.9s linear infinite' }} />
                {t?.('loadingSessions') || 'Scanning hosts…'}
              </span>
            )}
          </div>
          <div style={S.grid}>
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
                  onResume={() => {
                    console.info('[HomeSessions] resume', { hostId: host.id, hostName: host.name, sessionName: s.name });
                    onResumeHostSession?.(host, s.name);
                  }}
                  onTerminate={() => {
                    const msg = (t?.('confirmTerminateSession') || 'Terminate "{name}" on {host}? Work in this tmux session will be lost.')
                      .replace('{name}', s.name)
                      .replace('{host}', host.name);
                    const doKill = async () => {
                      // 1) 즉시 로컬 state 에서 제거 (optimistic) — 다음 fetch 까지 카드 사라짐
                      setTmuxByHost((prev) => {
                        const cur = prev[host.id];
                        if (!cur || !cur.sessions) return prev;
                        return {
                          ...prev,
                          [host.id]: { ...cur, sessions: cur.sessions.filter((x) => x.name !== s.name) },
                        };
                      });
                      // 2) 실제 kill 호출
                      try {
                        await onTerminateHostSession?.(host, s.name);
                      } catch (err) {
                        onNotify?.((t?.('terminateFailed') || 'Failed to terminate session: {err}')
                          .replace('{err}', err?.message || String(err)));
                      }
                      // 3) 서버 진실 재확인 — 실패해서 살아있으면 카드가 다시 노출됨
                      fetchHostSessions(host);
                    };
                    if (onConfirm) {
                      onConfirm({
                        title: t?.('terminate') || 'Terminate session',
                        message: msg,
                        onConfirm: doKill,
                        danger: true,
                      });
                    } else {
                      // 폴백 — onConfirm 미공급 시
                      if (window.confirm(msg)) doKill();
                    }
                  }}
                  t={t}
                />
              ));
            })}
          </div>
        </>
      )}
    </section>
  );
};

// ─── Cards ───────────────────────────────────────────────────────────────

const OpenCard = ({ tab, index, isBusy = false, onJump, t }) => {
  const accent = color.dotPalette[(tab.color_index || 0) % color.dotPalette.length];
  const Icon = tab.type === 'host' ? Server : Monitor;
  return (
    <Card accent={accent} onClick={onJump}>
      {/* Ctrl+N 번호 — 박스 없는 모노 숫자. TabBar 와 같은 톤. 1~9 만, 그 이상은 숨김. */}
      {index != null && index <= 9 && (
        <span
          aria-hidden
          title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
          style={{
            fontFamily: font.mono,
            fontSize: '11px',
            fontWeight: 600,
            color: color.muted,
            opacity: 0.85,
            flexShrink: 0,
            lineHeight: 1,
            width: '12px',
            textAlign: 'center',
          }}
        >
          {index}
        </span>
      )}
      <IconBox accent={accent} busy={isBusy}>
        <HostIcon value={tab.icon || ''} fallback={Icon} size={18} />
      </IconBox>
      <Body
        name={tab.name || (t?.('untitled') || 'Untitled')}
        sub={tab.type === 'host' ? (t?.('remote') || 'remote') : (t?.('localhost') || 'localhost')}
        rightAdornment={tab.isPersistent
          ? <Anchor size={11} strokeWidth={2} style={{ color: color.muted, opacity: 0.7, marginLeft: 4 }} />
          : null}
      />
      <ArrowRight size={14} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
    </Card>
  );
};

const ResumableCard = ({ host, session, onResume, onTerminate, t }) => {
  const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
  const handleTerminate = (e) => {
    e.stopPropagation();
    onTerminate?.();
  };
  return (
    <Card accent={accent} onClick={onResume}>
      <IconBox accent={accent}>
        <HostIcon value={host.icon || ''} fallback={Server} size={18} />
      </IconBox>
      <Body
        name={host.name}
        sub={`${session.name}${session.attached ? ` · ${t?.('attached') || 'attached'}` : ''}`}
      />
      {/* 카드 클릭 = 이어시작. 우측에 명시적 "완전 삭제" 버튼만 (파괴적 액션은 별도 클릭 필요). */}
      <Actions>
        <CardBtn
          title={t?.('terminate') || 'Delete (kill session)'}
          tone="danger"
          onClick={handleTerminate}
        >
          <Trash2 size={13} strokeWidth={2} />
        </CardBtn>
      </Actions>
    </Card>
  );
};

const SkeletonCard = ({ host }) => {
  const accent = color.dotPalette[(host.color_index || 0) % color.dotPalette.length];
  return (
    <div style={{ ...S.card, ...S.cardSkel, borderColor: color.border, cursor: 'default' }} aria-busy>
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

const ErrorCard = ({ host, message, onRetry, t }) => (
  <Card accent={color.danger} onClick={onRetry}>
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

const IconBox = ({ children, accent, subdued = false, busy = false }) => (
  <div
    style={{
      ...S.iconBox,
      position: 'relative',
      color: accent,
      borderColor: subdued ? color.border : (busy ? accent : accent + '66'),
      background: subdued ? color.crust : (busy ? accent + '33' : accent + '1a'),
      boxShadow: busy ? `0 0 12px ${accent}aa, 0 0 0 1px ${accent}88` : undefined,
      animation: subdued ? 'home-skel-pulse 1.4s ease-in-out infinite' : undefined,
    }}
  >
    {children}
    {busy && (
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '-3px',
          right: '-3px',
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 8px ${accent}, 0 0 0 2px ${color.crust}`,
          pointerEvents: 'none',
        }}
      />
    )}
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
    marginTop: space['2'],
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
