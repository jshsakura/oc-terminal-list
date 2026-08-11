import { useState, useEffect, useRef, useCallback } from 'react';
import { migrateTab, makLocalTab } from '../utils/tabModel';
import { areTabsEquivalent, tabsFingerprint, pickFallbackTabId } from '../utils/tabStateSync';
import { authHeaders } from '../utils/auth';
import { applyAgentStatusChanges, hydrateAgentStatus } from '../utils/agentStatusStore';
import { openEventStream } from '../utils/eventStream';

/**
 * 어느 탭에도 안 붙어 있는 살아있는 세션을 앞쪽 탭으로 되살린다.
 * 되살릴 게 없으면 **입력 배열을 그대로** 돌려준다 — 호출부가 참조 동일성으로
 * "변경 없음"을 판정해 불필요한 저장(PUT)을 건너뛸 수 있게.
 */
const injectOrphanSessions = (tabs, aliveSessions) => {
  const knownIds = new Set(
    tabs.flatMap((t) => (t.panes || []).map((p) => p.sessionId).filter(Boolean))
  );
  const missing = aliveSessions.filter((s) => !knownIds.has(s.id));
  if (!missing.length) return tabs;
  return [...missing.map((s) => makLocalTab(s.id, s.name || 'terminal', s.cwd || null)), ...tabs];
};

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
  // 사라졌으면 첫 탭이 아니라 **그 자리의 이웃**으로 간다 — 다른 기기가 내가 보던 탭을 닫았을 때
  // 화면이 맨 앞으로 확 튀는 게 "탭이 자꾸 이동한다"의 체감 원인이었다.
  const lastActiveIndexRef = useRef(0);
  useEffect(() => {
    const index = tabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      lastActiveIndexRef.current = index;
      return;
    }
    // 탭이 하나도 없을 땐 기억을 지우지 않는다 — 부팅 직후 (복원 전) 탭 목록은 비어 있고,
    // 여기서 지워버리면 이 기기가 보던 탭이 사라져 서버(=다른 기기) 값을 채택하게 된다.
    // 사용자가 마지막 탭을 닫는 경우엔 App.closeTab 이 직접 null 로 만든다.
    if (activeTabId && tabs.length > 0) setActiveTabId(pickFallbackTabId(tabs, lastActiveIndexRef.current));
  }, [tabs, activeTabId]);

  // 서버 탭 상태의 마지막 적용 버전. 자기 자신의 PUT 응답으로 갱신해
  // 폴링이 자기 변경을 다시 적용 (=리렌더 깜빡임) 하지 않게 한다.
  const lastAppliedTabVersionRef = useRef(null);
  // 로컬에서 입력 중 (debounce 대기) 인지 — 폴링이 도중에 덮어쓰지 않게 가드.
  const localDirtyRef = useRef(false);
  // 마지막으로 서버와 일치한다고 아는 탭 내용의 지문. PUT 성공 시 / 서버 상태를 그대로
  // 채택했을 때 갱신하고, 저장 effect 는 지문이 같으면 PUT 자체를 건너뛴다.
  // 이게 두 기기 사이 tab-state 에코 왕복(내용 동일한데 버전만 계속 튀는)을 끊는 두 번째 자물쇠.
  const syncedTabsFingerprintRef = useRef(null);

  // 다른 기기에서 받은 서버 상태를 로컬에 적용 (alive 세션 머지 포함).
  // 중요: activeTabId 는 라이브 동기화하지 않는다. 다른 기기/탭에서 활성 탭을 바꿀 때
  // 현재 화면까지 강제로 끌려가는 UX가 된다. 초기 복원 시에만 syncActive=true 로 한 번 반영.
  const applyServerTabState = useCallback(async (serverState, { syncActive = false } = {}) => {
    if (!serverState) return;
    // 살아있는 세션 "재입양"(orphan 주입)은 **초기 복원(syncActive)에서만** 한다.
    // 라이브 동기화(SSE·409 충돌)에서까지 매번 하면 치명적이다:
    //   (1) 적용마다 /api/sessions fetch → 요청 폭주,
    //   (2) 다른 기기가 의도적으로 닫은 세션을 이쪽이 계속 되살려 되던지는 핑퐁 →
    //       tab-state 버전이 무한히 튀며 리퀘스트 수백 개(=실제 겪은 폭주 + "탭이 터짐").
    // 라이브에선 서버 상태(canonical)를 그대로 채택한다. (cf. project_tab_unwrap_sanitize)
    let aliveSessions = [];
    if (syncActive) {
      try {
        const r = await fetch('/api/sessions');
        if (r.ok) aliveSessions = (await r.json()).filter((s) => s.alive);
      } catch { /* noop */ }
    }
    const incoming = (serverState?.tabs?.length > 0) ? serverState.tabs.map(migrateTab) : null;
    // 내용이 이미 같으면 **참조를 유지**한다. 새 배열을 돌려주면 저장 effect 가 다시 돌아
    // 같은 내용을 PUT → 서버가 버전을 새로 찍음 → 상대 기기가 또 적용 → … 무한 왕복.
    const keepIfSame = (prev, next) => (areTabsEquivalent(prev, next) ? prev : next);

    if (!syncActive) {
      // 라이브 동기화 — 서버가 canonical. 서버에 탭이 없으면 로컬을 건드리지 않는다.
      if (!incoming) return;
      setTabs((prev) => keepIfSame(prev, incoming));
      syncedTabsFingerprintRef.current = tabsFingerprint(incoming);
      if (serverState?.updatedAt) lastAppliedTabVersionRef.current = serverState.updatedAt;
      return;
    }

    const injected = incoming ? injectOrphanSessions(incoming, aliveSessions) : null;
    if (injected) {
      setTabs((prev) => keepIfSame(prev, injected));
      // 주입 없이 서버 상태 그대로면 이미 서버와 일치 — 로그인 직후 무의미한 PUT 을 막는다.
      if (injected === incoming) syncedTabsFingerprintRef.current = tabsFingerprint(incoming);
    } else {
      // 서버에 저장된 탭이 없다 — 로컬 상태를 유지하되 살아있는 세션만 되살린다.
      setTabs((prev) => injectOrphanSessions(prev, aliveSessions));
    }
    // 복원 시 활성 탭: **이 기기가 보던 탭이 아직 살아있으면 그걸 유지**한다. 서버 값은
    // 마지막으로 저장한 아무 기기의 것이라, 무조건 채택하면 새로고침할 때마다 PC 가 보던
    // 탭으로 끌려간다. 이 기기에 기억된 탭이 없거나 사라졌을 때만 서버 값으로.
    setActiveTabId((prev) => {
      if (prev && (!injected || injected.some((t) => t.id === prev))) return prev;
      return serverState?.activeTabId || null;
    });
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
  //   3) 지문 비교 — 서버와 내용이 같으면 PUT 자체를 안 한다. 서버는 내용이 같아도 저장할
  //      때마다 updated_at 을 새로 찍고 그게 SSE 로 상대 기기에 전파되므로, 이 가드가 없으면
  //      두 기기가 같은 내용을 영원히 되받아친다.
  const _saveTabTimer = useRef(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (isRestoringWorkspace) return;
    const fingerprint = tabsFingerprint(tabs);
    if (fingerprint === syncedTabsFingerprintRef.current) return;   // 서버와 동일 — 보낼 것 없음
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
          syncedTabsFingerprintRef.current = fingerprint;   // 이제 서버와 일치
        }
      } catch { /* offline ok — 다음 변경에 다시 시도 */ }
      localDirtyRef.current = false;
    }, 800);
    return () => {
      if (_saveTabTimer.current) clearTimeout(_saveTabTimer.current);
      // 예약이 취소됐으면 "저장 대기 중"도 아니다. 이걸 안 풀면 dirty 가 true 로 박혀
      // SSE 라이브 동기화가 다음 로컬 변경 때까지 통째로 무시된다 — 마운트 직후 (복원 시작
      // 전에 한 번 예약됐다가 isRestoringWorkspace 로 취소되는) 경로에서 실제로 그랬다.
      localDirtyRef.current = false;
    };
  }, [tabs, isAuthenticated, isRestoringWorkspace, applyServerTabState]);

  // 다른 기기 (PC↔모바일) tab-state 변경을 SSE 로 수신 — 폴링 제거.
  // 서버가 PUT /api/tab-state 저장 직후 EventSource 로 updatedAt 을 push.
  // EventSource 는 커스텀 헤더 불가 → 일회용 /api/sse-ticket 으로 인증.
  //
  // 불변식 (CRITICAL): 디바이스당 EventSource 1개 + 대기 타이머 1개만 존재.
  // 과거 버그 — connect() 가 async 라 중복 호출/onerror 다중 발화 시 재연결 체인이
  // 병렬로 갈라져 기하급수 증식 → sse-ticket 초당 수십 회 → Cloudflare 공유 터널
  // 포화 → 터미널 WS 까지 flapping. 아래 세 가드로 단일 연결을 강제한다:
  //   1) connecting / es 가드 — connect() 가 절대 겹쳐 실행되지 않음
  //   2) scheduleReconnect() 멱등 — 타이머가 이미 있으면 새로 안 검 (onerror 다중 발화 흡수)
  //   3) 백오프는 "충분히 오래 살아남은" 연결에서만 리셋 — 터널이 SSE 를 즉시 끊으면
  //      지수 백오프(최대 30s)로 수렴해 폭주를 차단
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let es = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;
    let connecting = false;
    let openedAt = 0;

    const STABLE_MS = 60000;   // 이만큼 살아남은 연결만 백오프 리셋
    const MAX_DELAY = 30000;

    const applyIfChanged = async (updatedAt) => {
      console.log('DBG applyIfChanged', updatedAt, lastAppliedTabVersionRef.current, localDirtyRef.current);
      if (!updatedAt || updatedAt === lastAppliedTabVersionRef.current) return;
      if (localDirtyRef.current) return;
      try {
        const r2 = await fetch('/api/tab-state', { headers: authHeaders() });
        if (!r2.ok || cancelled || localDirtyRef.current) return;
        const serverState = await r2.json();
        if (cancelled || localDirtyRef.current) return;
        await applyServerTabState(serverState);
      } catch { /* offline noop */ }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;   // 멱등: 대기 중이면 중복 예약 금지
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
        connect();
      }, reconnectDelay);
    };

    const connect = async () => {
      if (cancelled || connecting || es) return;   // 단일 연결 강제
      connecting = true;
      try {
        // NOTE(2026-07-24): 쿠키 폴백으로 티켓 fetch 를 없앴다가 되돌렸다 — 그 변경 직후
        // SSE 폭주(리퀘스트 수백)가 재발. 이 경로는 [[project_sse_reconnect_storm]] 이력이
        // 있어 known-good(티켓 방식)을 유지한다. 백엔드는 쿠키 폴백을 그대로 받지만
        // 프론트는 티켓으로 연결한다.
        const res = await fetch('/api/sse-ticket', { method: 'POST', headers: authHeaders() });
        if (!res.ok || cancelled) { connecting = false; if (!cancelled) scheduleReconnect(); return; }
        const { ticket } = await res.json();
        if (cancelled) { connecting = false; return; }

        // 스트림 자체는 워커가 든다 — iOS 진행바가 이걸 "로딩 중인 리소스" 로 세지 않게.
        // 티켓/백오프/단일연결 불변식은 여기 그대로다(위 CRITICAL 주석).
        const source = openEventStream(`/api/tab-state/events?ticket=${encodeURIComponent(ticket)}`, {
          onOpen: () => {
            openedAt = Date.now();
            // SSE 는 변경분만 흘린다 — 연결(재연결)마다 전체 스냅샷을 한 번 받는다.
            fetch('/api/agent-status', { headers: authHeaders() })
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => { if (!cancelled && d) hydrateAgentStatus(d.sessions); })
              .catch(() => { /* 상태 점이 조금 늦게 뜰 뿐 — 다음 변경에 채워진다 */ });
          },
          onMessage: (raw) => {
            if (cancelled) return;
            try {
              const payload = JSON.parse(raw);
              // 같은 스트림에 여러 타입이 흐른다 — 새 스트림을 열면 단일 연결
              // 불변식이 깨져 재연결 폭주가 재발한다(위 CRITICAL 주석 참고).
              if (payload.type === 'agentStatus') {
                applyAgentStatusChanges(payload.changes);
                return;
              }
              applyIfChanged(payload.updatedAt);
            } catch { /* noop */ }
          },
          onError: () => {
            if (es !== source) return;   // 이미 교체/정리된 연결의 늦은 onerror 무시
            const lived = openedAt ? Date.now() - openedAt : 0;
            source.close();
            es = null;
            openedAt = 0;
            if (lived > STABLE_MS) reconnectDelay = 2000;   // 안정 연결이었으면만 리셋
            if (!cancelled) scheduleReconnect();
          },
        });
        es = source;
        connecting = false;
      } catch {
        connecting = false;
        if (!cancelled) scheduleReconnect();
      }
    };

    // SSE 는 **문서 로드가 끝난 뒤** 연다. EventSource 는 응답이 끝나지 않는 HTTP 요청이라,
    // 로드 중에 열면 iOS 사파리가 이걸 "아직 안 끝난 페이지 리소스"로 보고 주소창 밑
    // 진행바를 10%쯤에서 영영 멈춘 채 남겨둔다(새로고침해야 사라지던 그 바).
    // load 이후에 열면 진행 계산에 안 들어간다.
    // load 직후 같은 턴에 열면 사파리가 아직 그 로드의 일부로 셈한다(SPA 는 보통 load 가
    // 이미 끝난 뒤 마운트되므로 이 분기로 들어온다) — 한 박자 떼어 확실히 분리한다.
    let sseStartTimer = null;
    const startSse = () => {
      if (cancelled) return;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => { if (!cancelled) connect(); }, { timeout: 1500 });
        return;
      }
      sseStartTimer = setTimeout(() => { if (!cancelled) connect(); }, 400);
    };
    if (document.readyState === 'complete') startSse();
    else window.addEventListener('load', startSse, { once: true });

    // 포커스 복귀 시 — 완전히 idle 상태(연결 없음·진행 중 아님·대기 타이머 없음)일 때만 재시도
    const onVisible = () => {
      if (!document.hidden && !es && !connecting && !reconnectTimer) connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      es?.close();
      es = null;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (sseStartTimer) { clearTimeout(sseStartTimer); sseStartTimer = null; }
      window.removeEventListener('load', startSse);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isAuthenticated, applyServerTabState]);

  // setIsRestoringWorkspace 도 노출 — 로그인 직후 App 이 복원 로딩화면을 즉시 띄우기 위함
  // (restore effect 가 isAuthenticated 로 켜기 전 깜빡임 방지).
  return { tabs, setTabs, activeTabId, setActiveTabId, isRestoringWorkspace, setIsRestoringWorkspace };
}
