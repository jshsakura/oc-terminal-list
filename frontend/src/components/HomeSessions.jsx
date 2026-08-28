import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Server, Monitor, Anchor, Loader2,
  ArrowRight, Trash2, AlertCircle, X,
  Layers, History,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import { authHeaders } from '../utils/auth';
import SkeletonRow from './common/SkeletonRow';
import useDeadSessions from '../hooks/useDeadSessions';

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
  onJumpTab,            // (tabId) =>
  onResumeHostSession,  // (host, sessionName) => — 호스트에 해당 tmux 세션으로 신규 탭
  onTerminateHostSession, // (host, sessionName) => Promise — kill-tmux. throw 가능.
  onConfirm,            // ({title, message, onConfirm, danger?}) => 표준 ConfirmModal 호출
  onNotify,             // (message) => 표준 NotificationModal 호출 (에러 알림)
  refreshSignal = 0,    // nonce — 변경 시 tmux 호스트 재조회
  isVisible = true,     // 홈 탭이 실제 보일 때만 SSH 조회 — 백그라운드 마운트 상태에선 스킵.
  t,
}) => {
  // host_id → { loading, error, sessions: [{name, created, attached}] }
  const tmuxHosts = useMemo(
    () => hosts.filter((h) => h.use_remote_tmux),
    [hosts],
  );
  const [tmuxByHost, setTmuxByHost] = useState({});
  // Rows left behind by closed tabs. Shown only when there are some — an always-visible
  // "0 to clean" line is chrome, not information.
  const dead = useDeadSessions(isVisible);

  const fetchHostSessions = useCallback(async (host) => {
    // 단건 재조회 — kill 후 즉시 reflect 등 특정 호스트만 다시 가져올 때 사용.
    if (dismissedHostIds.has(host.id)) return;
    setTmuxByHost((prev) => ({ ...prev, [host.id]: { loading: true } }));
    try {
      const res = await fetch(`/api/hosts/${host.id}/tmux-sessions`, {
        headers: authHeaders(),
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

  // 배치 조회 — N개 호스트를 1회 요청으로. 첫 로드 / refreshSignal 변화 시 사용.
  // 백엔드에서 asyncio.gather 로 병렬 SSH, 한 호스트 실패가 다른 호스트 결과를 막지 않음.
  const fetchAllHostSessions = useCallback(async (hosts) => {
    const candidates = hosts.filter((h) => !dismissedHostIds.has(h.id));
    if (candidates.length === 0) return;
    setTmuxByHost((prev) => {
      const next = { ...prev };
      candidates.forEach((h) => { next[h.id] = { loading: true }; });
      return next;
    });
    try {
      const ids = candidates.map((h) => h.id).join(',');
      const res = await fetch(`/api/hosts/tmux-sessions/batch?ids=${encodeURIComponent(ids)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const byId = new Map((json.items || []).map((x) => [x.id, x]));
      setTmuxByHost((prev) => {
        const next = { ...prev };
        candidates.forEach((h) => {
          const item = byId.get(h.id);
          if (!item) {
            next[h.id] = { loading: false, error: 'no result' };
          } else if (item.error) {
            next[h.id] = { loading: false, error: item.error };
          } else {
            next[h.id] = { loading: false, sessions: item.sessions || [] };
          }
        });
        return next;
      });
    } catch (e) {
      // 전체 실패 — 각 호스트에 같은 에러 표시. 단일 fallback 으로 재시도 가능.
      setTmuxByHost((prev) => {
        const next = { ...prev };
        candidates.forEach((h) => {
          next[h.id] = { loading: false, error: e.message || 'fetch failed' };
        });
        return next;
      });
    }
  }, []);

  // Depend on host IDs string — not the array reference — so polling-driven host updates
  // don't re-trigger fetches when the actual set of tmux hosts hasn't changed.
  const tmuxHostIds = useMemo(
    () => tmuxHosts.map((h) => h.id).join(','),
    [tmuxHosts],
  );
  useEffect(() => {
    if (!isVisible) return;
    fetchAllHostSessions(tmuxHosts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmuxHostIds, fetchAllHostSessions, isVisible]);

  // 외부 nonce 변화(세션 닫기/열기 등) 시 즉시 재조회 — 홈이 보일 때만.
  useEffect(() => {
    if (!isVisible) return;
    if (refreshSignal > 0) {
      fetchAllHostSessions(tmuxHosts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, isVisible]);

  // 현재 탭이 점유 중인 *워크스페이스 prefix* set (host_id → Set<prefix>).
  // 한 호스트 탭 = 한 suffix = 한 워크스페이스. pane 0 = `${base}-${suffix}`, pane>0 = `${base}-${suffix}_N`.
  // 사용자가 메인 pane 만 열고 분할은 안 한 상태여도 그 suffix 의 `_N` 잔류는 같은 가족이므로
  // Resumable 에서 함께 가린다. 분명히 다른 suffix 의 `_N` 잔류는 정상적으로 노출 (다른 워크스페이스).
  // Resume 으로 attach 한 탭은 pane.tmuxSessionName 자체를 prefix 로 (그 이름 + `_N` 컴패니언).
  const claimedPrefixesByHost = useMemo(() => {
    const map = new Map();
    const claim = (hostId, value) => {
      if (!hostId || !value) return;
      const set = map.get(hostId) || new Set();
      set.add(value);
      map.set(hostId, set);
    };
    tabs.forEach((tab) => {
      // 탭 단위 suffix 는 **host 탭에만** 있는 개념이다(그 탭 = 한 워크스페이스).
      if (tab.type === 'host' && tab.hostId) {
        const host = hosts.find((h) => h.id === tab.hostId);
        if (host) {
          const base = host.remote_tmux_session || 'mobile';
          // suffix 없는 옛 데이터는 base 자체를 점유.
          claim(tab.hostId, tab.tmuxSuffix ? `${base}-${tab.tmuxSuffix}` : base);
        }
      }
      /* ⚠️ **pane 은 자기 hostId 를 갖는다.** 예전엔 이 루프 전체가
         `if (tab.type !== 'host') return;` 뒤에 있어서, **로컬 탭 안의 원격 pane 이
         통째로 빠졌다.** 실측 사고가 정확히 그것이다 — 로컬 탭 `Proxmox 이관` 의
         3번 pane 이 rpi5 세션(`mobile-6c3ea63b03c1`)인데 아무도 점유로 세지 않아,
         쓰고 있는 그 세션이 "이어할 수 있는 세션" 에 떴고 종료하니 같이 죽었다.

         이 저장소가 같은 자리에서 여러 번 밟았다(탭 색이 안 바뀌던 것, 분할탭이
         풀리던 것) — **탭 단위로 판정하면 섞인 탭에서 반드시 틀린다.** */
      (tab.panes || []).forEach((pane) => {
        claim(pane?.hostId || tab.hostId, pane?.tmuxSessionName);
      });
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

  /* ⚠️ **붙어 있는 세션은 여기 오면 안 된다.** 그건 "이어할 수 있는" 게 아니라 지금 쓰는
     중이다. 그런데도 내밀면 사용자는 그걸 지우려 하고, 지워지지 않는다 — 붙어 있는 쪽이
     끊긴 것을 보고 곧바로 다시 만들기 때문이다(재접속이 `create=1` 이다). 화면에서는
     "지워도 새로고침하면 다시 뜬다" 로 보인다.

     열린 탭이 가진 것은 `isClaimedSession` 이 걸러 주지만, 그 판정은 **이 브라우저의 탭**만
     본다. 다른 기기에서 열려 있거나 백엔드가 아직 붙잡고 있는 것은 거기 안 걸리고,
     tmux 의 attached 플래그만이 그걸 안다. */

  /* 못 닿은 호스트들 — 카드가 아니라 아래 한 줄로 접힌다. */
  const unreachableHosts = tmuxHosts.filter((h) => {
    const entry = tmuxByHost[h.id];
    return entry && !entry.loading && !entry.dismissed && !!entry.error;
  });
  const retryUnreachable = () => unreachableHosts.forEach((h) => fetchHostSessions(h));

  const openTabs = hideOpen ? [] : tabs;
  const hasAnyResumable = tmuxHosts.some((h) => {
    const entry = tmuxByHost[h.id];
    if (!entry || entry.loading || entry.error || entry.dismissed) return false;
    return entry.sessions.some(
      (s) => !isCompanionSession(s.name) && !isClaimedSession(h.id, s.name) && !s.attached,
    );
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

      {/* 정리할 수 있는 기록 — 닫힌 탭이 남긴 세션 행. 있을 때만 나온다. */}
      {dead.count > 0 && (
        <button
          type="button"
          disabled={dead.pruning}
          onClick={() => onConfirm?.({
            title: t?.('pruneSessionsTitle') || '오래된 세션 기록 정리',
            message: (t?.('pruneSessionsMessage')
              || '이미 종료된 tmux 세션의 기록 {n}개를 지웁니다. 실행 중인 세션과 터미널에는 영향이 없습니다.')
              .replace('{n}', dead.count),
            onConfirm: async () => {
              try {
                const removed = await dead.prune();
                onNotify?.((t?.('pruneSessionsDone') || '세션 기록 {n}개를 정리했습니다.')
                  .replace('{n}', removed));
              } catch (err) {
                onNotify?.(err?.message || String(err));
              }
            },
          })}
          style={S.pruneRow}
        >
          <Trash2 size={11} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />
          <span>
            {(t?.('pruneSessionsHint') || '종료된 세션 기록 {n}개 · 정리').replace('{n}', dead.count)}
          </span>
        </button>
      )}

      {/* Open 그룹 — 현재 열려있는 탭 */}
      {openTabs.length > 0 && (
        <div style={S.group}>
          <div style={S.head}>
            <Layers size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />
            <span style={S.title}>{t?.('openSessions') || 'Running'}</span>
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
        </div>
      )}

      {/* Resumable 그룹 — 호스트의 영속 tmux 세션 (열려있지 않은 것). 비어 있어도 빈 카드로 자리 채움. */}
      {(hasAnyResumable || anyLoading || showEmptyResumable) && (
        <div style={S.group}>
          <div style={S.head}>
            <History size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />
            <span style={S.title}>{t?.('resumableSessions') || 'Resumable'}</span>
            {anyLoading && (
              <span style={S.headHint}>
                <Loader2 size={11} strokeWidth={2.4} style={{ animation: 'home-spin 0.9s linear infinite' }} />
                {t?.('loadingSessions') || 'Scanning hosts…'}
              </span>
            )}
          </div>
          <div style={S.grid}>
            {anyLoading && (
              <LoadingResumableCard />
            )}
            {!anyLoading && showEmptyResumable && (
              <EmptyResumableCard t={t} />
            )}
            {!anyLoading && !showEmptyResumable && tmuxHosts.map((host) => {
              const entry = tmuxByHost[host.id];
              if (entry?.dismissed) return null;
              if (entry?.loading) return null;
              /* ⚠️ **못 닿은 호스트는 여기서 카드가 되지 않는다.** 이 구획은 "이어할 수
                 있는 세션" 이고, 닿지 못한 호스트에는 이어할 세션이 **하나도 없다** —
                 우리가 모를 뿐이다. 그걸 세션과 같은 크기의 카드로 내밀면, 꺼진 기계
                 하나가 홈에 들어올 때마다 자리를 차지하며 다시 나타난다(실측: 꺼진
                 rpi4 가 그랬다. X 로 닫아도 그 기억이 모듈 변수라 새로고침이면 잊는다).

                 그렇다고 숨기지도 않는다 — 아래 한 줄로 접는다. 무엇을 못 봤는지는
                 말하되, 세션인 척하지는 않는다. */
              if (entry.error) return null;
              const resumable = entry.sessions.filter(
                (s) => !isCompanionSession(s.name)
                  && !isClaimedSession(host.id, s.name)
                  && !s.attached,
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
                        /* 409 = 쓰는 중이라 거절됐다. 서버 문구가 이미 완성된 문장이고
                           고장이 아니므로 "종료 실패:" 로 감싸지 않는다. 카드는 바로
                           아래 재조회가 치운다 — 붙어 있는 것은 애초에 이 목록에 올
                           것이 아니었다. */
                        onNotify?.(err?.status === 409
                          ? err.message
                          : (t?.('terminateFailed') || 'Failed to terminate session: {err}')
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
          {/* 못 본 호스트가 있으면 **한 줄**로 말한다. 카드가 아니라 줄인 이유는 위 참조 —
              세션 목록에 세션 아닌 것이 끼면 그때부터 이 구획은 세션 목록이 아니게 된다. */}
          {!anyLoading && unreachableHosts.length > 0 && (
            <button type="button" style={S.unreachable} onClick={retryUnreachable}>
              <AlertCircle size={11} strokeWidth={2.2} style={{ flexShrink: 0 }} />
              {(t?.('hostsUnreachable') || '{names} 은(는) 확인하지 못했습니다 — 눌러서 다시 시도')
                .replace('{names}', unreachableHosts.map((h) => h.name).join(', '))}
            </button>
          )}
        </div>
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
      {/* 순번 — 1~9 는 Ctrl+N 단축키와 동일, 그 이상은 단축키 없이 순서 표시용. */}
      {index != null && (
        <span
          aria-hidden
          title={index <= 9 ? `${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})` : `#${index}`}
          style={{
            fontFamily: font.mono,
            fontSize: '11px',
            fontWeight: 600,
            color: color.muted,
            opacity: 0.85,
            flexShrink: 0,
            lineHeight: 1,
            minWidth: '12px',
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

/* Loading card — a **skeleton**, not a spinner. The dashboard on the same screen waits
   with skeletons; a spinning circle here would look like a different kind of work.
   The shape mirrors the real card. */
const LoadingResumableCard = () => (
  <div style={{ ...S.card, cursor: 'default' }} aria-busy="true">
    <SkeletonRow width="40px" height="40px" borderRadius={radius.md} style={{ flexShrink: 0 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
      <SkeletonRow width="46%" height="11px" />
      <SkeletonRow width="64%" height="9px" />
    </div>
  </div>
);

/* Empty-state card — holds the slot when there is nothing to resume, so the row does
 * not look bare.
 *
 * A dashed border means "a slot with nothing in it yet". It has to be **legible**
 * though: drawn in the hairline colour (border, 6% alpha) at 2px, the dashes sank into
 * the background and you could not tell a broken line from a smudged solid one — which
 * is what made it look odd. Dashes only read as dashes when the colour stands up.
 *
 * The colour is neutral (text 22%). An accent dashed border is the drag-over signal
 * ("drop it here"), so borrowing that colour would advertise an action that does not
 * exist — same notation, different colour.
 */
const EmptyResumableCard = ({ t }) => (
  <div
    style={{
      ...S.card,
      cursor: 'default',
      background: `color-mix(in srgb, ${color.surface0} var(--glass-fill, 45%)%, transparent)`,
      borderStyle: 'dashed',
      borderWidth: '2px',
      borderColor: `color-mix(in srgb, ${color.text} 22%, transparent)`,
      justifyContent: 'center',
      color: color.subtext,
      fontSize: fontSize['12'],
      fontWeight: fontWeight.medium,
      textAlign: 'center',
    }}
  >
    <Anchor size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
    <span>{t?.('noResumableSessions') || 'Nothing to resume'}</span>
    {/* 빈 목록은 그 자체로 아무 말도 하지 않는다 — 여기에 무엇이 나타나는지 한 줄 덧댄다. */}
    <span style={{ fontSize: fontSize['10'], color: color.faint, fontWeight: fontWeight.regular }}>
      {t?.('noResumableSessionsHint') || 'Work you left running on a server shows up here'}
    </span>
  </div>
);

/* 카드는 남겨 둔다 — 빈 pane 안의 Resumable(EmptyPane)에서는 여전히 카드가 맞다.
   거기는 목록이 아니라 "이 자리에 무엇을 열까" 를 고르는 화면이라 사정이 다르다. */
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
  /* 못 닿은 호스트 한 줄 — **카드가 아니다.** 면도 테두리도 주지 않는다. 세션 목록에
     세션처럼 생긴 것이 하나 더 늘면 그때부터 이 구획은 세션 목록이 아니게 된다.
     경고색도 아니다: 꺼진 기계가 있는 것은 사고가 아니라 흔한 상태다. */
  unreachable: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    alignSelf: 'flex-start',
    padding: '2px 0',
    background: 'transparent',
    border: 'none',
    color: color.muted,
    fontSize: fontSize['11'],
    fontFamily: 'inherit',
    lineHeight: 1.5,
    cursor: 'pointer',
    textAlign: 'left',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    width: '100%',
  },
  /* Open / Resumable 각 그룹 — HomeDashboard 의 <Section> 과 동일 구조 (head + content).
     gap 은 sectionHead 와 grid 간격. */
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  /* 정리 줄 — 섹션이 아니라 한 줄짜리 버튼이다. 자주 하는 일이 아니므로 카드 자리를
     차지하면 안 되고, 그렇다고 메뉴 깊이 넣으면 아무도 못 찾는다. */
  pruneRow: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 9px',
    borderRadius: radius.sm,
    border: `1px solid ${color.border}`,
    background: 'transparent',
    color: color.subtext,
    fontFamily: font.ui,
    fontSize: fontSize['11'],
    cursor: 'pointer',
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
