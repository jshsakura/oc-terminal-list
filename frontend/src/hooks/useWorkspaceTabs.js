import { useState, useEffect, useRef, useCallback } from 'react';
import { migrateTab, makLocalTab } from '../utils/tabModel';
import { authHeaders } from '../utils/auth';

/**
 * 워크스페이스 탭 상태 + 영속의 단일 소유 모듈.
 * - tabs / activeTabId 상태 (localStorage 캐시 동기화 + 활성탭 유효성 검사)
 * - 서버 tab-state 복원(로그인 시) / 저장(debounce PUT, ifMatch 충돌해소) / SSE 라이브 동기화
 * App.jsx 에서 로직 변경 없이 이 concern 전체를 추출. 탭 "조작"(추가/닫기/분할 등)은 App 에
 * 남아 여기서 받은 setTabs/setActiveTabId 를 쓴다.
 *
 * 반환: { tabs, setTabs, activeTabId, setActiveTabId, isRestoringWorkspace }
 */
export default function useWorkspaceTabs({ isAuthenticated }) {
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(false);

  const [tabs, setTabs] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('tabs_v2') || '[]');
      return stored.map(migrateTab);
    } catch { return []; }
  });
  const [activeTabId, setActiveTabId] = useState(() => localStorage.getItem('active_tab_id') || null);

  // localStorage 캐시 동기화 (같은 기기 새로고침 시 즉시 복원용)
  useEffect(() => { localStorage.setItem('tabs_v2', JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => {
    if (activeTabId) localStorage.setItem('active_tab_id', activeTabId);
    else localStorage.removeItem('active_tab_id');
  }, [activeTabId]);

  // validate active tab still exists (activeTabId=null 은 홈 화면 의도이므로 건드리지 않음)
  useEffect(() => {
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id || null);
    }
  }, [tabs, activeTabId]);

  // 서버 탭 상태의 마지막 적용 버전. 자기 자신의 PUT 응답으로 갱신해
  // 폴링이 자기 변경을 다시 적용 (=리렌더 깜빡임) 하지 않게 한다.
  const lastAppliedTabVersionRef = useRef(null);
  // 로컬에서 입력 중 (debounce 대기) 인지 — 폴링이 도중에 덮어쓰지 않게 가드.
  const localDirtyRef = useRef(false);

  // 다른 기기에서 받은 서버 상태를 로컬에 적용 (alive 세션 머지 포함).
  // 중요: activeTabId 는 라이브 동기화하지 않는다. 다른 기기/탭에서 활성 탭을 바꿀 때
  // 현재 화면까지 강제로 끌려가는 UX가 된다. 초기 복원 시에만 syncActive=true 로 한 번 반영.
  const applyServerTabState = useCallback(async (serverState, { syncActive = false } = {}) => {
    if (!serverState) return;
    let aliveSessions = [];
    try {
      const r = await fetch('/api/sessions');
      if (r.ok) aliveSessions = (await r.json()).filter((s) => s.alive);
    } catch { /* noop */ }
    setTabs((prev) => {
      const base = (serverState?.tabs?.length > 0)
        ? serverState.tabs.map(migrateTab)
        : prev;
      const knownIds = new Set(
        base.flatMap((t) => (t.panes || []).map((p) => p.sessionId).filter(Boolean))
      );
      const missing = aliveSessions.filter((s) => !knownIds.has(s.id));
      return missing.length
        ? [...missing.map((s) => makLocalTab(s.id, s.name || 'terminal', s.cwd || null)), ...base]
        : base;
    });
    if (syncActive && serverState?.activeTabId !== undefined) {
      setActiveTabId(serverState.activeTabId || null);
    }
    if (serverState?.updatedAt) lastAppliedTabVersionRef.current = serverState.updatedAt;
  }, []);

  // 로그인 후 서버 탭 상태(canonical)와 alive 세션을 함께 조회해 완전 복원.
  // 복원 중에는 앱 shell 을 바로 보여주지 않아 저장된 탭/패널로 휙 넘어가는 느낌을 줄인다.
  useEffect(() => {
    if (!isAuthenticated) {
      setIsRestoringWorkspace(false);
      return;
    }
    let cancelled = false;
    const startedAt = Date.now();
    setIsRestoringWorkspace(true);

    const finish = async () => {
      try {
        const r = await fetch('/api/tab-state');
        const serverState = r.ok ? await r.json() : null;
        if (!cancelled) await applyServerTabState(serverState, { syncActive: true });
      } catch {
        if (!cancelled) await applyServerTabState(null, { syncActive: true });
      } finally {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, 420 - elapsed);
        window.setTimeout(() => {
          if (!cancelled) setIsRestoringWorkspace(false);
        }, wait);
      }
    };

    finish();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // tabs 변경 시 서버에 저장 (debounced 800ms) — 기기 간 탭 구성 동기화.
  // activeTabId 는 localStorage 로만 유지한다. 탭 선택까지 서버에 저장하면 다른 기기가
  // 보고 있던 탭을 강제로 이동시키는 문제가 생긴다.
  // 응답의 updatedAt 을 기억해 폴링에서 자기 변경 재적용을 막음.
  //
  // 두 안전망:
  //   1) isRestoringWorkspace 동안엔 save 자체 차단 — 초기 localStorage 상태가 서버 상태를
  //      덮어쓰는 race 방지. restore 가 끝난 뒤 진짜 사용자 변경부터만 PUT.
  //   2) ifMatch (= 마지막으로 본 서버 updatedAt) 동봉 — 다른 기기가 그 사이 더 새 상태를
  //      썼다면 서버가 409 반환. 그땐 즉시 서버 상태로 동기화 (stale 클라이언트가 더 풍부한
  //      상태를 덮어쓰는 사고 방지).
  const _saveTabTimer = useRef(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (isRestoringWorkspace) return;
    localDirtyRef.current = true;
    if (_saveTabTimer.current) clearTimeout(_saveTabTimer.current);
    _saveTabTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/tab-state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabs,
            activeTabId,
            ifMatch: lastAppliedTabVersionRef.current,
          }),
        });
        if (res.status === 409) {
          // 다른 기기가 더 새 상태로 먼저 썼음 — 서버 상태로 즉시 동기화.
          const conflict = await res.json().catch(() => null);
          if (conflict?.current) {
            await applyServerTabState(conflict.current);
          }
        } else if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.updatedAt) lastAppliedTabVersionRef.current = data.updatedAt;
        }
      } catch { /* offline ok — 다음 변경에 다시 시도 */ }
      localDirtyRef.current = false;
    }, 800);
    return () => { if (_saveTabTimer.current) clearTimeout(_saveTabTimer.current); };
  }, [tabs, isAuthenticated, isRestoringWorkspace, applyServerTabState]);

  // 다른 기기 (PC↔모바일) tab-state 변경을 SSE 로 수신 — 폴링 제거.
  // 서버가 PUT /api/tab-state 저장 직후 EventSource 로 updatedAt 을 push.
  // EventSource 는 커스텀 헤더 불가 → 일회용 /api/sse-ticket 으로 인증.
  // 연결 끊기면 지수 백오프(최대 30s)로 자동 재연결.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let es = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;

    const applyIfChanged = async (updatedAt) => {
      if (!updatedAt || updatedAt === lastAppliedTabVersionRef.current) return;
      if (localDirtyRef.current) return;
      try {
        const r2 = await fetch('/api/tab-state', { headers: authHeaders() });
        if (!r2.ok || cancelled || localDirtyRef.current) return;
        const serverState = await r2.json();
        if (cancelled || localDirtyRef.current) return;
        await applyServerTabState(serverState);
        reconnectDelay = 2000;
      } catch { /* offline noop */ }
    };

    const connect = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/sse-ticket', { method: 'POST', headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const { ticket } = await res.json();
        if (cancelled) return;

        es = new EventSource(`/api/tab-state/events?ticket=${encodeURIComponent(ticket)}`);

        es.onmessage = (e) => {
          if (cancelled) return;
          try { applyIfChanged(JSON.parse(e.data).updatedAt); } catch { /* noop */ }
        };

        es.onerror = () => {
          if (cancelled) return;
          es?.close();
          es = null;
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
            connect();
          }, reconnectDelay);
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, reconnectDelay);
      }
    };

    connect();

    // 포커스 복귀 시 끊긴 연결 즉시 재시도
    const onVisible = () => { if (!document.hidden && !es) connect(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isAuthenticated, applyServerTabState]);

  // setIsRestoringWorkspace 도 노출 — 로그인 직후 App 이 복원 로딩화면을 즉시 띄우기 위함
  // (restore effect 가 isAuthenticated 로 켜기 전 깜빡임 방지).
  return { tabs, setTabs, activeTabId, setActiveTabId, isRestoringWorkspace, setIsRestoringWorkspace };
}
