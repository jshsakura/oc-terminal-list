import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { Terminal as TerminalIcon, Menu, XCircle, LogOut, Columns3, MessageSquare } from 'lucide-react';
import useSettings from './hooks/useSettings';
import useTranslation from './hooks/useTranslation';
import useAuth from './hooks/useAuth';
import useHosts from './hooks/useHosts';
import useSshKeys from './hooks/useSshKeys';
import useActiveTerminalCwd from './hooks/useActiveTerminalCwd';
import themes from './styles/themes';
import { applyThemeVars } from './styles/themeUI';
import { tokens } from './styles/tokens';
import { generateUUID } from './utils/helpers';

import TabBar from './components/TabBar';
import HomeDashboard from './components/HomeDashboard';
import RemoteFolderPicker from './components/RemoteFolderPicker';
import LocalEditor from './components/LocalEditor';
import LocalFolderPicker from './components/LocalFolderPicker';
import { tokens as designTokens } from './styles/tokens';
import HostManager from './components/HostManager';
import PaneGrid from './components/PaneGrid';
import PaneErrorBoundary from './components/PaneErrorBoundary';
import LazyErrorBoundary from './components/LazyErrorBoundary';
import LoadingScreen from './components/layout/LoadingScreen';

const Terminal        = lazy(() => import('./components/Terminal'));
const FileEditor      = lazy(() => import('./components/FileEditor'));
const Settings        = lazy(() => import('./components/Settings'));
const ConfirmModal    = lazy(() => import('./components/ConfirmModal'));
const NotificationModal = lazy(() => import('./components/NotificationModal'));
const InitialSetup    = lazy(() => import('./components/InitialSetup'));
const Login           = lazy(() => import('./components/Login'));
const CommandPalette  = lazy(() => import('./components/CommandPalette'));
const HostEditor      = lazy(() => import('./components/HostEditor'));
const SshKeyManager   = lazy(() => import('./components/SshKeyManager'));
const MobileToolbar   = lazy(() => import('./components/MobileToolbar'));
const CommandInput    = lazy(() => import('./components/CommandInput'));
const ScreenDumpModal = lazy(() => import('./components/ScreenDumpModal'));

const { color, font, fontSize, fontWeight, space } = tokens;

// ── tab helpers ──────────────────────────────────────────────────────────────
// 모델: tab = { id, type, name, ..., panes:[Pane], layout:'single'|'h'|'v'|'2x2', activePaneId, viewMode? }
// viewMode? : 'grid' (기본, undefined 동일) | 'tabs' — panes.length > 1 일 때 grid 분할 대신 sub-tabs 로 표시.
// Pane = { id, mode:'terminal'|'editor', sessionId?, hostId?, openFiles?, activeFile? }

const makePane = (extra = {}) => ({
  id: generateUUID(),
  mode: 'terminal',
  ...extra,
});

const makLocalTab = (sessionId, name, cwd = null, { icon = null, colorIndex = null, themeOverride = null } = {}) => {
  const pane = makePane({ sessionId, ...(themeOverride ? { themeOverride } : null) });
  return {
    id: `local:${sessionId}`,
    type: 'local',
    sessionId,
    name: name || 'terminal',
    cwd: cwd ?? null,
    icon: icon || null,
    color_index: colorIndex ?? 0,
    panes: [pane],
    layout: 'single',
    activePaneId: pane.id,
  };
};

// 호스트 탭마다 고유 tmux 세션 suffix — 같은 호스트라도 새 탭 = 새 작업공간.
// 탭이 서버 tab-state 로 복원될 땐 이 값이 보존되어 같은 세션을 다시 attach.
const makeTmuxSuffix = () => Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 36).toString(36);

const makeHostTab = (host, cwd = null, tmuxSessionName = null) => {
  // tmuxSessionName 이 주어지면 이미 존재하는 영속 세션을 명시적으로 attach (Resume).
  // 이 경우 새 base/suffix 를 만들 필요 없고 pane 0 에 세션명을 직접 박는다.
  // host.theme 이 있으면 pane.themeOverride 자동 설정 → 연결과 동시에 그 테마로 chrome 동기화.
  const pane = makePane({
    hostId: host.id,
    ...(tmuxSessionName ? { tmuxSessionName } : null),
    ...(host.theme ? { themeOverride: host.theme } : null),
  });
  const suffix = tmuxSessionName ? null : makeTmuxSuffix();
  return {
    id: `host:${host.id}:${Date.now()}`,
    type: 'host',
    hostId: host.id,
    tmuxSuffix: suffix,
    name: tmuxSessionName ? `${host.name} · ${tmuxSessionName}` : host.name,
    icon: host.icon || null,
    color_index: host.color_index ?? 0,
    cwd: cwd ?? null,
    panes: [pane],
    layout: 'single',
    activePaneId: pane.id,
  };
};

// 옛 탭 (panes 없음) 자동 마이그레이션 — localStorage 호환
const migrateTab = (t) => {
  if (t.panes && t.panes.length > 0) return t;
  const pane = makePane({ sessionId: t.sessionId, hostId: t.hostId });
  return { ...t, panes: [pane], layout: 'single', activePaneId: pane.id };
};

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // useAuth 를 먼저 — isAuthenticated 가 useSettings 의 fetch 트리거 dep 으로 들어간다.
  // (로그인 후 처음 로드되는 경우에도 server 의 mobile fontSize 등을 가져오기 위함.)
  const { isLoading, needsSetup, isAuthenticated, username, login, logout, completeSetup } = useAuth();
  const { settings, updateSettings } = useSettings(isAuthenticated);
  const { t } = useTranslation(settings.language);
  const currentTheme = useMemo(() => themes[settings.theme] || themes.catppuccin, [settings.theme]);
  // 초기 1회 — focusedPane 이 아직 안 정의된 첫 렌더에 글로벌 테마 즉시 적용 (FOUC 방지).
  // 활성 pane 의 themeOverride 가 잡히면 아래쪽 effect 가 덮어씀.
  useEffect(() => { applyThemeVars(currentTheme); }, [currentTheme]);
  const { hosts, refresh: refreshHosts, createHost, updateHost, deleteHost } = useHosts(isAuthenticated);
  const { keys: sshKeys, createKey, updateKey, deleteKey } = useSshKeys(isAuthenticated);

  // ── tabs ──────────────────────────────────────────────────────────────────
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

  // 활성 탭명을 브라우저 탭 제목에 반영 (Jupyter 식). 활성 탭 없으면 기본 제목으로 복귀.
  const DEFAULT_DOC_TITLE = 'Terminal List — Multi-Session SSH Terminal';
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    document.title = active?.name ? `${active.name} — Terminal List` : DEFAULT_DOC_TITLE;
  }, [tabs, activeTabId]);

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
  const applyServerTabState = useCallback(async (serverState) => {
    if (!serverState) return;
    const token = localStorage.getItem('auth_token');
    let aliveSessions = [];
    try {
      const r = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
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
    if (serverState?.activeTabId !== undefined) {
      setActiveTabId(serverState.activeTabId || null);
    }
    if (serverState?.updatedAt) lastAppliedTabVersionRef.current = serverState.updatedAt;
  }, []);

  // 로그인 후 서버 탭 상태(canonical)와 alive 세션을 함께 조회해 완전 복원
  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem('auth_token');
    fetch('/api/tab-state', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((serverState) => applyServerTabState(serverState));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // tabs/activeTabId 변경 시 서버에 저장 (debounced 800ms) — 기기 간 완전 동기화.
  // 응답의 updatedAt 을 기억해 폴링에서 자기 변경 재적용을 막음.
  const _saveTabTimer = useRef(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    localDirtyRef.current = true;
    if (_saveTabTimer.current) clearTimeout(_saveTabTimer.current);
    _saveTabTimer.current = setTimeout(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      try {
        const res = await fetch('/api/tab-state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tabs, activeTabId }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.updatedAt) lastAppliedTabVersionRef.current = data.updatedAt;
        }
      } catch { /* offline ok — 다음 변경에 다시 시도 */ }
      localDirtyRef.current = false;
    }, 800);
    return () => { if (_saveTabTimer.current) clearTimeout(_saveTabTimer.current); };
  }, [tabs, activeTabId, isAuthenticated]);

  // 다른 기기 (PC↔모바일) 변경 폴링 — 2.5초마다 가벼운 version 체크,
  // 다르면 풀 GET. 로컬 입력 중 (dirty) 이면 스킵 — 사용자의 키 입력이
  // 폴링에 의해 되돌려지는 일을 방지.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const POLL_MS = 2500;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      if (localDirtyRef.current) return;
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      try {
        const r = await fetch('/api/tab-state/version', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const { updatedAt } = await r.json();
        if (!updatedAt) return;
        if (updatedAt === lastAppliedTabVersionRef.current) return;
        // 풀 GET 후 적용
        const r2 = await fetch('/api/tab-state', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r2.ok) return;
        const serverState = await r2.json();
        if (cancelled || localDirtyRef.current) return;
        await applyServerTabState(serverState);
      } catch { /* offline noop */ }
    };

    const id = setInterval(tick, POLL_MS);
    // 탭이 다시 포커스 받으면 즉시 한 번 확인 (백그라운드 동안의 변경 빠르게 반영)
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // 초기 1회는 위 useEffect 가 적용 — 여기선 인터벌만.
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isAuthenticated, applyServerTabState]);

  // 키보드 핸들러 클로저에서 stale 안 되게 ref 로 보관
  const activeTabIdRef = useRef(null);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // closePane → closeTab 위임용 (선언 순서가 거꾸로라 ref 로 우회)
  const closeTabRef = useRef(null);

  /* 호스트 pane 의 원격 tmux 세션 이름 계산 — backend/host_manager.effective_tmux_session 와 동기.
     pane.tmuxSessionName 이 있으면 (Resume 으로 재attach 된 탭) 그 이름 그대로,
     없으면 base = host.remote_tmux_session 에 tab.tmuxSuffix / pane index 합성. */
  const computePaneTmuxSession = useCallback((host, tab, pane, paneIndex) => {
    if (pane?.tmuxSessionName) return pane.tmuxSessionName;
    const baseFromHost = host?.remote_tmux_session || 'mobile';
    const base = tab?.tmuxSuffix ? `${baseFromHost}-${tab.tmuxSuffix}` : baseFromHost;
    return paneIndex === 0 ? base : `${base}_${paneIndex + 1}`;
  }, []);

  /* 원격 tmux 세션 kill — fire-and-forget. 호스트가 도달 불가능하면 다음 접속 때 Resumable 에 남음. */
  const killRemoteTmuxSession = useCallback((hostId, sessionName) => {
    if (!hostId || !sessionName) return;
    const token = localStorage.getItem('auth_token');
    fetch(`/api/hosts/${hostId}/kill-tmux?session=${encodeURIComponent(sessionName)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }, []);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) || null, [tabs, activeTabId]);

  // 탭별 영속성 (tmux 로 작업이 살아남는지) — 로컬은 항상 true, 호스트는 use_remote_tmux 따라감.
  // TabBar 가 시각 표시할 수 있게 derived field 로 붙여서 넘김.
  const tabsWithMeta = useMemo(() => tabs.map((tt) => {
    const host = tt.type === 'host' ? hosts.find((h) => h.id === tt.hostId) : null;
    const isPersistent = tt.type === 'local' || !!host?.use_remote_tmux;
    // 호스트/로컬 메타가 바뀌면(이름/아이콘/색/테마 변경) 탭에 즉시 반영 — tab 객체에 캡처된 값은
    // 생성 시점 스냅샷이라 사용자가 호스트 편집해도 안 따라가던 문제 해결.
    if (host) {
      return {
        ...tt,
        isPersistent,
        name: host.name || tt.name,
        icon: host.icon ?? tt.icon ?? null,
        color_index: host.color_index ?? tt.color_index ?? 0,
      };
    }
    if (tt.type === 'local') {
      return {
        ...tt,
        isPersistent,
        // 로컬은 사용자가 Settings → This machine 에서 바꾼 값을 따라가도록.
        name: (settings.localName || '').trim() || tt.name || 'terminal',
        icon: settings.localIcon || tt.icon || null,
        color_index: settings.localColorIndex ?? tt.color_index ?? 0,
      };
    }
    return { ...tt, isPersistent };
  }), [tabs, hosts, settings.localName, settings.localIcon, settings.localColorIndex]);

  // ── open / close tabs ─────────────────────────────────────────────────────
  // 새 로컬 터미널 — 명시 cwd 없으면 settings.localStartPath 사용. 비어 있어도 '' (= 워크스페이스 루트)
  // 로 명시 전달해 backend 가 임의 위치($HOME 등) 에서 spawn 하지 않도록 함.
  const openLocalTab = useCallback(async (cwd = null) => {
    const sessionId = generateUUID();
    const name = (settings.localName || '').trim() || 'terminal';
    const startCwd = cwd ?? settings.localStartPath ?? '';
    const tab = makLocalTab(sessionId, name, startCwd, {
      icon: settings.localIcon || null,
      colorIndex: settings.localColorIndex ?? 0,
      themeOverride: settings.localTheme || null,
    });
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [settings.localName, settings.localIcon, settings.localColorIndex, settings.localTheme, settings.localStartPath]);

  const openHostTab = useCallback((host, cwd = null, tmuxSessionName = null) => {
    if (!host || host.isLocal || host.id === 'local') {
      openLocalTab();
      return;
    }
    // 명시 cwd 가 없으면 host 설정의 start_path 로 폴백 → FileTree 가 그 경로에서 시작
    const initialCwd = cwd ?? host.start_path ?? null;
    const tab = makeHostTab(host, initialCwd, tmuxSessionName);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [openLocalTab]);

  // ── pane operations ───────────────────────────────────────────────────────
  // 활성 탭에 *빈* pane 을 분할 추가. 사용자가 클릭해야 세션이 시작됨.
  // dir = 'h' (좌우) | 'v' (상하)
  // 중요: prev (latest) 에서 panes 길이 판단 → useCallback 클로저의 stale activeTab 영향 안 받음
  // 모바일에서는 가로/세로 분할이 의미 없음 (화면 좁음 + sub-tab 으로 변환됨).
  // → 키보드 단축키로도 호출 못 막게 진입에서 차단.
  const isMobileViewportRef = useRef(false);
  const splitActivePane = useCallback((dir = 'h') => {
    if (isMobileViewportRef.current) return;
    setTabs((prev) => {
      const targetId = activeTabIdRef.current;
      if (!targetId) return prev;
      return prev.map((t) => {
        if (t.id !== targetId) return t;
        const currentPanes = t.panes || [];

        /* 새 pane 은 *빈* (sessionId / hostId 미설정) → EmptyPane picker 가 떠서 사용자가 직접 선택.
           로컬, 같은 호스트, 다른 호스트, 다른 탭 흡수 등 자유롭게 골라 "한 화면에 멀티 호스트" 구성 가능. */

        /* '2x2' — 4 pane 채움. 부족한 만큼 빈 pane 추가, 각자 picker 표시. */
        if (dir === '2x2') {
          if (currentPanes.length >= 4) return { ...t, layout: '2x2' };
          const panes = [...currentPanes];
          while (panes.length < 4) panes.push(makePane({}));
          return {
            ...t,
            panes,
            layout: '2x2',
            activePaneId: t.activePaneId || panes[0].id,
          };
        }

        /* 'h' / 'v' — 빈 pane 1개 추가. 4개 도달 시 더 못 추가. */
        if ((currentPanes.length || 1) >= 4) return t;
        const newPane = makePane({});
        const panes = [...currentPanes, newPane];
        let layout = t.layout || 'single';
        if (panes.length === 2) layout = dir === 'v' ? 'v' : 'h';
        else if (panes.length >= 3) layout = '2x2';
        return { ...t, panes, layout, activePaneId: newPane.id };
      });
    });
  }, []);

  // 빈 pane 활성화 — target 종류:
  //  - { type: 'local' } 새 로컬 세션
  //  - { type: 'host', hostId } 호스트 새 pane
  //  - { type: 'tab',  sourceTabId } 다른 열린 탭 전체를 이 자리로 흡수 (병합)
  //                                  → 원본 탭은 상단 탭바에서 사라지고, 그 탭의 pane 들이
  //                                    대상 탭에 합류 (총 4개까지).
  // target 없으면 부모 탭 타입 그대로 따라감 (단순 클릭 케이스)
  const MAX_PANES = 4;
  const activatePane = useCallback((tabId, paneId, target = null) => {
    setTabs((prev) => {
      // 병합인 경우 원본 탭의 pane 들을 빈 슬롯에 채워넣는 로직을 한 번에 처리.
      if (target?.type === 'tab' && target.sourceTabId) {
        const src = prev.find((tt) => tt.id === target.sourceTabId);
        if (!src) return prev;
        const srcActivePanes = (src.panes || []).filter((p) => p.sessionId || p.hostId);
        if (srcActivePanes.length === 0) {
          return prev.filter((t) => t.id !== target.sourceTabId);
        }

        const destTab = prev.find((t) => t.id === tabId);
        const currentPanes = [...(destTab?.panes || [])];

        const emptyIndices = [];
        currentPanes.forEach((p, i) => {
          if (!p.sessionId && !p.hostId) emptyIndices.push(i);
        });

        let srcIdx = 0;
        const filledPanes = currentPanes.map((p, i) => {
          if (emptyIndices.includes(i) && srcIdx < srcActivePanes.length) {
            return { ...p, sessionId: srcActivePanes[srcIdx].sessionId, hostId: srcActivePanes[srcIdx++].hostId };
          }
          return p;
        });

        const overflowSrcIds = new Set(srcActivePanes.slice(srcIdx).map((p) => p.id));
        const movedSrcIds = new Set(srcActivePanes.slice(0, srcIdx).map((p) => p.id));

        const srcRemaining = (src.panes || []).filter((p) => !movedSrcIds.has(p.id));
        const srcStillActive = srcRemaining.some((p) => p.sessionId || p.hostId);

        let result = prev.map((t) => {
          if (t.id === tabId) {
            const allP = filledPanes.length === 3 ? [...filledPanes, makePane({})] : filledPanes;
            const total = allP.length;
            let layout = t.layout || 'single';
            if (total === 1) layout = 'single';
            else if (total === 2) layout = (layout === 'v' ? 'v' : 'h');
            else layout = '2x2';
            return { ...t, panes: allP, layout };
          }
          if (t.id === target.sourceTabId) {
            if (!srcStillActive && overflowSrcIds.size === 0) return null;
            const keep = [...srcRemaining];
            if (overflowSrcIds.size > 0) {
              overflowSrcIds.forEach(() => keep.push(makePane({})));
            }
            const cleaned = keep.filter((p) => p.sessionId || p.hostId).length > 0
              ? keep : [makePane({})];
            const active = cleaned.filter((p) => p.sessionId || p.hostId);
            const finalPanes = active.length === 0
              ? [makePane({})]
              : (active.length === 3 ? [...active, makePane({})] : active);
            const nTotal = finalPanes.length;
            let nLayout = t.layout || 'single';
            if (nTotal === 1) nLayout = 'single';
            else if (nTotal === 2) nLayout = (nLayout === 'v' ? 'v' : 'h');
            else nLayout = '2x2';
            return { ...t, panes: finalPanes, layout: nLayout, activePaneId: (active[0] || finalPanes[0]).id };
          }
          return t;
        }).filter(Boolean);
        return result;
      }

      // 병합이 아닌 단순 활성화 케이스
      return prev.map((t) => {
        if (t.id !== tabId) return t;
        const panes = (t.panes || []).map((p) => {
          if (p.id !== paneId) return p;
          if (p.sessionId || p.hostId) return p;
          // target.cwd 가 있으면 pane.cwd 에 저장 → Terminal 이 그 경로로 SSH/셸 시작
          const cwdPatch = target?.cwd ? { cwd: target.cwd } : {};
          if (target?.type === 'host' && target.hostId) {
            // 호스트의 기본 테마가 있으면 themeOverride 자동 적용 (연결 직후 chrome 까지 그 테마로).
            const h = hosts.find((hh) => hh.id === target.hostId);
            const themePatch = h?.theme ? { themeOverride: h.theme } : {};
            return { ...p, hostId: target.hostId, sessionId: undefined, ...cwdPatch, ...themePatch };
          }
          if (target?.type === 'local') {
            const themePatch = settings.localTheme ? { themeOverride: settings.localTheme } : {};
            return { ...p, sessionId: generateUUID(), hostId: undefined, ...cwdPatch, ...themePatch };
          }
          if (t.type === 'host') return { ...p, hostId: t.hostId, ...cwdPatch };
          return { ...p, sessionId: generateUUID(), ...cwdPatch };
        });
        return { ...t, panes, activePaneId: paneId };
      });
    });
  }, [hosts, settings.localTheme]);

  const closePane = useCallback((tabId, paneId) => {
    const tab = tabs.find((tt) => tt.id === tabId);
    const pane = tab?.panes?.find((p) => p.id === paneId);
    if (!tab || !pane) return;
    const paneIndex = tab.panes.findIndex((p) => p.id === paneId);

    const doClose = () => {
      setTabs((prev) => prev.map((t) => {
        if (t.id !== tabId) return t;
        const panes = t.panes || [];
        if (panes.length === 0) return t;       // 안전장치
        // 다중 pane → 해당 pane 제거 (단일 pane 케이스는 closeTab 으로 위임됨)
        const remaining = panes.filter((p) => p.id !== paneId);
        if (remaining.length === 0) return t;
        const activeCount = remaining.filter((p) => p.sessionId || p.hostId).length;
        const emptyCount = remaining.length - activeCount;
        let filled;
        if (activeCount === 0) {
          filled = [remaining[0]];
        } else if (activeCount <= 2 && emptyCount > 0) {
          filled = remaining.filter((p) => p.sessionId || p.hostId);
          if (filled.length === 1) filled = [filled[0]];
        } else if (activeCount === 3) {
          filled = [...remaining, makePane({})];
        } else {
          filled = remaining;
        }
        const layout = filled.length === 1 ? 'single' : (filled.length === 2 ? (t.layout === 'v' ? 'v' : 'h') : '2x2');
        const newActiveId = t.activePaneId === paneId
          ? (filled.find((p) => p.sessionId || p.hostId) || filled[0])?.id
          : t.activePaneId;
        return { ...t, panes: filled, layout, activePaneId: newActiveId };
      }));
      const token = localStorage.getItem('auth_token');
      // 로컬 세션 정리
      if (pane.sessionId && !pane.hostId) {
        fetch(`/api/sessions/${pane.sessionId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      // 호스트 pane → 자신의 원격 tmux 세션도 종료 (의도적 close = 영속 끝).
      // pane 0 도 포함 — 단일 pane 케이스는 이미 closeTab 으로 위임됐으니 여긴 항상 멀티 pane 의
      // 한 pane. 잔류 세션이 안 남게 자기 것은 자기가 죽임.
      if (pane.hostId) {
        const host = hosts.find((h) => h.id === pane.hostId);
        if (host?.use_remote_tmux) {
          const targetSession = computePaneTmuxSession(host, tab, pane, paneIndex);
          killRemoteTmuxSession(pane.hostId, targetSession);
        }
      }
    };

    const paneCount = tab.panes?.length || 0;
    const isEmpty = !pane.sessionId && !pane.hostId;

    // 단일 pane = 탭 자체 닫기로 위임. 빈 picker (새 탭) 든 활성 세션이든 동일.
    if (paneCount <= 1) {
      closeTabRef.current?.(tabId);
      return;
    }

    const isHost = !!pane.hostId;
    const host = isHost ? hosts.find((h) => h.id === pane.hostId) : null;
    const willPersist = isEmpty || !isHost /* local 항상 tmux */ || !!host?.use_remote_tmux;

    let title, message;
    if (isEmpty) {
      // 빈 pane (멀티 중) 제거
      title = t('removePane') || 'Remove pane';
      message = t('confirmRemoveEmptyPane') || 'Remove this empty pane?';
    } else {
      // 멀티 pane 중 하나 닫기
      title = t('closePane') || 'Close pane';
      message = willPersist
        ? (t('confirmClosePane') || 'Close this pane?')
        : (t('confirmClosePaneNoTmux') || 'Close this pane? Work will be lost (tmux off).');
    }

    setConfirmModal({
      isOpen: true,
      title,
      titleIcon: Columns3,
      message,
      onConfirm: doClose,
    });
  }, [tabs, t, hosts, computePaneTmuxSession, killRemoteTmuxSession]);

  const focusPane = useCallback((tabId, paneId) => {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, activePaneId: paneId } : t));
  }, []);

  // grid ↔ sub-tabs 보기 모드 토글 — 좁은 화면에서 4분할이 답답할 때 탭 형태로 전환.
  // panes.length > 1 일 때만 의미 있음. 모바일은 자동 sub-tabs 라 토글 별개로 적용.
  const toggleViewMode = useCallback((tabId) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const next = (t.viewMode === 'tabs') ? 'grid' : 'tabs';
      return { ...t, viewMode: next };
    }));
  }, []);

  // 분할 pane → 새 단독 탭으로 분리 (detach). 원본 탭은 closePane 과 동일한 후처리 적용
  // (3 panes 남으면 빈 pane 보충, 2 면 'h'/'v', 1 면 'single'). 빈 pane (sessionId/hostId 없음) 은
  // 추출 의미 없으므로 무시. 새 탭은 원본 바로 뒤에 삽입되고 즉시 활성화.
  const extractPaneToTab = useCallback((tabId, paneId) => {
    const src = tabs.find((tt) => tt.id === tabId);
    if (!src) return;
    const pane = src.panes?.find((p) => p.id === paneId);
    if (!pane || (!pane.sessionId && !pane.hostId)) return;

    // 새 탭/pane id 를 한 번만 계산 — setTabs 클로저에 캡처해 setActiveTabId 와 일관성 유지.
    const newPane = makePane({
      sessionId: pane.sessionId,
      hostId: pane.hostId,
      ...(pane.tmuxSessionName ? { tmuxSessionName: pane.tmuxSessionName } : null),
      ...(pane.themeOverride ? { themeOverride: pane.themeOverride } : null),
    });
    const newTabId = pane.hostId
      ? `host:${pane.hostId}:${Date.now()}:${newPane.id.slice(0, 6)}`
      : `local:${pane.sessionId}:${Date.now()}:${newPane.id.slice(0, 6)}`;

    setTabs((prev) => {
      const remaining = (src.panes || []).filter((p) => p.id !== paneId);
      const filled = remaining.length === 3 ? [...remaining, makePane({})] : remaining;
      const layout = filled.length === 1 ? 'single' : (filled.length === 2 ? (src.layout === 'v' ? 'v' : 'h') : '2x2');
      const trimmedSrc = {
        ...src,
        panes: filled,
        layout,
        activePaneId: filled[0]?.id || null,
      };
      const newTab = {
        id: newTabId,
        type: src.type,
        name: src.name,
        cwd: src.cwd ?? null,
        icon: src.icon || null,
        color_index: src.color_index ?? 0,
        panes: [newPane],
        layout: 'single',
        activePaneId: newPane.id,
        ...(src.hostId ? { hostId: src.hostId } : null),
        ...(src.tmuxSuffix ? { tmuxSuffix: src.tmuxSuffix } : null),
        ...(src.sessionId && src.type === 'local' ? { sessionId: pane.sessionId } : null),
      };
      const next = prev.map((t) => (t.id === tabId ? trimmedSrc : t));
      const idx = next.findIndex((t) => t.id === tabId);
      return [...next.slice(0, idx + 1), newTab, ...next.slice(idx + 1)];
    });
    setActiveTabId(newTabId);
  }, [tabs]);

  // 분할 pane 순서 변경 — subTabs 컨텍스트 메뉴(Move left/right) 에서 사용.
  // (tabId, fromPaneId, toPaneId) → 해당 탭의 panes 배열에서 fromPaneId 를 toPaneId 위치로 이동.
  const reorderPane = useCallback((tabId, fromPaneId, toPaneId) => {
    if (!fromPaneId || !toPaneId || fromPaneId === toPaneId) return;
    setTabs((prev) => prev.map((tt) => {
      if (tt.id !== tabId) return tt;
      const panes = tt.panes || [];
      const fromIdx = panes.findIndex((p) => p.id === fromPaneId);
      const toIdx = panes.findIndex((p) => p.id === toPaneId);
      if (fromIdx < 0 || toIdx < 0) return tt;
      const next = [...panes];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...tt, panes: next };
    }));
  }, []);

  const closeTab = useCallback((tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const doClose = () => {
      const idx = tabs.findIndex((t) => t.id === tabId);
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const fallback = remaining[Math.max(0, idx - 1)]?.id || remaining[0]?.id || null;
        setActiveTabId(fallback);
      }
      setTabs(remaining);
      // 닫기 = 영속 끝. 로컬은 백엔드 tmux 세션을, 호스트는 원격 tmux 세션을 모두 kill.
      // (의도적 close 인데 잔류 세션이 누적되어 Resumable 에 끝없이 쌓이는 문제 해결.)
      if (tab.type === 'local') {
        const token = localStorage.getItem('auth_token');
        const sessionIds = (tab.panes || [{ sessionId: tab.sessionId }])
          .map((p) => p.sessionId)
          .filter(Boolean);
        sessionIds.forEach((sid) => {
          fetch(`/api/sessions/${sid}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        });
      } else if (tab.type === 'host') {
        const host = hosts.find((h) => h.id === tab.hostId);
        if (host?.use_remote_tmux) {
          (tab.panes || [{}]).forEach((pane, idx2) => {
            const sess = computePaneTmuxSession(host, tab, pane, idx2);
            killRemoteTmuxSession(tab.hostId, sess);
          });
        }
      }
    };

    // 탭 안에 tmux 꺼진 호스트 pane 이 하나라도 있으면 경고 (작업 소실 가능)
    const hasNoTmuxPane = (tab.panes || []).some((p) => {
      if (!p.hostId) return false;
      const h = hosts.find((hh) => hh.id === p.hostId);
      return h && !h.use_remote_tmux;
    });
    const isPersistentHost = tab.type === 'host'
      && (hosts.find((h) => h.id === tab.hostId)?.use_remote_tmux);
    const paneCount = tab.panes?.length || 1;
    const baseMsg = hasNoTmuxPane
      ? (t('confirmCloseTabLossy') || 'Close this tab? Work in non-tmux sessions will be lost.')
      : isPersistentHost
        ? (t('confirmCloseTabTerminate') || 'Close this tab? The remote tmux session(s) will be terminated.')
        : (t('confirmCloseTab') || 'Close this tab?');
    const bodyMsg = paneCount > 1
      ? `${baseMsg} (${paneCount} ${t('panesInTab') || 'panes'})`
      : baseMsg;
    // 헤더 라인: #N · 탭이름 — 실수로 다른 탭 닫는 것 방지용
    const tabIdx = tabs.findIndex((tb) => tb.id === tabId);
    const tabNo = tabIdx >= 0 ? tabIdx + 1 : '?';
    const headerLine = `#${tabNo} · ${tab.name || 'terminal'}`;
    const message = `${headerLine}\n\n${bodyMsg}`;
    setConfirmModal({
      isOpen: true,
      title: t('closeTab') || 'Close tab',
      titleIcon: XCircle,
      message,
      onConfirm: doClose,
    });
  }, [tabs, activeTabId, t, hosts, computePaneTmuxSession, killRemoteTmuxSession]);

  useEffect(() => { closeTabRef.current = closeTab; }, [closeTab]);

  // ── new tab = open home picker (just go home) ─────────────────────────────
  const handleAddTab = useCallback(() => {
    setActiveTabId(null); // show home
  }, []);

  // ── cwd & git context ─────────────────────────────────────────────────────
  // 포커스된 pane 기준 — 같은 탭 안에서도 각 pane 의 cwd/git 이 다를 수 있으므로
  // RightPanel 은 활성 pane 을 따라간다.
  const focusedPane = useMemo(() => {
    if (!activeTab?.panes) return null;
    return activeTab.panes.find((p) => p.id === activeTab.activePaneId) || activeTab.panes[0] || null;
  }, [activeTab]);
  const isFocusedLocal = focusedPane && !focusedPane.hostId;
  const { workspaceRelative: activeCwdRel } = useActiveTerminalCwd({
    sessionId: isFocusedLocal ? focusedPane?.sessionId : null,
    isLocal: !!isFocusedLocal,
  });
  const gitContextPath = activeCwdRel ?? '';
  const focusedHostId = focusedPane?.hostId || null;

  // ── 자동 탭 이름 (Jupyter 식) ────────────────────────────────────────────
  // 활성 pane 의 cwd basename 으로 탭 이름 갱신. 호스트 탭/사용자가 직접 이름 박은 탭
  // (manualName=true) 은 건드리지 않는다.
  const handlePaneCwdChange = useCallback((paneId, workspaceRel, isLocalPane) => {
    if (!isLocalPane || !paneId) return;
    setTabs((prev) => prev.map((tb) => {
      if (tb.type !== 'local' || tb.manualName) return tb;
      // 활성 pane 만 반영 (다중 pane 일 때 비활성 pane 의 cwd 가 탭 이름 흔들지 않게).
      if (tb.activePaneId && tb.activePaneId !== paneId) return tb;
      const trimmed = (workspaceRel || '').replace(/\/+$/, '');
      const next = trimmed ? trimmed.split('/').pop() : (settings.localName || 'workspace');
      if (!next || next === tb.name) return tb;
      return { ...tb, name: next };
    }));
  }, [settings.localName]);

  // ── per-pane 테마 오버라이드 ─────────────────────────────────────────────
  // 우측 사이드바의 테마 픽커는 "이 터미널만" 적용 — 전역 settings.theme 은 안 건드림.
  // themeId === null 이면 override 해제 (전역 테마로 복귀).
  const handlePaneThemeChange = useCallback((paneId, themeId) => {
    if (!paneId) return;
    setTabs((prev) => prev.map((tb) => {
      if (!tb.panes?.some((p) => p.id === paneId)) return tb;
      return {
        ...tb,
        panes: tb.panes.map((p) => {
          if (p.id !== paneId) return p;
          if (!themeId) {
            // override 해제 — themeOverride 키 자체를 제거해 깨끗하게.
            const { themeOverride: _drop, ...rest } = p;
            return rest;
          }
          return { ...p, themeOverride: themeId };
        }),
      };
    }));
  }, []);

  // ── 탭 busy 인디케이터 (Jupyter 식 활동 점멸) ─────────────────────────────
  // Terminal.jsx 가 데이터 도착 시 'iterm:activity' 윈도우 이벤트를 paneId 와 함께
  // 디스패치 → 여기서 paneId → ts 맵에 기록 → 250ms 마다 만료 (>700ms 비활성) 검사 후
  // tabId 단위 busy 집합으로 변환. tabs 는 ref 로 잡아 stale closure 방지.
  const [busyTabIds, setBusyTabIds] = useState(() => new Set());
  const [busyPaneIds, setBusyPaneIds] = useState(() => new Set());
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => {
    const activity = new Map(); // paneId -> ts (ms)
    const onActivity = (e) => {
      const paneId = e?.detail?.paneId;
      if (paneId) activity.set(paneId, Date.now());
    };
    window.addEventListener('iterm:activity', onActivity);

    /* busy 유지 윈도우 — 마지막 출력 후 이만큼 동안은 busy 로 본다.
       3500ms = 출력 burst 사이 짧은 휴지(컴파일 단계 사이, 명령 prompt 대기 등)에는 끄지 않고
       유지 → 깜빡임 인지 줄임. 진짜 idle 이면 자연 fade. */
    const BUSY_WINDOW_MS = 3500;
    const tick = setInterval(() => {
      const now = Date.now();
      const busyPaneIds = new Set();
      for (const [pid, ts] of activity.entries()) {
        if (now - ts < BUSY_WINDOW_MS) busyPaneIds.add(pid);
        else activity.delete(pid);
      }
      setBusyPaneIds((prev) => {
        if (prev.size === busyPaneIds.size && [...prev].every((x) => busyPaneIds.has(x))) return prev;
        return busyPaneIds;
      });
      const next = new Set();
      for (const tb of tabsRef.current) {
        if (tb.panes?.some((p) => busyPaneIds.has(p.id))) next.add(tb.id);
      }
      setBusyTabIds((prev) => {
        if (prev.size === next.size && [...prev].every((x) => next.has(x))) return prev;
        return next;
      });
    }, 150);  /* 250ms → 150ms — busy 등장/소멸 인지를 1프레임 안으로 내림. */

    return () => {
      window.removeEventListener('iterm:activity', onActivity);
      clearInterval(tick);
    };
  }, []);

  // ── UI state ──────────────────────────────────────────────────────────────
  // isMobile 초기값을 동기적으로 결정 — Hard refresh 직후 1프레임 동안 PC fontSize 로
  // 렌더되던 깜박임 제거. effectiveSettings.fontSize 가 처음부터 mobile 값으로 잡혀
  // xterm 이 mount 시점부터 올바른 사이즈로 그려진다.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isMobileUA = /iPhone|iPad|iPod|Android/i.test(ua);
    const isNarrow = window.innerWidth < 768;
    return isMobileUA || isNarrow;
  });
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hostEditorState, setHostEditorState] = useState({ isOpen: false, host: null });
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [hostManagerOpen, setHostManagerOpen] = useState(false);
  /* 폴더 픽커 컨텍스트 — { host, slot? } 형태.
     slot 이 있으면 (tabId/paneId) 그 빈 pane 을 채움 (split 케이스).
     slot 없으면 새 탭으로 openHostTab (홈 대시보드 케이스). */
  const [folderPickerHost, setFolderPickerHost] = useState(null);
  const [folderPickerSlot, setFolderPickerSlot] = useState(null);
  const [localEditorOpen, setLocalEditorOpen] = useState(false);
  const [localFolderPicker, setLocalFolderPicker] = useState({
    open: false,
    initial: '',
    onPick: null,
  });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [notification, setNotification] = useState({ isOpen: false, message: '' });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // SSH keyboard-interactive prompt 가 열려 있는지 — 모바일 단축키바 가림 처리.
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  useEffect(() => {
    const onPrompt = (e) => setAuthPromptOpen(!!e.detail?.open);
    window.addEventListener('iterm:auth-prompt', onPrompt);
    return () => window.removeEventListener('iterm:auth-prompt', onPrompt);
  }, []);

  // File editor
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [editorHeight, setEditorHeight] = useState(() => parseInt(localStorage.getItem('editor_height') || '400'));
  const [isResizingEditor, setIsResizingEditor] = useState(false);

  // Terminal search
  const [isTerminalSearchOpen, setIsTerminalSearchOpen] = useState(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('');
  const [terminalSearchStatus, setTerminalSearchStatus] = useState('');
  const terminalSearchInputRef = useRef(null);

  // Command palette / file picker
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState('');
  const [filePickerItems, setFilePickerItems] = useState([]);
  const [isFilePickerLoading, setIsFilePickerLoading] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const [commandInputOpen, setCommandInputOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [screenDumpText, setScreenDumpText] = useState(null);

  // 활성 viewport 기준 effective settings — fontSize 를 PC/모바일 분리. 자식들
  // (PaneGrid, Terminal) 은 settings.fontSize 만 보면 자동으로 알맞은 값 적용.
  const effectiveSettings = useMemo(() => {
    // isMobile 이 true 면 fontSizeMobile 을, false 면 fontSize 를 사용.
    // null-ish coalescing 으로 기본값(13/12) 보장.
    const size = isMobile
      ? (settings.fontSizeMobile ?? 13)
      : (settings.fontSize ?? 12);
    return { ...settings, fontSize: size };
  }, [settings, isMobile]);

  // ── responsive ────────────────────────────────────────────────────────────
  useEffect(() => {
    let viewportRaf = 0;
    const check = () => {
      const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const isNarrow = window.innerWidth < 768;
      const m = isMobileUA || isNarrow;
      if (isMobileViewportRef.current !== m) setIsMobile(m);
      isMobileViewportRef.current = m;
    };

    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);

    // visualViewport — 가시 영역 높이 + offsetTop 트래킹.
    // iOS Safari 는 viewport meta 의 interactive-widget=resizes-content 를 무시한다.
    // 키보드가 올라오면 visualViewport.height 만 줄어들고 layout viewport 는 그대로라서
    // position:fixed; inset:0 가 키보드 영역까지 덮음 → CommandInput 모달이 키보드에 가림.
    // 여기서 visualViewport 값을 state/CSS 변수로 노출해 외곽 컨테이너와 모달이 가시 영역에
    // 맞춰 줄어들도록 한다.
    const handleVV = () => {
      if (viewportRaf) return;
      viewportRaf = requestAnimationFrame(() => {
        viewportRaf = 0;
        const vv = window.visualViewport;
        if (vv) {
          if (vv.offsetTop > 0 || window.scrollY > 0) {
            window.scrollTo(0, 0);
          }
          setViewportHeight(vv.height);
          document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
          document.documentElement.style.setProperty('--vvt', `${vv.offsetTop}px`);
        }
        check();
      });
    };
    // 최초 1회 — mount 시점 visualViewport 값을 CSS 변수에 반영.
    if (window.visualViewport) {
      document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
      document.documentElement.style.setProperty('--vvt', `${window.visualViewport.offsetTop}px`);
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVV);
      window.visualViewport.addEventListener('scroll', handleVV);
    }
    
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      if (viewportRaf) cancelAnimationFrame(viewportRaf);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVV);
        window.visualViewport.removeEventListener('scroll', handleVV);
      }
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem('editor_height', editorHeight.toString()), 150);
    return () => clearTimeout(id);
  }, [editorHeight]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handleLogoutRequest = () => setConfirmModal({
    isOpen: true,
    title: t('confirmLogout'),
    titleIcon: LogOut,
    message: t('logoutMessage'),
    onConfirm: logout,
  });

  const handleConfirmModal = async () => {
    await confirmModal.onConfirm?.();
    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
  };

  const focusActiveTerminal = useCallback(() => {
    if (activeTab?.sessionId) window.terminalSessions?.[activeTab.sessionId]?.focus?.();
    else if (activeTab?.id) window.terminalSessions?.[activeTab.id]?.focus?.();
  }, [activeTab]);

  const handleFileOpen = (path, hostId = null) => {
    const fileKey = hostId ? `remote:${hostId}:${path}` : path;
    if (!openFiles.includes(fileKey)) setOpenFiles((prev) => [...prev, fileKey]);
    setActiveFile(fileKey);
  };

  const handleFileClose = (path) => {
    const next = openFiles.filter((f) => f !== path);
    setOpenFiles(next);
    if (activeFile === path) setActiveFile(next[next.length - 1] || null);
  };

  const openFilePicker = useCallback(() => {
    setFilePickerQuery('');
    setFilePickerItems(openFiles.map((p) => ({ id: `recent:${p}`, path: p, label: p })));
    setIsFilePickerOpen(true);
  }, [openFiles]);

  const openTerminalSearch = useCallback(() => {
    setTerminalSearchStatus('');
    setIsTerminalSearchOpen(true);
    setTimeout(() => terminalSearchInputRef.current?.focus(), 20);
  }, []);

  const closeTerminalSearch = useCallback(() => {
    setIsTerminalSearchOpen(false);
    setTerminalSearchStatus('');
    const key = activeTab?.sessionId || activeTab?.id;
    window.terminalSessions?.[key]?.closeSearch?.();
  }, [activeTab]);

  const executeTerminalSearch = useCallback((dir = 'next') => {
    if (!terminalSearchQuery.trim()) return;
    const key = activeTab?.sessionId || activeTab?.id;
    const api = window.terminalSessions?.[key];
    if (!api) return;
    const matched = dir === 'previous'
      ? api.searchPrevious?.(terminalSearchQuery, {}) || false
      : api.searchNext?.(terminalSearchQuery, {}) || false;
    setTerminalSearchStatus(matched ? t('searchMatchFound') : t('searchNoResults'));
  }, [activeTab, terminalSearchQuery, t]);

  // editor resize
  const onEditorResizeStart = (e) => {
    if (e.preventDefault && e.cancelable !== false) e.preventDefault();
    setIsResizingEditor(true);
    const startY = e.clientY || e.touches?.[0]?.clientY;
    const startH = editorHeight;
    let resizeRaf = 0;
    let nextHeight = startH;
    const onMove = (me) => {
      const y = me.clientY || me.touches?.[0]?.clientY;
      nextHeight = Math.max(150, Math.min(window.innerHeight - 150, startH + y - startY));
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        setEditorHeight(nextHeight);
      });
    };
    const onUp = () => {
      setIsResizingEditor(false);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      setEditorHeight(nextHeight);
      localStorage.setItem('editor_height', nextHeight.toString());
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
  };

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isForm = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.classList.contains('xterm-helper-textarea')) return false;
      const t = el.tagName.toLowerCase();
      return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
    };

    const onKey = (e) => {
      if (isForm(e.target) || isCommandPaletteOpen || isTerminalSearchOpen || isFilePickerOpen) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); setIsCommandPaletteOpen(true); return; }
      if (ctrl && e.key === 'p') { e.preventDefault(); openFilePicker(); return; }
      if (ctrl && e.key === ',') { e.preventDefault(); setIsSettingsOpen(true); return; }
      if (ctrl && e.key === 't') { e.preventDefault(); handleAddTab(); return; }
      if (ctrl && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        splitActivePane(e.shiftKey ? 'v' : 'h');
        return;
      }
      if (ctrl && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }
      // Ctrl/Cmd + 1..9 → 해당 인덱스 탭으로 전환 (탭 좌측의 번호와 짝)
      if (ctrl && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const target = tabs[idx];
        if (target) {
          e.preventDefault();
          setActiveTabId(target.id);
        }
        return;
      }
    };

    const onSearch = (ev) => {
      const key = activeTab?.sessionId || activeTab?.id;
      if (!ev.detail?.sessionId || ev.detail.sessionId !== key) return;
      openTerminalSearch();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('terminal:open-search', onSearch);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('terminal:open-search', onSearch); };
  }, [isCommandPaletteOpen, isTerminalSearchOpen, isFilePickerOpen, openFilePicker, openTerminalSearch, handleAddTab, activeTabId, activeTab, closeTab, splitActivePane, tabs]);  // splitActivePane 은 deps 비어 있어 stable

  useEffect(() => { setTerminalSearchStatus(''); }, [terminalSearchQuery]);

  useEffect(() => {
    if (!isTerminalSearchOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeTerminalSearch(); focusActiveTerminal(); }
      if (e.key === 'Enter') { e.preventDefault(); executeTerminalSearch(e.shiftKey ? 'previous' : 'next'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTerminalSearchOpen, closeTerminalSearch, focusActiveTerminal, executeTerminalSearch]);

  // 워크스페이스 파일 인덱스 — 한 번 받아서 메모리 캐시 (TTL 60s).
  // ufuzzy 로 클라이언트 매칭 → 키 입력 즉시 결과 (서버 왕복 0).
  const fileIndexRef = useRef({ files: [], ts: 0, truncated: false });
  const ufuzzyRef = useRef(null);
  if (!ufuzzyRef.current) {
    ufuzzyRef.current = new uFuzzy({ intraMode: 1, intraIns: 1 });
  }
  const ensureFileIndex = useCallback(async (force = false) => {
    const now = Date.now() / 1000;
    if (!force && fileIndexRef.current.files.length && now - fileIndexRef.current.ts < 60) {
      return fileIndexRef.current;
    }
    try {
      const token = localStorage.getItem('auth_token');
      const r = await fetch('/api/files/index', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return fileIndexRef.current;
      const data = await r.json();
      fileIndexRef.current = { files: data.files || [], ts: now, truncated: !!data.truncated };
    } catch { /* 오프라인 — 다음 호출에서 재시도 */ }
    return fileIndexRef.current;
  }, []);

  // file picker search — ufuzzy 로 클라이언트 매칭.
  // 큰 인덱스 (>10k) 에서도 sub-ms 수준이라 debounce 거의 불필요.
  useEffect(() => {
    if (!isFilePickerOpen) return;
    const query = filePickerQuery.trim();
    if (!query) {
      setFilePickerItems(openFiles.map((p) => ({ id: `recent:${p}`, path: p, label: p })));
      return;
    }
    let cancelled = false;
    setIsFilePickerLoading(true);
    (async () => {
      const index = await ensureFileIndex();
      if (cancelled) return;
      const haystack = index.files;
      if (!haystack.length) {
        // 인덱스 비었으면 레거시 서버 검색으로 폴백 (대용량 워크스페이스 truncated 케이스 등)
        try {
          const token = localStorage.getItem('auth_token');
          const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}&limit=200`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!cancelled) {
            setFilePickerItems((data.items || []).map((item) => ({ id: `s:${item.path}`, path: item.path, label: item.path })));
          }
        } catch { /* noop */ }
        if (!cancelled) setIsFilePickerLoading(false);
        return;
      }
      const uf = ufuzzyRef.current;
      const idxs = uf.filter(haystack, query);
      if (!idxs || idxs.length === 0) {
        if (!cancelled) {
          setFilePickerItems([]);
          setIsFilePickerLoading(false);
        }
        return;
      }
      const info = uf.info(idxs, haystack, query);
      const order = uf.sort(info, haystack, query);
      const limited = order.slice(0, 200);
      const items = limited.map((oi) => {
        const path = haystack[info.idx[oi]];
        return { id: `s:${path}`, path, label: path };
      });
      if (!cancelled) {
        setFilePickerItems(items);
        setIsFilePickerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isFilePickerOpen, filePickerQuery, openFiles, ensureFileIndex]);

  // 파일 picker 가 열리는 즉시 인덱스 워밍업 (첫 입력 전에 받아두기)
  useEffect(() => {
    if (isFilePickerOpen) ensureFileIndex();
  }, [isFilePickerOpen, ensureFileIndex]);

  // ── terminal key for session registry ─────────────────────────────────────
  // Terminal.jsx 는 `sessionId={pane.sessionId || pane.id}` 로 등록한다.
  // → 호스트 pane 은 pane.id (UUID) 로, 로컬 pane 은 pane.sessionId 로 등록.
  // 기존엔 activeTab.id 를 봤기 때문에 host 탭에선 lookup 이 항상 실패해서
  // MobileToolbar 의 단축키가 sendData 를 못 호출했다.
  const terminalKey = focusedPane
    ? (focusedPane.sessionId || focusedPane.id)
    : (activeTab?.sessionId || activeTab?.id || null);
  const terminalLayoutSignal = `tab:${activeTabId}:editor:${activeFile ? editorHeight : 0}`;

  // ── guards ────────────────────────────────────────────────────────────────
  if (isLoading) return <LoadingScreen currentTheme={currentTheme} t={t} />;
  if (needsSetup) return <LazyErrorBoundary><Suspense fallback={null}><InitialSetup onComplete={completeSetup} language={settings.language} /></Suspense></LazyErrorBoundary>;
  if (!isAuthenticated) return <LazyErrorBoundary><Suspense fallback={null}><Login onLogin={login} language={settings.language} theme={currentTheme} /></Suspense></LazyErrorBoundary>;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      // 모바일에선 visualViewport.height 를 우선 (iOS 키보드/주소표시줄 대응).
      // 데스크탑은 100% 유지 — visualViewport 가 없어도 영향 없음.
      height: isMobile ? 'var(--vvh, 100%)' : '100%',
      width: '100%',
      background: currentTheme.ui.bg,
      overflow: 'hidden',
      fontFamily: font.sans,
    }}>
      <style>{`
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
        #root {
          position: fixed;
          inset: 0;
          overflow: hidden;
        }

        * { scrollbar-width: thin; scrollbar-color: ${currentTheme.ui.bgTertiary} transparent; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${currentTheme.ui.bgTertiary}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${currentTheme.ui.accent}88; }
        /* xterm 스크롤바 — 핵심: xterm.css 기본값이 'overflow-y: scroll' 이라 *항상* gutter 가
           예약돼서 TUI 가 그 폭만큼 짧게 그려진다 (opencode 등이 가득 안 차는 이유).
           해법:
             1) overflow-y: auto — 콘텐츠 넘칠 때만 스크롤바, 안 보이면 gutter 없음.
             2) scrollbar-gutter: auto — gutter 예약 명시적 해제 (기본값이지만 일부 vendor 보정용).
             3) scrollbar-width / -ms-overflow-style — Firefox + IE/Edge legacy.
             4) ::-webkit-scrollbar 모두 display:none + appearance:none — Chrome/Safari overlay 까지.
           가로 스크롤은 항상 hidden — xterm 은 cols 정확히 fit 해서 가로 overflow 가 절대 없어야 함. */
        .xterm,
        .xterm *,
        .xterm-viewport,
        .xterm-screen,
        .xterm-scroll-area {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        .xterm-viewport {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          scrollbar-gutter: auto !important;
        }
        .xterm::-webkit-scrollbar,
        .xterm *::-webkit-scrollbar,
        .xterm-viewport::-webkit-scrollbar,
        .xterm-viewport::-webkit-scrollbar-track,
        .xterm-viewport::-webkit-scrollbar-thumb,
        .xterm-viewport::-webkit-scrollbar-corner {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
          -webkit-appearance: none !important;
          appearance: none !important;
        }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }

        /* 모바일 모달 풀스크린 — 768px 이하면 모달이 전체 화면을 진짜 다 차지.
           inline transform/maxWidth/maxHeight 가 있어도 !important 로 reset.
           스크롤바도 트랙 폭 0 으로 사라지게 (콘텐츠는 스크롤 가능). */
        @media (max-width: 768px) {
          .iterm-modal-card {
            width: 100vw !important;
            height: 100% !important;
            max-width: 100vw !important;
            max-height: 100% !important;
            top: 0 !important;
            left: 0 !important;
            transform: none !important;
            border-radius: 0 !important;
            border: none !important;
          }
          .iterm-no-scrollbar { scrollbar-width: none; }
          .iterm-no-scrollbar::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        }
      `}</style>

      {/* ── 단일 상단 바: 홈 + 탭 + 액션 (호스트 / SSH 키 / 설정 / 로그아웃) ── */}
      <TabBar
        tabs={tabsWithMeta}
        activeTabId={activeTabId}
        isMobile={isMobile}
        busyTabIds={busyTabIds}
        onReorder={(fromId, toId) => {
          if (!fromId || !toId || fromId === toId) return;
          setTabs((prev) => {
            const ids = prev.map((tt) => tt.id);
            const fromIdx = ids.indexOf(fromId);
            const toIdx = ids.indexOf(toId);
            if (fromIdx < 0 || toIdx < 0) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return next;
          });
        }}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onToggleViewMode={toggleViewMode}
        onHome={() => setActiveTabId(null)}
        onOpenHosts={() => setHostManagerOpen(true)}
        onOpenKeys={() => { setEditingKey(null); setKeyManagerOpen(true); }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={handleLogoutRequest}
        onSplit={splitActivePane}
        onDuplicate={(tabId) => {
          const src = tabs.find((tt) => tt.id === tabId);
          if (!src) return;
          if (src.type === 'host') {
            const h = hosts.find((hh) => hh.id === src.hostId);
            if (h) openHostTab(h, src.cwd ?? null);
          } else {
            // src.cwd 가 비어 있으면 탭의 활성 pane cwd 를 추적해 재현. 단순화 — tab.cwd 우선,
            // 없으면 settings.localStartPath 폴백 (openLocalTab 의 기본 동작).
            openLocalTab(src.cwd ?? null);
          }
        }}
        canSplit={!!activeTab && (activeTab.panes?.length || 1) < 4}
        t={t}
      />

      {/* ── main body ── 모든 탭의 PaneGrid 를 stack 으로 마운트 (xterm 보존 → scrollback/사이즈 유지).
          단, 비활성 탭의 *WebSocket 은 lazy* — Terminal.jsx 가 isActive 에 따라 WS open/close.
          그래서 멀티 디바이스에서도 한 시점에 한 탭만 attach → takeover 폭주 X.
          탭 전환 시 xterm 은 그대로라 사이즈 jitter 없음, scrollback 도 그대로. */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>

          {/* 홈 — activeTabId === null 일 때만 visible. visibility 로 토글해 layout 안 흔들리게. */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex',
            flexDirection: 'column', overflow: 'hidden',
            visibility: activeTabId === null ? 'visible' : 'hidden',
            opacity: activeTabId === null ? 1 : 0,
            pointerEvents: activeTabId === null ? 'auto' : 'none',
            zIndex: activeTabId === null ? 1 : 0,
          }}>
            <HomeDashboard
              hosts={hosts}
              localCard={{
                name: (settings.localName || '').trim() || (t('thisMachine') || 'This machine'),
                icon: settings.localIcon || '',
                accent: designTokens.color.dotPalette[
                  (settings.localColorIndex ?? 0) % designTokens.color.dotPalette.length
                ],
                startPath: settings.localStartPath || '',
              }}
              onOpenHost={openHostTab}
              refreshHosts={refreshHosts}
              onOpenHostAtPath={(h) => setFolderPickerHost(h)}
              onEditLocal={() => setLocalEditorOpen(true)}
              onPickLocalPath={() => setLocalFolderPicker({
                open: true,
                initial: settings.localStartPath || '',
                onPick: (chosen) => openLocalTab(chosen),
              })}
              onAddHost={() => setHostEditorState({ isOpen: true, host: null })}
              onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
              onDeleteHost={async (h) => { await deleteHost(h.id); await refreshHosts(); }}
              onOpenSettings={() => setIsSettingsOpen(true)}
              tabs={tabsWithMeta}
              busyTabIds={busyTabIds}
              onJumpTab={(tabId) => setActiveTabId(tabId)}
              onResumeHostSession={(host, sessionName) => openHostTab(host, null, sessionName)}
              onTerminateHostSession={async (host, sessionName) => {
                const token = localStorage.getItem('auth_token');
                const res = await fetch(`/api/hosts/${host.id}/kill-tmux?session=${encodeURIComponent(sessionName)}`, {
                  method: 'POST', headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) {
                  const detail = await res.text().catch(() => '');
                  throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
                }
              }}
              onConfirm={(opts) => setConfirmModal({ isOpen: true, ...opts })}
              onNotify={(message) => setNotification({ isOpen: true, message })}
              t={t}
              settings={settings}
            />
          </div>

          {/* 각 탭의 PaneGrid — 항상 마운트, 활성만 visible. WS 는 Terminal 안에서 lazy. */}
          {tabs.map((tab) => {
            const isThisActive = tab.id === activeTabId;
            const tabCwd = tab?.type === 'local'
              ? (tab?.cwd ?? (settings.localStartPath || null))
              : (tab?.cwd ?? null);
            /* 활성 탭에만 editor 높이 반영. layoutSignal 변하면 그 탭의 fit 트리거.
               layout + paneCount 도 포함 — split 닫기/추가 시 grid 차원 변화에 맞춰 모든 pane 의
               Terminal 이 다시 fit() 호출하도록. (없으면 닫기 후 화면 크기 안 맞아 깨짐.)
               viewportHeight 도 포함 — iOS 키보드 올라와 visualViewport 가 줄어들 때 즉시 fit.
               (ResizeObserver 도 깨우지만 350ms debounce 가 있어 사용자 체감은 layoutSignal 경로가 빠름.) */
            const tabLayoutSignal = `tab:${tab.id}:editor:${isThisActive && activeFile ? editorHeight : 0}:active:${isThisActive ? 1 : 0}:layout:${tab.layout || 'single'}:n:${tab.panes?.length || 1}:vh:${isMobile ? Math.round(viewportHeight) : 0}`;
            return (
              <div
                key={tab.id}
                style={{
                  position: 'absolute', inset: 0,
                  /* display:none ↔ flex 토글은 ResizeObserver 를 깨워 fit/redraw 가 다시 일어나
                     탭 전환마다 화면 flicker. visibility/opacity/pointer-events 로 가리면 layout
                     안 변해 ResizeObserver 안 짖음 → xterm 이 그대로 정지된 그림 그대로 살아있음. */
                  display: 'flex',
                  flexDirection: 'column', overflow: 'hidden',
                  visibility: isThisActive ? 'visible' : 'hidden',
                  opacity: isThisActive ? 1 : 0,
                  pointerEvents: isThisActive ? 'auto' : 'none',
                  zIndex: isThisActive ? 1 : 0,
                }}
                aria-hidden={!isThisActive}
              >
                {isThisActive && activeFile && (
                  <div style={{ height: `${editorHeight}px`, flexShrink: 0, position: 'relative', minHeight: '150px', zIndex: 10 }}>
                    <LazyErrorBoundary><Suspense fallback={null}>
                      <FileEditor
                        activeFile={activeFile}
                        openFiles={openFiles}
                        onFileSelect={handleFileOpen}
                        onClose={handleFileClose}
                        theme={currentTheme}
                        language={settings.language}
                        onResizeStart={onEditorResizeStart}
                      />
                    </Suspense></LazyErrorBoundary>
                  </div>
                )}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: '150px' }}>
                  <PaneErrorBoundary>
                  <PaneGrid
                    tab={tab}
                    allTabs={tabsWithMeta}
                    hosts={hosts}
                    isActive={isThisActive}
                    isMobile={isMobile}
                    onFocusPane={focusPane}
                    onClosePane={closePane}
                    onActivatePane={activatePane}
                    onExtractPaneToTab={extractPaneToTab}
                    onReorderPane={reorderPane}
                    onPaneCwdChange={handlePaneCwdChange}
                    onPaneThemeChange={handlePaneThemeChange}
                    layoutSignal={tabLayoutSignal}
                    settings={effectiveSettings}
                    updateSettings={updateSettings}
                    cwd={tabCwd}
                    onFileSelect={handleFileOpen}
                    onFolderSelect={setSelectedFolderPath}
                    onOpenTerminalAtFolder={(path, hostId = null) => {
                      if (hostId) {
                        const host = hosts.find((h) => h.id === hostId);
                        if (host) { openHostTab(host, path); return; }
                      }
                      const sessionId = generateUUID();
                      const name = path.split('/').pop() || (settings.localName || 'terminal');
                      const newTab = makLocalTab(sessionId, name, path, {
                        icon: settings.localIcon || null,
                        colorIndex: settings.localColorIndex ?? 0,
                      });
                      setTabs((prev) => [...prev, newTab]);
                      setActiveTabId(newTab.id);
                    }}
                    language={settings.language}
                    t={t}
                    viewportHeight={viewportHeight}
                    onScreenDump={(text) => setScreenDumpText(text || '— empty —')}
                    /* EmptyPane → 내부 Resumable 카드의 종료 confirm 을 표준 ConfirmModal 로. */
                    onConfirm={(opts) => setConfirmModal({ isOpen: true, ...opts })}
                    onNotify={(message) => setNotification({ isOpen: true, message })}
                    onResumeHostSession={(host, sessionName) => openHostTab(host, null, sessionName)}
                    onTerminateHostSession={async (host, sessionName) => {
                      const token = localStorage.getItem('auth_token');
                      const res = await fetch(`/api/hosts/${host.id}/kill-tmux?session=${encodeURIComponent(sessionName)}`, {
                        method: 'POST', headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!res.ok) {
                        const detail = await res.text().catch(() => '');
                        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
                      }
                    }}
                    busyTabIds={busyTabIds}
                    busyPaneIds={busyPaneIds}
                    /* EmptyPane Connections → 폴더 픽커. slot (tabId/paneId) 같이 넘겨 빈 슬롯에 채움. */
                    onPickHostPath={(h, slot) => { setFolderPickerHost(h); setFolderPickerSlot(slot || null); }}
                    onPickLocalPath={(slot) => setLocalFolderPicker({
                      open: true,
                      initial: settings.localStartPath || '',
                      onPick: (chosen) => {
                        if (slot?.tabId && slot?.paneId) {
                          activatePane(slot.tabId, slot.paneId, { type: 'local', cwd: chosen });
                        }
                      },
                    })}
                    onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
                    onEditLocal={() => setLocalEditorOpen(true)}
                    refreshHosts={refreshHosts}
                  />
                  </PaneErrorBoundary>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── terminal search overlay ── */}
      {isTerminalSearchOpen && (
        <div style={{
          position: 'absolute', top: '80px', right: '56px', zIndex: 1002,
          width: '360px', display: 'flex', alignItems: 'center', gap: '6px',
          background: currentTheme.ui.bgSecondary,
          border: `1px solid ${currentTheme.ui.border}`,
          borderRadius: '6px', padding: '6px',
          boxShadow: currentTheme.ui.shadow,
        }}>
          <input
            ref={terminalSearchInputRef}
            value={terminalSearchQuery}
            onChange={(e) => setTerminalSearchQuery(e.target.value)}
            placeholder={t('findInTerminal')}
            style={{
              flex: 1, height: '30px',
              border: `1px solid ${currentTheme.ui.borderLight}`, borderRadius: '4px',
              background: currentTheme.ui.bg, color: currentTheme.ui.text,
              padding: '0 10px', outline: 'none', fontSize: '13px',
            }}
          />
          <span style={{ fontSize: '11px', color: terminalSearchStatus === t('searchNoResults') ? currentTheme.red : currentTheme.ui.textSecondary, minWidth: '80px', textAlign: 'center' }}>
            {terminalSearchStatus}
          </span>
          <button onClick={() => executeTerminalSearch('previous')} style={searchBtnStyle(currentTheme)}>↑</button>
          <button onClick={() => executeTerminalSearch('next')} style={searchBtnStyle(currentTheme)}>↓</button>
          <button onClick={() => { closeTerminalSearch(); focusActiveTerminal(); }} style={searchBtnStyle(currentTheme)}>✕</button>
        </div>
      )}

      {/* ── mobile toolbar ──
          빈 pane (picker 상태) 이면 키 보낼 곳이 없어서 어차피 동작 안 함 → 숨김.
          SSH 2FA 인증 prompt 열려 있을 때도 키보드와 같이 따라 올라와 모달 가리므로 숨김. */}
      {isMobile && activeTabId !== null && !!focusedPane && (focusedPane.sessionId || focusedPane.hostId) && !authPromptOpen && (
        <LazyErrorBoundary><Suspense fallback={null}>
          <MobileToolbar
            onSendKey={(key) => window.terminalSessions?.[terminalKey]?.sendData?.(key)}
            onOpenCommandInput={() => setCommandInputOpen(true)}
            onAction={(type) => {
              const session = window.terminalSessions?.[terminalKey];
              if (!session) return;
              if (type === 'copy') {
                const sel = session.getSelection?.();
                if (sel) {
                  navigator.clipboard.writeText(sel).then(() => {
                    setNotification({ isOpen: true, message: t('copied'), type: 'success' });
                  });
                } else {
                  setNotification({ isOpen: true, message: t('noSelection') || 'No text selected', type: 'info' });
                }
              } else if (type === 'copyAll') {
                const text = session.getBufferText?.() || '';
                if (text) {
                  navigator.clipboard.writeText(text).then(() => {
                    setNotification({ isOpen: true, message: t('copied'), type: 'success' });
                  });
                }
              }
            }}
            language={settings.language}
            keys={settings.mobileKeys}
          />
        </Suspense></LazyErrorBoundary>
      )}

      {/* ── screen dump modal — 모바일에서 터미널 텍스트 자유 선택/복사 ── */}
      {screenDumpText && (
        <LazyErrorBoundary><Suspense fallback={null}>
          <ScreenDumpModal
            text={screenDumpText}
            onClose={() => setScreenDumpText(null)}
            t={t}
          />
        </Suspense></LazyErrorBoundary>
      )}

      {/* ── command input (모바일 한글 IME 우회) ── */}
      {commandInputOpen && (
        <LazyErrorBoundary><Suspense fallback={null}>
          <CommandInput
            isOpen={commandInputOpen}
            onClose={() => setCommandInputOpen(false)}
            onSend={(cmd) => {
              window.terminalSessions?.[terminalKey]?.sendData?.(cmd + '\r');
              setCommandText('');
            }}
            command={commandText}
            setCommand={setCommandText}
            t={t}
          />
        </Suspense></LazyErrorBoundary>
      )}

      {/* ── host manager modal (top action) ── */}
      <HostManager
        isOpen={hostManagerOpen}
        onClose={() => setHostManagerOpen(false)}
        hosts={hosts}
        localStartPath={settings.localStartPath || ''}
        refreshHosts={refreshHosts}
        onAdd={() => { setHostManagerOpen(false); setHostEditorState({ isOpen: true, host: null }); }}
        onEdit={(h) => { setHostManagerOpen(false); setHostEditorState({ isOpen: true, host: h }); }}
        onConnect={(h) => { setHostManagerOpen(false); openHostTab(h); }}
        t={t}
      />

      {/* ── remote folder picker (open-at-path) ── */}
      <RemoteFolderPicker
        isOpen={!!folderPickerHost}
        host={folderPickerHost}
        onClose={() => { setFolderPickerHost(null); setFolderPickerSlot(null); }}
        onPick={async (chosen) => {
          const host = folderPickerHost;
          const slot = folderPickerSlot;
          setFolderPickerHost(null);
          setFolderPickerSlot(null);
          if (!host || !chosen) return;
          try {
            const token = localStorage.getItem('auth_token');
            await fetch(`/api/hosts/${host.id}/last-cwd`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ cwd: chosen }),
            });
          } catch {
            // 무시 — 갱신 실패해도 cwd 는 WS 로 직접 전달
          }
          if (slot?.tabId && slot?.paneId) {
            // split 한 빈 pane 채우기 — 새 탭 X.
            activatePane(slot.tabId, slot.paneId, { type: 'host', hostId: host.id, cwd: chosen });
          } else {
            // 홈 대시보드 케이스 — 새 탭으로 열기.
            openHostTab(host, chosen);
          }
          refreshHosts();
        }}
        t={t}
      />

      {/* ── local machine editor ── */}
      <LocalEditor
        isOpen={localEditorOpen}
        settings={settings}
        onSave={(patch) => updateSettings(patch)}
        onClose={() => setLocalEditorOpen(false)}
        onPickFolder={(initial, applyChosen) => setLocalFolderPicker({
          open: true,
          initial: initial || '',
          onPick: (chosen) => applyChosen?.(chosen),
        })}
        t={t}
      />

      {/* ── local workspace folder picker ── */}
      <LocalFolderPicker
        isOpen={localFolderPicker.open}
        initialPath={localFolderPicker.initial}
        onClose={() => setLocalFolderPicker({ open: false, initial: '', onPick: null })}
        onPick={(chosen) => {
          const fn = localFolderPicker.onPick;
          setLocalFolderPicker({ open: false, initial: '', onPick: null });
          fn?.(chosen);
        }}
        t={t}
      />

      {/* ── modals ── */}
      <LazyErrorBoundary><Suspense fallback={null}>
        {isSettingsOpen && (
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSave={updateSettings}
            username={username}
            hosts={hosts}
            sshKeys={sshKeys}
            refreshHosts={refreshHosts}
            onAddHost={() => setHostEditorState({ isOpen: true, host: null })}
            onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
            onAddKey={() => { setEditingKey(null); setKeyManagerOpen(true); }}
            onEditKey={(k) => { setEditingKey(k); setKeyManagerOpen(true); }}
            onLogout={() => { setIsSettingsOpen(false); logout?.(); }}
            t={t}
            language={settings.language}
          />
        )}
        {keyManagerOpen && (
          <SshKeyManager
            isOpen={keyManagerOpen}
            onClose={() => { setKeyManagerOpen(false); setEditingKey(null); }}
            keys={sshKeys}
            onCreate={createKey}
            onUpdate={updateKey}
            onDelete={deleteKey}
            initialEditKey={editingKey}
            t={t}
            language={settings.language}
          />
        )}
        {hostEditorState.isOpen && (
          <HostEditor
            isOpen={hostEditorState.isOpen}
            host={hostEditorState.host}
            sshKeys={sshKeys}
            onSave={async (data) => {
              if (hostEditorState.host) await updateHost(hostEditorState.host.id, data);
              else await createHost(data);
              await refreshHosts();
              setHostEditorState({ isOpen: false, host: null });
            }}
            onDelete={async () => {
              const target = hostEditorState.host;
              if (!target) return;
              await deleteHost(target.id);
              await refreshHosts();
              setHostEditorState({ isOpen: false, host: null });
            }}
            onKillTmuxServer={async (h) => {
              const token = localStorage.getItem('auth_token');
              await fetch(`/api/hosts/${h.id}/kill-tmux?force=true`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
              });
              setNotification({ isOpen: true, message: t('killTmuxServerDone') || 'Remote tmux server killed.' });
            }}
            onClose={() => setHostEditorState({ isOpen: false, host: null })}
            t={t}
            language={settings.language}
          />
        )}
        {confirmModal.isOpen && (
          <ConfirmModal
            isOpen={confirmModal.isOpen}
            title={confirmModal.title}
            titleIcon={confirmModal.titleIcon}
            message={confirmModal.message}
            confirmText={confirmModal.confirmText}
            cancelText={confirmModal.cancelText}
            tertiaryText={confirmModal.tertiaryText}
            danger={!!confirmModal.danger}
            onConfirm={handleConfirmModal}
            onCancel={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}
            onTertiary={confirmModal.onTertiary
              ? async () => {
                  await confirmModal.onTertiary?.();
                  setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
                }
              : undefined}
            language={settings.language}
          />
        )}
        {notification.isOpen && (
          <NotificationModal
            isOpen={notification.isOpen}
            message={notification.message}
            onClose={() => setNotification({ isOpen: false, message: '' })}
            t={t}
          />
        )}
        {isCommandPaletteOpen && (
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            items={[
              { id: 'new-tab', label: t('newSession') || 'New tab', action: () => { setIsCommandPaletteOpen(false); handleAddTab(); } },
              { id: 'settings', label: t('settings'), action: () => { setIsCommandPaletteOpen(false); setIsSettingsOpen(true); } },
              { id: 'find', label: t('findInTerminal'), action: () => { setIsCommandPaletteOpen(false); openTerminalSearch(); } },
              { id: 'files', label: t('quickOpenFiles'), action: () => { setIsCommandPaletteOpen(false); openFilePicker(); } },
            ]}
            onSelect={(id) => {
              const item = [
                { id: 'new-tab', action: () => handleAddTab() },
                { id: 'settings', action: () => setIsSettingsOpen(true) },
                { id: 'find', action: () => openTerminalSearch() },
                { id: 'files', action: () => openFilePicker() },
              ].find((i) => i.id === id);
              setIsCommandPaletteOpen(false);
              item?.action();
            }}
            onClose={() => setIsCommandPaletteOpen(false)}
            t={t}
            language={settings.language}
          />
        )}
        {isFilePickerOpen && (
          <CommandPalette
            isOpen={isFilePickerOpen}
            items={filePickerItems.map((item) => ({ id: item.id, label: item.label }))}
            query={filePickerQuery}
            onQueryChange={setFilePickerQuery}
            isLoading={isFilePickerLoading}
            onSelect={(id) => {
              const item = filePickerItems.find((i) => i.id === id);
              if (item) handleFileOpen(item.path);
              setIsFilePickerOpen(false);
            }}
            onClose={() => setIsFilePickerOpen(false)}
            t={t}
            language={settings.language}
          />
        )}
      </Suspense></LazyErrorBoundary>
    </div>
  );
}

const iconBtnStyle = {
  width: '26px', height: '26px',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', borderRadius: '4px',
  cursor: 'pointer', color: color.subtext,
  transition: 'background 120ms, color 120ms', padding: 0,
};

const searchBtnStyle = (theme) => ({
  height: '28px', minWidth: '28px', padding: '0 6px',
  border: `1px solid ${theme.ui.borderLight}`, borderRadius: '4px',
  background: 'transparent', color: theme.ui.text, cursor: 'pointer', fontSize: '12px',
});

export default App;
