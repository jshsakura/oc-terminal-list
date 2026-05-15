import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Server, Monitor, Anchor, Loader2,
  ArrowRight, Trash2, AlertCircle, X,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// Module-level set — persists across component unmount/remount (e.g., tab switches).
// Resets only on full page reload, which is the right UX for error dismissal.
const dismissedHostIds = new Set();

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
  hideOpen = false,     // Open 카드 숨김 (EmptyPane 처럼 점프가 의미 없는 컨텍스트용)
  hideHeader = false,   // 섹션 헤더 숨김 (외부에서 자체 헤더 다는 경우)
  onJumpTab,            // (tabId) =>
  onResumeHostSession,  // (host, sessionName) => — 호스트에 해당 tmux 세션으로 신규 탭
  onTerminateHostSession, // (host, sessionName) => Promise — kill-tmux. throw 가능.
  onConfirm,            // ({title, message, onConfirm, danger?}) => 표준 ConfirmModal 호출
  onNotify,             // (message) => 표준 NotificationModal 호출 (에러 알림)
  refreshSignal = 0,    // nonce — 변경 시 tmux 호스트 재조회
  t,
}) => {
  // host_id → { loading, error, sessions: [{name, created, attached}] }
  const tmuxHosts = useMemo(
    () => hosts.filter((h) => h.use_remote_tmux),
    [hosts],
  );
  const [tmuxByHost, setTmuxByHost] = useState({});

  const fetchHostSessions = useCallback(async (host) => {
    if (dismissedHostIds.has(host.id)) return;
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

  // Depend on host IDs string — not the array reference — so polling-driven host updates
  // don't re-trigger fetches when the actual set of tmux hosts hasn't changed.
  const tmuxHostIds = useMemo(
    () => tmuxHosts.map((h) => h.id).join(','),
    [tmuxHosts],
  );
  useEffect(() => {
    tmuxHosts.forEach(fetchHostSessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmuxHostIds, fetchHostSessions]);

  // 외부 nonce 변화(세션 닫기/열기 등) 시 즉시 재조회
  useEffect(() => {
    if (refreshSignal > 0) {
      tmuxHosts.forEach(fetchHostSessions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // 현재 탭이 점유 중인 *워크스페이스 prefix* set (host_id → Set<prefix>).
  // 한 호스트 탭 = 한 suffix = 한 워크스페이스. pane 0 = `${base}-${suffix}`, pane>0 = `${base}-${suffix}_N`.
  // 사용자가 메인 pane 만 열고 분할은 안 한 상태여도 그 suffix 의 `_N` 잔류는 같은 가족이므로
  // Resumable 에서 함께 가린다. 분명히 다른 suffix 의 `_N` 잔류는 정상적으로 노출 (다른 워크스페이스).
  // Resume 으로 attach 한 탭은 pane.tmuxSessionName 자체를 prefix 로 (그 이름 + `_N` 컴패니언).
  const claimedPrefixesByHost = useMemo(() => {
    const map = new Map();
    tabs.forEach((tab) => {
      if (tab.type !== 'host' || !tab.hostId) return;
      const host = hosts.find((h) => h.id === tab.hostId);
      if (!host) return;
      const baseFromHost = host.remote_tmux_session || 'mobile';
      const set = map.get(tab.hostId) || new Set();
      // suffix 있는 탭 — 그 suffix 의 모든 컴패니언을 점유.
      if (tab.tmuxSuffix) {
        set.add(`${baseFromHost}-${tab.tmuxSuffix}`);
      } else {
        // suffix 없는 탭 (오래된 데이터 호환) — base 자체를 점유.
        set.add(baseFromHost);
      }
      // Resume 탭 — pane.tmuxSessionName 이 명시적으로 박혀있음.
      (tab.panes || []).forEach((pane) => {
        if (pane?.tmuxSessionName) set.add(pane.tmuxSessionName);
      });
      map.set(tab.hostId, set);
    });
    return map;
  }, [tabs, hosts]);

  // session 이 해당 host 의 어떤 prefix 의 *그 자신* 또는 컴패니언(`{prefix}_N`) 인지 판정.
  const isClaimedSession = (hostId, sessionName) => {
    const prefixes = claimedPrefixesByHost.get(hostId);
    if (!prefixes) return false;
    for (const p of prefixes) {
      if (sessionName === p) return true;
      if (sessionName.startsWith(`${p}_`)) return true;
    }
    return false;
  };

  /* `name_N` 형태(예: `mobile-zdbfmjs_2`) 는 *pane 컴패니언* 세션 — 사용자 관점에선 별개 워크스페이스가
     아니라 한 탭의 내부 pane. Resume 으로 돌아갈 단위는 base (`mobile-zdbfmjs`) 뿐이므로 컴패니언은
     Resumable 목록에서 항상 숨김. (어차피 base 를 resume 하거나 base 를 kill 할 때 같이 처리.) */
  const isCompanionSession = (name) => /_[1-9][0-9]*$/.test(name || '');

  const openTabs = hideOpen ? [] : tabs;
  const hasAnyResumable = tmuxHosts.some((h) => {
    const entry = tmuxByHost[h.id];
    if (!entry || entry.loading || entry.error || entry.dismissed) return false;
    return entry.sessions.some((s) => !isCompanionSession(s.name) && !isClaimedSession(h.id, s.name));
  });
  const anyLoading = tmuxHosts.some((h) => {
    const entry = tmuxByHost[h.id];
    return !entry?.dismissed && !!entry?.loading;
  });
  // tmux 호스트가 있고, 로딩/dismiss 아닌 항목이 하나라도 있으면 빈 상태 카드 노출 대상.
  const showEmptyResumable = !hasAnyResumable && !anyLoading && tmuxHosts.length > 0
    && tmuxHosts.some((h) => !tmuxByHost[h.id]?.dismissed);

  if (openTabs.length === 0 && !hasAnyResumable && !anyLoading && !showEmptyResumable) return null;

  return (
    <section style={S.section}>
      <style>{`
        @keyframes home-skel-pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }
        @keyframes home-spin { to { transform: rotate(360deg); } }
        /* busy 인디케이터 — 우상단 작은 dot 만 부드럽게 깜빡. 카드/IconBox 자체는 정적. */
        @keyframes home-busy-blink { 0%,100%{opacity:.5} 50%{opacity:1} }
        .home-iconbox-busy-dot { animation: home-busy-blink 1.1s ease-in-out infinite; }
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

      {/* Resumable 그룹 — 호스트의 영속 tmux 세션 (열려있지 않은 것). 비어 있어도 빈 카드로 자리 채움. */}
      {(hasAnyResumable || anyLoading || showEmptyResumable) && (
        <>
          {!hideHeader && (
            <div style={S.head}>
              <span style={S.title}>{t?.('resumableSessions') || 'Resumable'}</span>
              {anyLoading && (
                <span style={S.headHint}>
                  <Loader2 size={11} strokeWidth={2.4} style={{ animation: 'home-spin 0.9s linear infinite' }} />
                  {t?.('loadingSessions') || 'Scanning hosts…'}
                </span>
              )}
            </div>
          )}
          {!anyLoading && (
          <div style={S.grid}>
            {showEmptyResumable && (
              <EmptyResumableCard t={t} />
            )}
            {!showEmptyResumable && tmuxHosts.map((host) => {
              const entry = tmuxByHost[host.id];
              if (entry?.dismissed) return null;
              if (entry?.loading) return null; // shouldn't happen — anyLoading guards this
              if (entry.error) {
                return <ErrorCard
                  key={`err-${host.id}`}
                  host={host}
                  message={entry.error}
                  onRetry={() => fetchHostSessions(host)}
                  onDismiss={() => {
                    dismissedHostIds.add(host.id);
                    setTmuxByHost((prev) => ({ ...prev, [host.id]: { dismissed: true } }));
                  }}
                  t={t}
                />;
              }
              const resumable = entry.sessions.filter(
                (s) => !isCompanionSession(s.name) && !isClaimedSession(host.id, s.name),
              );
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
          )}
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

// 빈 상태 카드 — 이어할 수 있는 세션이 하나도 없을 때 자리를 채워서 허전함 방지.
const EmptyResumableCard = ({ t }) => (
  <div
    style={{
      ...S.card,
      cursor: 'default',
      background: color.surface0,
      borderStyle: 'dashed',
      borderColor: color.border,
      justifyContent: 'center',
      color: color.muted,
      fontSize: fontSize['12'],
      fontWeight: fontWeight.medium,
      textAlign: 'center',
    }}
  >
    <Anchor size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
    <span>{t?.('noResumableSessions') || 'No resumable sessions'}</span>
  </div>
);

const ErrorCard = ({ host, message, onRetry, onDismiss, t }) => (
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
      {onDismiss && (
        <CardBtn title={t?.('dismiss') || 'Dismiss'} onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
          <X size={13} strokeWidth={2.2} />
        </CardBtn>
      )}
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
      borderColor: subdued ? color.border : accent + '66',
      background: subdued ? color.crust : accent + '1a',
      animation: subdued ? 'home-skel-pulse 1.4s ease-in-out infinite' : undefined,
    }}
  >
    {children}
    {busy && (
      <span
        className="home-iconbox-busy-dot"
        aria-hidden
        style={{
          position: 'absolute',
          top: '-3px',
          right: '-3px',
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 0 2px ${color.crust}`,
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
    // Connections 섹션과 동일한 컬럼 폭 — 같은 화면에서 위 섹션 3개, 아래 섹션 2개 같은 어긋남 방지.
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',         // HostRow 와 동일 — 빈 pane 안에서 카드 시각 정렬.
    padding: '10px 12px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}, transform ${motion.fast}, box-shadow ${motion.fast}`,
    fontFamily: font.sans,
    minHeight: '68px',
    boxSizing: 'border-box',
    position: 'relative',
  },
  cardSkel: {
    background: color.surface0,
  },
  iconBox: {
    width: '40px',       // HostRow 와 동일 — 빈 pane 의 호스트 카드와 같은 크기.
    height: '40px',
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
