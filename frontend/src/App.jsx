import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import { Terminal as TerminalIcon, Menu, XCircle, LogOut, Columns3, MessageSquare, LayoutGrid } from 'lucide-react';
import useSettings from './hooks/useSettings';
import useAppConfig from './hooks/useAppConfig';
import useTranslation from './hooks/useTranslation';
import useAuth from './hooks/useAuth';
import useHosts from './hooks/useHosts';
import useSshKeys from './hooks/useSshKeys';
import useViewport from './hooks/useViewport';
import killRemoteSession from './utils/killRemoteSession';
import useTerminalSearch from './hooks/useTerminalSearch';
import useFilePicker from './hooks/useFilePicker';
import useEditorResize from './hooks/useEditorResize';
import useEditorTabs from './hooks/useEditorTabs';
import useWorkspaceTabs from './hooks/useWorkspaceTabs';
import useDeepLinkOpen from './hooks/useDeepLinkOpen';
import useAgentStatus from './hooks/useAgentStatus';
import { deriveTabAgentStatus } from './utils/tabAgentStatus';
import { deriveBusy, sameSet } from './utils/busyActivity';
import useBlockStrayFileDrop from './hooks/useBlockStrayFileDrop';
import useLocalVncAvailable from './hooks/useLocalVncAvailable';
import themes from './styles/themes';
import { resolveRandomTheme } from './components/common/ThemePicker';
import { applyThemeVars } from './styles/themeUI';
import { applyEinkAttribute, applyEinkSettings, resolveEinkThemeId } from './utils/einkMode';
import { tokens } from './styles/tokens';
import { generateUUID } from './utils/helpers';
import { authHeaders } from './utils/auth';
import { apiFetch } from './utils/apiFetch';
import { resolveWorkspacePath } from './utils/terminalFileLinks';
import { loadDraft, saveDraft } from './utils/quickInputDraft';
import {
  makeLeaf, treeFromLegacyLayout, splitLeaf, removeLeaf, ensureTree,
  swapLeaves,
} from './utils/splitTree';
import { appendPaneAsSplit } from './utils/tabPaneOpen';
// 탭/pane 상태 전이 순수 리듀서 — 로직은 utils/tabOperations.js 가 소유(테스트 있음).
import {
  splitPaneOp, dropTabToSplitPaneOp, activatePaneOp, reorderPaneOp, dropPaneToSplitOp,
  removePaneOp, planPaneClose, extractPaneToTabOp,
} from './utils/tabOperations';
import {
  makePane, makLocalTab, makeFreshHostTmuxSessionName,
  usedThemeIdsFromTabs, resolveProfileTheme, makeHostTab, makeVncTab,
  deriveTabMeta,
} from './utils/tabModel';

import TabBar from './components/TabBar';
import HomeDashboard from './components/HomeDashboard';
import { VncDisplayPicker } from './components/panegrid/EmptyPane';
import RemoteFolderPicker from './components/RemoteFolderPicker';
import LocalEditor from './components/LocalEditor';
import LocalFolderPicker from './components/LocalFolderPicker';
import HostManager from './components/HostManager';
import PaneGrid from './components/PaneGrid';
import PaneErrorBoundary from './components/PaneErrorBoundary';
import LazyErrorBoundary from './components/LazyErrorBoundary';
import LoadingScreen from './components/layout/LoadingScreen';
import ScreenDumpModal from './components/ScreenDumpModal';
import AppModals from './components/AppModals';
import { copyToClipboard } from './utils/clipboard';

const Terminal        = lazy(() => import('./components/Terminal'));
const FileEditor      = lazy(() => import('./components/FileEditor'));
const InitialSetup    = lazy(() => import('./components/InitialSetup'));
const Login           = lazy(() => import('./components/Login'));
const MobileToolbar   = lazy(() => import('./components/MobileToolbar'));
const CommandInput    = lazy(() => import('./components/CommandInput'));

const { color, font, fontSize, fontWeight, space } = tokens;

// 탭을 닫으면 tmux 세션이 살아남는가(detach=true) 아니면 종료되는가(false).
// pane 중 하나라도 'tmux 꺼진 원격'이면 작업이 소실되므로 종료(false). 로컬 pane 은 항상 tmux.
// closeTab 의 실제 분기와 탭 칩의 안내 문구가 같은 기준을 쓰도록 한 곳에 둔다(DRY).
function App() {
  // 터미널을 조준하다 빗맞은 파일 드롭 → 브라우저가 파일을 열며 앱 이탈. 창 전체에서 삼킨다.
  useBlockStrayFileDrop();
  // useAuth 를 먼저 — isAuthenticated 가 useSettings 의 fetch 트리거 dep 으로 들어간다.
  // (로그인 후 처음 로드되는 경우에도 server 의 mobile fontSize 등을 가져오기 위함.)
  const { isLoading, needsSetup, isAuthenticated, username, login, logout, completeSetup } = useAuth();
  const { settings, updateSettings } = useSettings(isAuthenticated);
  // 서버 측 feature flag — 컨테이너 배포(LOCAL_DISABLED=1) 면 로컬 머신 카드 숨김.
  const appConfig = useAppConfig();
  const { t } = useTranslation(settings.language);
  /* 이북 모드는 테마를 이긴다 — 이 모드의 정체가 흑백 종이 화면 그 자체다.
     호스트별 themeOverride 도 같이 진다(Pane.jsx). 사용자의 원래 theme 값은 그대로 남아
     모드를 끄면 돌아온다 — utils/einkMode.js 는 덮어쓴 사본만 낸다. */
  const currentTheme = useMemo(
    () => themes[resolveEinkThemeId(settings.theme, settings.einkMode)] || themes.catppuccin,
    [settings.theme, settings.einkMode],
  );
  // <html data-eink> 는 einkCss.js 의 스위치다. 부팅 첫 프레임은 main.jsx 가 이미 세웠고,
  // 여기서는 사용자가 켜고 끌 때만 따라간다.
  useEffect(() => { applyEinkAttribute(settings.einkMode === true); }, [settings.einkMode]);
  // 초기 1회 — focusedPane 이 아직 안 정의된 첫 렌더에 글로벌 테마 즉시 적용 (FOUC 방지).
  // 활성 pane 의 themeOverride 가 잡히면 아래쪽 effect 가 덮어씀.
  useEffect(() => { applyThemeVars(currentTheme); }, [currentTheme]);
  const { hosts, loading: hostsLoading, refresh: refreshHosts, createHost, updateHost, deleteHost } = useHosts(isAuthenticated);
  const { keys: sshKeys, createKey, updateKey, deleteKey } = useSshKeys(isAuthenticated);

  // ── tabs ──────────────────────────────────────────────────────────────────
  // 탭 상태 + 영속(localStorage·서버 저장/복원/SSE)은 useWorkspaceTabs 가 단일 소유.
  // 탭 "조작"(추가/닫기/분할/열기 등)은 아래 App 본체에 남아 setTabs/setActiveTabId 를 쓴다.
  const { tabs, setTabs, activeTabId, setActiveTabId, isRestoringWorkspace, setIsRestoringWorkspace } = useWorkspaceTabs({ isAuthenticated });
  // 딥링크(`?open=<sessionId>`, 텔레그램 "열기" 버튼 등) → 그 세션 탭·pane 활성화.
  // 복원이 끝나야 탭이 채워지므로 ready 로 "포기 시점"을 알려준다.
  useDeepLinkOpen({ tabs, setActiveTabId, setTabs, ready: isAuthenticated && !isRestoringWorkspace });
  // 세션ID → 에이전트 상태. xterm 타이틀(즉시·원격 포함) + 백엔드 tmux 폴링(무인 세션) 합류점.
  const agentStatusMap = useAgentStatus();

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

  /* 홈·빈 pane 의 "이어할 수 있는 세션" 종료. **`allow_attached` 를 주지 않는다** —
     여기 뜬 카드는 정의상 "안 쓰는 세션" 이고, 붙어 있다면 그 판정이 낡은 것이다.
     서버가 409 로 막아 준다(그 판정을 스냅샷에 맡겼다가 쓰던 세션을 잃은 적이 있다).

     ⚠️ **응답 본문을 그대로 토스트에 흘리지 않는다.** `HTTP 409 — {"detail":…}` 는
     사용자에게 아무 말도 안 하는 문자열이다. detail 만 꺼내 그것만 보여준다. */
  const terminateHostSession = useCallback(async (host, sessionName) => {
    const res = await fetch(
      `/api/hosts/${host.id}/kill-tmux?session=${encodeURIComponent(sessionName)}`,
      { method: 'POST', headers: authHeaders() },
    );
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    let detail = '';
    try { detail = JSON.parse(body)?.detail || ''; } catch { detail = ''; }
    const err = new Error(detail || `HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    /* 409 는 **고장이 아니다** — "쓰는 중이라 안 지운다" 는 거절이다. 호출부가
       "종료 실패: …" 로 감싸면 사용자는 버그를 의심하게 된다. */
    err.status = res.status;
    throw err;
  }, []);

  /* 원격 tmux 세션 kill — 화면은 안 붙잡되 **확인될 때까지 다시 시도한다**.

     ⚠️ 예전에는 `.catch(() => {})` 였다. 백엔드가 재시작 중이거나(배포 직후가 그 창이다)
     연결이 막혀 있으면 닫은 탭의 세션이 조용히 살아남았고, 그건 다음에 홈의 "이어할 수
     있는 세션" 에 나타나 "닫았는데 왜 엉뚱한 게 올라오나" 가 됐다. 실측으로 그렇게 생긴
     고아가 있었다. 재시도 규칙은 `utils/killRemoteSession.js` 에 적어 뒀다.

     그래도 안 되면 **말한다.** 조용히 실패하면 사용자는 며칠 뒤 낯선 세션으로 그 사실을
     알게 되는데, 그때는 그게 무엇이었는지 알 방법이 없다. */
  const killRemoteTmuxSession = useCallback((hostId, sessionName) => {
    if (!hostId || !sessionName) return;
    killRemoteSession(hostId, sessionName).then((ok) => {
      if (ok) return;
      setNotification({
        isOpen: true,
        type: 'error',
        message: (t('sessionKillFailed')
          || '원격 세션을 종료하지 못했습니다: {name} — 홈의 “이어할 수 있는 세션”에서 정리할 수 있습니다')
          .replace('{name}', sessionName),
      });
    });
  }, [t]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) || null, [tabs, activeTabId]);

  // 탭별 영속성 (tmux 로 작업이 살아남는지) — 로컬은 항상 true, 호스트는 use_remote_tmux 따라감.
  // TabBar 가 시각 표시할 수 있게 derived field 로 붙여서 넘김.
  const tabsWithMeta = useMemo(
    () => tabs.map((tt) => deriveTabMeta(tt, {
      hosts, settings, agentStatus: deriveTabAgentStatus(tt, agentStatusMap),
    })),
    [tabs, hosts, agentStatusMap, settings.localName, settings.localIcon, settings.localColorIndex],
  );

  // ── open / close tabs ─────────────────────────────────────────────────────
  // 새 로컬 터미널 — 명시 cwd 없으면 settings.localStartPath 사용. 비어 있어도 '' (= 워크스페이스 루트)
  // 로 명시 전달해 backend 가 임의 위치($HOME 등) 에서 spawn 하지 않도록 함.
  const openLocalTab = useCallback(async (cwd = null) => {
    const sessionId = generateUUID();
    const tabId = `local:${sessionId}`;
    const name = (settings.localName || '').trim() || 'terminal';
    const startCwd = cwd ?? settings.localStartPath ?? '';
    setTabs((prev) => {
      const tab = makLocalTab(sessionId, name, startCwd, {
        icon: settings.localIcon || null,
        colorIndex: settings.localColorIndex ?? 0,
        themeOverride: resolveProfileTheme(settings.localTheme, usedThemeIdsFromTabs(prev)),
      });
      return [...prev, tab];
    });
    setActiveTabId(tabId);
  }, [settings.localName, settings.localIcon, settings.localColorIndex, settings.localTheme, settings.localStartPath]);

  const openHostTab = useCallback((host, cwd = null, tmuxSessionName = null) => {
    if (!host || host.isLocal || host.id === 'local') {
      openLocalTab();
      return;
    }
    // 명시 cwd 가 없으면 host 설정의 start_path 로 폴백 → FileTree 가 그 경로에서 시작
    const initialCwd = cwd ?? host.start_path ?? null;
    const tabId = `host:${host.id}:${Date.now()}`;
    setTabs((prev) => {
      const tab = makeHostTab(host, initialCwd, tmuxSessionName, {
        tabId,
        themeOverride: resolveProfileTheme(host.theme, usedThemeIdsFromTabs(prev)),
      });
      return [...prev, tab];
    });
    setActiveTabId(tabId);
  }, [openLocalTab]);

  // VNC 원격 데스크톱 — 홈 화면에서 호스트 카드의 ScreenShare 버튼으로 연다.
  // openHostTab 과 동일한 패턴: 새 탭 생성 + 활성화. pane 은 mode:'vnc'.
  const openVncTab = useCallback((host, display) => {
    // 로컬도 허용한다 — 백엔드가 도는 기계라 SSH 터널 없이 루프백에 바로 붙는다.
    // 백엔드는 host_id 'local' 을 예약어로 받는다(routes/vnc.py LOCAL_HOST_ID).
    if (!host) return;
    const tabId = `vnc:${host.id}:${Date.now()}`;
    setTabs((prev) => {
      const tab = makeVncTab(host, display, {
        tabId,
        themeOverride: resolveProfileTheme(host.theme, usedThemeIdsFromTabs(prev)),
      });
      return [...prev, tab];
    });
    setActiveTabId(tabId);
  }, []);

  // ── pane operations ───────────────────────────────────────────────────────
  // Split active pane — creates an empty pane picker. The user chooses local/host/tab there.
  // dir = 'right' | 'left' | 'up' | 'down' | 'h' (→right) | 'v' (→down) | '2x2'
  // 중요: prev (latest) 에서 panes 길이 판단 → useCallback 클로저의 stale activeTab 영향 안 받음
  // 모바일에서는 실제 화면 분할 대신 새 빈 pane 을 sub-tab 으로 연다.
  // 반응형 뷰포트 — isMobile/viewportHeight state + 최신값 ref.
  const { isMobile, viewportHeight, isMobileRef: isMobileViewportRef } = useViewport();
  const splitActivePane = useCallback((dir = 'h', targetTabId, targetPaneId) => {
    setTabs((prev) => splitPaneOp(prev, {
      dir, targetTabId, targetPaneId, activeTabId: activeTabIdRef.current,
    }));
  }, []);

  // Drag a tab onto a pane to split or absorb it.
  // sourceTabId: tab being dragged
  // targetTabId: tab that owns the target pane (currently unused but forwarded for context)
  // targetPaneId: pane the tab was dropped onto
  // dir: 'top' | 'bottom' | 'left' | 'right' | 'center'
  const dropTabToSplitPane = useCallback((sourceTabId, targetTabId, targetPaneId, dir) => {
    setTabs((prev) => dropTabToSplitPaneOp(prev, {
      sourceTabId, targetTabId, targetPaneId, dir, hosts, computePaneTmuxSession,
    }));
  }, [hosts, computePaneTmuxSession]);

  // 빈 pane 활성화 — target 종류:
  //  - { type: 'local' } 새 로컬 세션
  //  - { type: 'host', hostId } 호스트 새 pane
  //  - { type: 'tab',  sourceTabId } 다른 열린 탭 전체를 이 자리로 흡수 (병합)
  //                                  → 원본 탭은 상단 탭바에서 사라지고, 그 탭의 pane 들이
  //                                    대상 탭에 합류.
  // target 없으면 부모 탭 타입 그대로 따라감 (단순 클릭 케이스)
  const activatePane = useCallback((tabId, paneId, target = null) => {
    setTabs((prev) => activatePaneOp(prev, {
      tabId, paneId, target, hosts, settings, computePaneTmuxSession,
    }));
  }, [hosts, settings, computePaneTmuxSession]);

  const closePane = useCallback((tabId, paneId, opts = {}) => {
    const { skipConfirm = false } = opts;
    const tab = tabs.find((tt) => tt.id === tabId);
    const pane = tab?.panes?.find((p) => p.id === paneId);
    if (!tab || !pane) return;
    const paneIndex = tab.panes.findIndex((p) => p.id === paneId);

    const doClose = () => {
      setTabs((prev) => removePaneOp(prev, { tabId, paneId }));
      // 로컬 세션 정리
      if (pane.sessionId && !pane.hostId) {
        fetch(`/api/sessions/${pane.sessionId}`, {
          method: 'DELETE', headers: authHeaders(),
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
      // 홈 Resumable 목록 즉시 갱신
      bumpSessionRefresh();
    };

    const plan = planPaneClose(tab, paneId, hosts);
    if (plan.action === 'delegateToTab') { closeTabRef.current?.(tabId); return; }
    if (plan.action === 'immediate') { doClose(); return; }

    // 서브탭(분할) 종료도 "이 분할의 세션만 끝난다" 를 명확히 — 탭 전체 닫기와 헷갈리지 않게.
    const paneLabel = `#${plan.paneIndex + 1} · ${t('pane') || 'Pane'} ${plan.paneIndex + 1}`;
    const title = t('endSplitSession') || 'End this split';
    const base = plan.willPersist
      ? (t('confirmClosePaneSession') || "This split's session will end.")
      : (t('confirmClosePaneNoTmux') || 'Close this split? Work will be lost (tmux off).');
    const message = `${paneLabel}\n\n${base}`;

    if (skipConfirm) {
      doClose();
      return;
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

  // 분할 pane → 새 단독 탭으로 분리 (detach). 빈 pane (sessionId/hostId 없음) 은
  // 추출 의미 없으므로 무시. 새 탭은 원본 바로 뒤에 삽입되고 즉시 활성화.
  const extractPaneToTab = useCallback((tabId, paneId) => {
    const result = extractPaneToTabOp(tabs, { tabId, paneId, hosts, now: Date.now() });
    if (!result) return;
    setTabs(result.tabs);
    setActiveTabId(result.newTabId);
  }, [tabs, hosts]);

  // 분할 pane 순서 변경 — subTabs 컨텍스트 메뉴(Move left/right) 및 드래그 핸들에서 사용.
  // (tabId, fromPaneId, toPaneId) → 해당 탭의 panes 배열에서 fromPaneId 를 toPaneId 위치로 이동.
  // splitTree 가 있으면 leaf paneId 도 swap 해서 시각적 위치가 바뀌도록 함.
  const reorderPane = useCallback((tabId, fromPaneId, toPaneId) => {
    setTabs((prev) => reorderPaneOp(prev, { tabId, fromPaneId, toPaneId }));
  }, []);

  // Drag a pane onto another pane with a directional zone → move src next to dest in split tree.
  // dir: 'top' | 'bottom' | 'left' | 'right' (center = swap handled by reorderPane)
  const dropPaneToSplit = useCallback((tabId, srcPaneId, destPaneId, dir) => {
    setTabs((prev) => dropPaneToSplitOp(prev, { tabId, srcPaneId, destPaneId, dir }));
  }, []);

  const closeTab = useCallback((tabId, opts = {}) => {
    const { skipConfirm = false } = opts;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const removeTabOnly = () => {
      const idx = tabs.findIndex((t) => t.id === tabId);
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const fallback = remaining[Math.max(0, idx - 1)]?.id || remaining[0]?.id || null;
        setActiveTabId(fallback);
      }
      setTabs(remaining);
      bumpSessionRefresh();
    };

    const terminateSessions = () => {
      if (tab.type === 'local') {
        const sessionIds = (tab.panes || [{ sessionId: tab.sessionId }])
          .map((p) => p.sessionId)
          .filter(Boolean);
        sessionIds.forEach((sid) => {
          fetch(`/api/sessions/${sid}`, {
            method: 'DELETE',
            headers: authHeaders(),
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

    // 단순·명료 모델: 탭 닫기 = 그 탭의 내부 세션을 전부 종료한다. detach(세션 유지) 개념 없음.
    // (네트워크 끊김 자동 재연결은 회복력 — Terminal.jsx 가 따로 책임. 여긴 사용자의 명시적 닫기만.)
    const closeAndTerminate = () => { terminateSessions(); removeTabOnly(); };

    // 살아있는 세션이 하나도 없는 빈/신규 탭은 물어볼 게 없다 — 바로 닫는다.
    const hasLiveSession = !!tab.sessionId || !!tab.hostId
      || (tab.panes || []).some((p) => p.sessionId || p.hostId);
    if (!hasLiveSession) { removeTabOnly(); return; }

    // 휠 클릭 인라인 confirm 등 이미 확인을 거친 빠른 닫기.
    if (skipConfirm) { closeAndTerminate(); return; }

    const paneCount = tab.panes?.length || 1;
    const tabIdx = tabs.findIndex((tb) => tb.id === tabId);
    const tabNo = tabIdx >= 0 ? tabIdx + 1 : '?';
    const headerLine = `#${tabNo} · ${tab.name || 'terminal'}`;
    // "닫기 = 세션 종료" 를 문구로 못 박는다. pane 여러 개면 몇 개가 끝나는지 명시.
    // t() 는 보간이 없어 pre + 숫자 + post 로 조립(언어별 어순 유지).
    const body = paneCount > 1
      ? `${t('confirmCloseTabSessionsPre') || 'All '}${paneCount}${t('confirmCloseTabSessionsPost') || ' sessions in this tab will end.'}`
      : (t('confirmCloseTab') || "This tab's session will end.");
    setConfirmModal({
      isOpen: true,
      title: t('closeTab') || 'Close tab',
      titleIcon: XCircle,
      message: `${headerLine}\n\n${body}`,
      danger: true,
      confirmText: t('closeTab') || 'Close tab',
      onConfirm: closeAndTerminate,
    });
  }, [tabs, activeTabId, t, hosts, computePaneTmuxSession, killRemoteTmuxSession]);

  useEffect(() => { closeTabRef.current = closeTab; }, [closeTab]);

  // ── new tab = open home picker (just go home) ─────────────────────────────
  const handleAddTab = useCallback(() => {
    setActiveTabId(null); // show home
  }, []);

  // ── cwd & git context ─────────────────────────────────────────────────────
  // 포커스된 pane 기준 — 같은 탭 안에서도 각 pane 의 cwd/git 이 다를 수 있으므로
  // TerminalHeader 는 활성 pane 을 따라간다.
  const focusedPane = useMemo(() => {
    if (!activeTab?.panes) return null;
    return activeTab.panes.find((p) => p.id === activeTab.activePaneId) || activeTab.panes[0] || null;
  }, [activeTab]);
  const isFocusedLocal = focusedPane && !focusedPane.hostId;
  const focusedHostId = focusedPane?.hostId || null;

  // ── 자동 탭 이름 (Jupyter 식) ────────────────────────────────────────────
  // 활성 pane 의 cwd basename 으로 탭 이름 갱신. 호스트 탭/사용자가 직접 이름 박은 탭
  // (manualName=true) 은 건드리지 않는다.
  const handlePaneCwdChange = useCallback((paneId, workspaceRel, isLocalPane, absolutePath = null) => {
    if (!paneId) return;
    // 로컬은 workspace 상대경로, 원격은 절대경로 basename 을 이름 소스로 쓴다(주소표시줄과 동일).
    const source = isLocalPane ? workspaceRel : absolutePath;
    const trimmed = (source || '').replace(/\/+$/, '');
    const cwdName = trimmed ? trimmed.split('/').pop() : null;
    if (!cwdName) return; // 루트/홈 등 이름 뽑을 게 없으면 그대로 둔다.
    setTabs((prev) => prev.map((tb) => {
      const paneIdx = (tb.panes || []).findIndex((p) => p.id === paneId);
      if (paneIdx < 0) return tb;
      let next = { ...tb };
      // 활성 pane 의 cwd 로 탭 제목 갱신 — 로컬/원격 공통. 사용자가 직접 이름 박은 탭(manualName)은 존중.
      if (!tb.manualName && tb.activePaneId === paneId && cwdName !== tb.name) {
        next = { ...next, name: cwdName };
      }
      const pane = next.panes[paneIdx];
      if (!pane.manualName && cwdName !== pane.name) {
        const newPanes = [...next.panes];
        newPanes[paneIdx] = { ...pane, name: cwdName };
        next = { ...next, panes: newPanes };
      }
      return next === tb ? tb : next;
    }));
  }, []);

  const handleRenamePane = useCallback((tabId, paneId) => {
    const newName = prompt(t?.('enterNewName') || 'Enter name:');
    if (!newName || !newName.trim()) return;
    setTabs((prev) => prev.map((tb) => {
      if (tb.id !== tabId) return tb;
      const paneIdx = (tb.panes || []).findIndex((p) => p.id === paneId);
      if (paneIdx < 0) return tb;
      const newPanes = [...tb.panes];
      newPanes[paneIdx] = { ...newPanes[paneIdx], name: newName.trim(), manualName: true };
      return { ...tb, panes: newPanes };
    }));
  }, [t]);

  const handleRenameTab = useCallback((tabId) => {
    const tb = tabs.find((t) => t.id === tabId);
    const newName = prompt(t?.('enterNewName') || 'Enter name:', tb?.name || '');
    if (!newName || !newName.trim()) return;
    setTabs((prev) => prev.map((t) =>
      t.id === tabId ? { ...t, name: newName.trim(), manualName: true } : t
    ));
  }, [tabs, t]);

  // ── per-pane 테마 오버라이드 ─────────────────────────────────────────────
  // 우측 사이드바의 테마 픽커는 "이 터미널만" 적용 — 전역 settings.theme 은 안 건드림.
  // themeId === null 이면 override 해제 (전역 테마로 복귀).
  // 분할 크기를 탭에 저장 — 이걸 안 하면 splitSizes 가 PaneGrid 로컬 state 라
  // 새로고침 때 통째로 날아간다(설정한 창 크기가 균등분할로 되돌아감).
  // 탭 필드에 넣으면 기존 tab-state 영속(debounced PUT + SSE)을 그대로 탄다.
  const handlePersistSplitSizes = useCallback((tabId, splitSizes) => {
    if (!tabId) return;
    setTabs((prev) => prev.map((tb) => (tb.id === tabId ? { ...tb, splitSizes } : tb)));
  }, []);

  const handlePaneThemeChange = useCallback((paneId, themeId) => {
    if (!paneId) return;
    setTabs((prev) => {
      let resolvedId = themeId;
      if (themeId === 'random-dark' || themeId === 'random-light') {
        // 겹침 최소화 — 전역 테마 + 모든 pane 의 "실효 테마"(override 없으면 전역)를 사용중으로 간주.
        const usedThemes = [
          settings.theme,
          ...prev.flatMap((tb) => (tb.panes || []).map((p) => p.themeOverride || settings.theme)),
        ].filter(Boolean);
        resolvedId = resolveRandomTheme(themeId, usedThemes);
      }
      return prev.map((tb) => {
        if (!tb.panes?.some((p) => p.id === paneId)) return tb;
        return {
          ...tb,
          panes: tb.panes.map((p) => {
            if (p.id !== paneId) return p;
            if (!resolvedId) {
              const { themeOverride: _drop, ...rest } = p;
              return rest;
            }
            return { ...p, themeOverride: resolvedId };
          }),
        };
      });
    });
  }, [settings.theme]);

  // ── 탭 busy 인디케이터 (Jupyter 식 활동 점멸) ─────────────────────────────
  // Terminal.jsx 가 데이터 도착 시 'iterm:activity' 윈도우 이벤트를 paneId 와 함께
  // 디스패치 → 여기서 paneId → ts 맵에 기록 → 250ms 마다 만료 (>700ms 비활성) 검사 후
  // tabId 단위 busy 집합으로 변환. tabs 는 ref 로 잡아 stale closure 방지.
  const [busyTabIds, setBusyTabIds] = useState(() => new Set());
  const [busyPaneIds, setBusyPaneIds] = useState(() => new Set());
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => {
    let activity = new Map(); // paneId -> ts (ms)
    let tick = null;

    const stop = () => {
      if (!tick) return;
      clearInterval(tick);
      tick = null;
    };

    const run = () => {
      // 탭이 숨겨졌으면(밤새 백그라운드 등) 아무도 안 봄 — Set 생성·setState 다 건너뛰어
      // idle 백그라운드에서 불필요한 GC·렌더를 0 으로. 복귀하면 다음 tick 이 바로 갱신.
      if (document.hidden) return;
      const next = deriveBusy({ activity, tabs: tabsRef.current, now: Date.now() });
      activity = next.activity;
      setBusyPaneIds((prev) => (sameSet(prev, next.panes) ? prev : next.panes));
      setBusyTabIds((prev) => (sameSet(prev, next.tabs) ? prev : next.tabs));
      // 만료를 기다릴 것도, 꺼줄 것도 없다 → 타이머를 멈춘다. 다음 활동이 다시 켠다.
      // (예전엔 이 틱이 영영 돌아서, 아무 출력이 없어도 초당 6.7회 Set 두 개를 만들고
      //  탭×pane 을 순회했다.)
      if (next.idle) stop();
    };

    /* 150ms — busy 등장/소멸 인지를 1프레임 안으로. 활동이 있는 동안에만 돈다. */
    const start = () => {
      if (tick || document.hidden) return;
      tick = setInterval(run, 150);
    };

    const onActivity = (e) => {
      const paneId = e?.detail?.paneId;
      if (!paneId) return;
      activity.set(paneId, Date.now());
      start();
    };
    // 숨은 동안 쌓인 활동은 틱 없이 맵에만 남는다 — 돌아왔을 때 켜서 정리한다.
    const onVisible = () => { if (!document.hidden && activity.size) start(); };

    window.addEventListener('iterm:activity', onActivity);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('iterm:activity', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, []);

  // 활성 탭명을 브라우저 탭 제목에 반영. 앞 이모지는 현재 터미널 활동 상태:
  // 👨‍💻 = 출력/작업 중, 🧍 = idle. 홈 화면에서는 백그라운드 탭 중 하나라도 바쁘면 작업 중으로 표시.
  const DEFAULT_DOC_TITLE = 'Terminal List — Multi-Session SSH Terminal';
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    const isBusy = active ? busyTabIds.has(active.id) : busyTabIds.size > 0;
    const statusEmoji = isBusy ? '👨‍💻' : '🧍';
    document.title = active?.name
      ? `${statusEmoji} ${active.name} — Terminal List`
      : `${statusEmoji} ${DEFAULT_DOC_TITLE}`;
  }, [tabs, activeTabId, busyTabIds]);

  // ── UI state ──────────────────────────────────────────────────────────────
  // isMobile 은 "작은 핸드폰 UI" 기준(phone viewport 로만 판정). viewportHeight 와 함께
  // useViewport() 훅에서 관리 — 위 pane operations 부근에서 구조분해해 가져온다.
  // 세션 닫기/열기 후 홈 Resumable 목록 즉시 갱신용 nonce
  const [sessionRefreshNonce, setSessionRefreshNonce] = useState(0);
  const bumpSessionRefresh = useCallback(() => setSessionRefreshNonce((n) => n + 1), []);
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
  /* localFolderPicker.slot — { tabId, paneId } 면 해당 pane 안에서 인라인 오버레이.
     null 이면 전역 모달 (Sidebar / LocalEditor 진입 등 pane 컨텍스트 없는 케이스). */
  const [localFolderPicker, setLocalFolderPicker] = useState({
    open: false,
    initial: '',
    onPick: null,
    slot: null,
  });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [notification, setNotification] = useState({ isOpen: false, message: '' });
  const [vncPickerHost, setVncPickerHost] = useState(null);
  /* 이 배포의 로컬 머신이 VNC 를 쓸 수 있는가 — 한 번만 조회해 캐시한다(훅이 모듈
     레벨에 보관하므로 빈 pane 의 EmptyPane 홈도 같은 답을 본다). 컨테이너 배포에서
     local 은 컨테이너 자신이고 이미지에 VNC 가 없으므로 false 가 된다. */
  const localVncAvailable = useLocalVncAvailable(isAuthenticated);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // SSH keyboard-interactive prompt 가 열려 있는지 — 모바일 단축키바 가림 처리.
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  useEffect(() => {
    const onPrompt = (e) => setAuthPromptOpen(!!e.detail?.open);
    window.addEventListener('iterm:auth-prompt', onPrompt);
    return () => window.removeEventListener('iterm:auth-prompt', onPrompt);
  }, []);

  // File editor
  const {
    openFiles, activeFile, handleFileOpen, handleFileClose, handleFileCloseAll,
  } = useEditorTabs({
    t, setNotification, activeTabId,
    liveTabIds: tabs.map((tb) => tb.id),
    pruneEnabled: !isRestoringWorkspace,
  });
  // 터미널의 파일 경로 클릭 → 에디터로 연다. 워크스페이스 루트는 한 번만 가져와 캐시.
  const workspaceRootRef = useRef('');
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/files/workspace', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.root) workspaceRootRef.current = d.root; })
      .catch(() => { /* 경로 클릭이 안 될 뿐, 앱은 정상 */ });
  }, [isAuthenticated]);
  useEffect(() => {
    const onOpenFile = (e) => {
      const link = e?.detail;
      if (!link?.path) return;
      const rel = resolveWorkspacePath(link.path, {
        workspaceRoot: workspaceRootRef.current,
        cwd: link.cwd || '',
      });
      // 워크스페이스 밖이거나 홈 경로면 못 연다 — 조용히 무시(엉뚱한 파일 열지 않음).
      if (rel == null) return;
      /* 있는지 먼저 확인하고 연다. 낙관적으로 열면 **없는 경로로 빈 편집기 탭**이 남는데,
         그건 사용자가 직접 닫아야 하고 이름도 경로 조각이라 뭘 잘못 눌렀는지도 모른다
         (실제 증상). 클릭은 드문 사용자 동작이라 왕복 하나는 싸다. */
      apiFetch(`/api/files/read?path=${encodeURIComponent(rel)}`, { headers: authHeaders() })
        .then((r) => {
          if (r.ok) { handleFileOpen(rel); return; }
          setNotification({ isOpen: true, message: `${t('fileNotFound') || 'File not found'}: ${link.path}` });
        })
        .catch(() => { /* 네트워크 실패 — 잘못된 경로라고 단정하지 않는다(조용히 무시) */ });
      // TODO: link.line 으로 해당 줄 이동 — handleFileOpen 이 line 인자를 받게 확장 필요.
    };
    window.addEventListener('iterm:open-file', onOpenFile);
    return () => window.removeEventListener('iterm:open-file', onOpenFile);
  }, [handleFileOpen, t]);

  const { editorHeight, isResizingEditor, onEditorResizeStart } = useEditorResize();
  const [terminalReloadSignal, setTerminalReloadSignal] = useState(0);
  const equalizeTabRef = useRef(null); // PaneGrid 가 활성 탭의 equalize 콜백을 채워줌
  // Broadcast 토글은 TabBar(설정 버튼 옆)에 있고, 실제 상태/동작은 활성 탭의 PaneGrid 소유.
  const broadcastTabRef = useRef(null);
  const [broadcastActive, setBroadcastActive] = useState(false);
  // 탭별 "포커스 pane 접속 완료" 여부 — 로딩 중엔 TabBar 액션 버튼을 비활성화한다.
  // 탭 id 로 보관해야 탭 전환 시 이전 탭의 값이 새 탭으로 새어나가지 않는다.
  const [readyByTabId, setReadyByTabId] = useState({});
  const handleTabReady = useCallback((tabId, ready) => setReadyByTabId(
    (prev) => (prev[tabId] === ready ? prev : { ...prev, [tabId]: ready }),
  ), []);
  // 닫힌 탭의 항목은 정리 — 안 그러면 세션 내내 쌓인다.
  const liveTabIdsKey = tabs.map((tb) => tb.id).join('|');
  useEffect(() => {
    setReadyByTabId((prev) => {
      const live = new Set(liveTabIdsKey ? liveTabIdsKey.split('|') : []);
      const kept = Object.keys(prev).filter((id) => live.has(id));
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept.map((id) => [id, prev[id]]));
    });
  }, [liveTabIdsKey]);

  // Terminal search — state/handlers 는 useTerminalSearch() 훅에서 (actions 섹션에서 구조분해).

  // Command palette / file picker (파일 피커 state/logic 은 useFilePicker() 훅 — 아래 구조분해)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const [commandInputOpen, setCommandInputOpen] = useState(false);
  /* 모바일 입력은 **팝업으로 되돌렸다** (2026-08-28).

     상시 노출 도크는 탭 한 번을 아끼려던 것인데, 폰에서 하단 입력부를 누르면 키보드가
     올라왔다 곧바로 닫히는 일이 반복됐다. 뷰포트 값이 얼어붙던 것과 blur 래치가 흔들림
     한 프레임에 반응하던 것 둘을 고쳤는데도 남았다 — 원인이 하나 더 있고, 그것은 실기기
     없이 좁힐 수 없다(이 저장소의 키보드·visualViewport 영역은 jsdom 이 끝까지 대신해
     주지 못하는 자리다).

     **되돌리는 쪽이 맞다.** 아껴지는 것은 탭 한 번인데 잃는 것은 "입력이 되긴 하나" 라는
     신뢰다. 퀵바의 💬 버튼 → 모달 경로는 그대로 살아 있으므로 이 값 하나로 갈린다.

     도크 코드는 남겨 둔다(`docked` prop). 지우면 다시 만들 때 이 모든 판단을 처음부터
     다시 해야 하는데, 여기 도달할 길이 없으므로 동작에는 영향이 없다. 다시 켜려면 이
     조건을 되살리기 전에 **실기기에서 키보드 열고 닫기부터** 확인할 것. */
  const showCommandDock = false;
  // 쓰다 만 명령은 localStorage 에 남긴다 — 배포 직후 지연로드 청크 404 로
  // LazyErrorBoundary 가 페이지를 리로드해도 입력이 날아가지 않게. (utils/quickInputDraft.js)
  const [commandText, setCommandText] = useState(loadDraft);
  useEffect(() => { saveDraft(commandText); }, [commandText]);
  const [screenDumpText, setScreenDumpText] = useState(null);
  // 터미널 컨텍스트 메뉴 "텍스트로 보기" → ScreenDumpModal. prop 드릴링(App→PaneGrid→Pane→Terminal)
  // 대신 CustomEvent 로 터미널이 직접 화면 텍스트를 보내고 여기서 수신한다.
  useEffect(() => {
    const handler = (e) => setScreenDumpText(e.detail?.text || '— empty —');
    window.addEventListener('itl:screen-dump', handler);
    return () => window.removeEventListener('itl:screen-dump', handler);
  }, []);

  // 활성 viewport 기준 effective settings — fontSize 를 PC/모바일 분리. 자식들
  // (PaneGrid, Terminal) 은 settings.fontSize 만 보면 자동으로 알맞은 값 적용.
  const effectiveSettings = useMemo(() => {
    // 진짜 핸드폰 UI일 때만 fontSizeMobile 을 사용한다.
    // null-ish coalescing 으로 기본값(13/12) 보장.
    const size = isMobile
      ? (settings.fontSizeMobile ?? 13)
      : (settings.fontSize ?? 12);
    // 이북 모드의 덮어쓰기는 **여기 한 곳**에서 걸린다. PaneGrid·Terminal 은 이미
    // effectiveSettings 를 받으므로 각자 einkMode 를 볼 필요가 없다.
    return applyEinkSettings({ ...settings, fontSize: size });
  }, [settings, isMobile]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handleLogoutRequest = () => setConfirmModal({
    isOpen: true,
    title: t('confirmLogout'),
    titleIcon: LogOut,
    message: t('logoutMessage'),
    onConfirm: logout,
  });

  // 균등 분할은 수동 조정한 pane 크기를 되돌리는 파괴적 동작이라 한 번 확인받는다.
  const handleEqualizeRequest = () => setConfirmModal({
    isOpen: true,
    title: t('equalizePane'),
    titleIcon: LayoutGrid,
    message: t('equalizePaneConfirm'),
    onConfirm: () => equalizeTabRef.current?.(),
  });

  const handleConfirmModal = async () => {
    await confirmModal.onConfirm?.();
    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
  };

  const focusActiveTerminal = useCallback(() => {
    if (activeTab?.sessionId) window.terminalSessions?.[activeTab.sessionId]?.focus?.();
    else if (activeTab?.id) window.terminalSessions?.[activeTab.id]?.focus?.();
  }, [activeTab]);

  const {
    isFilePickerOpen, setIsFilePickerOpen, filePickerQuery, setFilePickerQuery,
    filePickerItems, isFilePickerLoading, openFilePicker,
  } = useFilePicker({ openFiles });

  const {
    isTerminalSearchOpen, terminalSearchQuery, setTerminalSearchQuery, terminalSearchStatus,
    terminalSearchInputRef, openTerminalSearch, closeTerminalSearch, executeTerminalSearch,
  } = useTerminalSearch({ activeTab, t, focusActiveTerminal });

  // editor resize
  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isForm = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.classList.contains('xterm-helper-textarea')) return false;
      const t = el.tagName.toLowerCase();
      return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
    };

    const onKey = (e) => {
      if (isForm(e.target) || isCommandPaletteOpen || isTerminalSearchOpen || isFilePickerOpen || commandInputOpen) return;
      const ctrl = e.ctrlKey || e.metaKey;
      // 빠른 입력창 — 모바일 전용이던 걸 데스크탑에서도 열 수 있게.
      // 버튼과 같은 조건으로 잠근다: 터미널이 붙기 전엔 보낼 곳이 없다.
      if (ctrl && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (activeTabId !== null && readyByTabId[activeTabId]) setCommandInputOpen(true);
        return;
      }
      if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); setIsCommandPaletteOpen(true); return; }
      if (ctrl && e.key === 'p') { e.preventDefault(); openFilePicker(); return; }
      if (ctrl && e.key === ',') { e.preventDefault(); setIsSettingsOpen(true); return; }
      if (ctrl && e.key === 't') { e.preventDefault(); handleAddTab(); return; }
      if (ctrl && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        splitActivePane(e.shiftKey ? 'down' : 'right');
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
  }, [isCommandPaletteOpen, isTerminalSearchOpen, isFilePickerOpen, commandInputOpen, readyByTabId, openFilePicker, openTerminalSearch, handleAddTab, activeTabId, activeTab, closeTab, splitActivePane, tabs]);  // splitActivePane 은 deps 비어 있어 stable

  // ── terminal key for session registry ─────────────────────────────────────
  // Terminal.jsx 는 `sessionId={pane.sessionId || pane.id}` 로 등록한다.
  // → 호스트 pane 은 pane.id (UUID) 로, 로컬 pane 은 pane.sessionId 로 등록.
  // 기존엔 activeTab.id 를 봤기 때문에 host 탭에선 lookup 이 항상 실패해서
  // MobileToolbar 의 단축키가 sendData 를 못 호출했다.
  const terminalKey = focusedPane
    ? (focusedPane.sessionId || focusedPane.id)
    : (activeTab?.sessionId || activeTab?.id || null);
  const terminalLayoutSignal = `tab:${activeTabId}:editor:${activeFile ? editorHeight : 0}`;

  const handleLogin = useCallback((nextUsername, sessionToken = null) => {
    setIsRestoringWorkspace(true);
    login(nextUsername, sessionToken);
  }, [login]);

  // ── guards ────────────────────────────────────────────────────────────────
  const authLoadingFallback = <LoadingScreen currentTheme={currentTheme} t={t} />;
  if (isLoading || isRestoringWorkspace) return authLoadingFallback;
  if (needsSetup) return <LazyErrorBoundary><Suspense fallback={authLoadingFallback}><InitialSetup onComplete={completeSetup} language={settings.language} /></Suspense></LazyErrorBoundary>;
  if (!isAuthenticated) return <LazyErrorBoundary><Suspense fallback={authLoadingFallback}><Login onLogin={handleLogin} language={settings.language} theme={currentTheme} einkMode={settings.einkMode === true} onToggleEink={() => updateSettings({ einkMode: !settings.einkMode })} /></Suspense></LazyErrorBoundary>;

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
        /* xterm 스크롤바 완전 제거 — xterm.css 기본값 overflow-y:scroll 의 gutter 를 모든 방법으로 숨김.
           scrollbar-width:none (Firefox/Chrome121+) + ::-webkit-scrollbar width:0 (Safari/Chrome<121).
           overflow-y:scroll 유지 — xterm 이 scroll position 으로 buffer 위치 트래킹하는 구조이므로
           auto 로 바꾸면 콘텐츠가 딱 맞을 때(fit 상태) scrollbar 가 없어져 scroll 이벤트가 끊길 수 있음.
           대신 scrollbar 를 width:0 + display:none 으로 완전 투명화해 gutter 도 0 으로 만든다. */
        .xterm .xterm-viewport {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
          overflow-x: hidden !important;
        }
        .xterm .xterm-viewport::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
          background: transparent !important;
        }
        .xterm .xterm-viewport::-webkit-scrollbar-thumb,
        .xterm .xterm-viewport::-webkit-scrollbar-track,
        .xterm .xterm-viewport::-webkit-scrollbar-corner {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
          background: transparent !important;
        }
        /* screen/scroll-area 등 나머지 xterm 내부 요소 */
        .xterm *:not(.xterm-viewport) {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        .xterm *:not(.xterm-viewport)::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
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
        onCloseImmediate={(tabId) => closeTab(tabId, { skipConfirm: true })}
        onHome={() => setActiveTabId(null)}
        onOpenHosts={() => setHostManagerOpen(true)}
        onOpenKeys={() => { setEditingKey(null); setKeyManagerOpen(true); }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        // 보낼 터미널이 실제로 있을 때만 노출 — 홈 화면/빈 탭에선 의미 없음.
        onOpenCommandInput={
          activeTabId !== null && !!focusedPane && focusedPane.mode !== 'vnc'
            && (focusedPane.sessionId || focusedPane.hostId)
            ? () => setCommandInputOpen(true)
            : null
        }
        // 터미널이 붙기 전엔 눌러봐야 보낼 곳이 없다 — 로딩 중엔 액션 버튼을 흐리게 잠근다.
        actionsDisabled={activeTabId !== null && !readyByTabId[activeTabId]}
        // 새로고침할 터미널이 있을 때만 — 홈에서는 되돌릴 화면 자체가 없다.
        onReloadTerminals={
          activeTabId !== null ? () => setTerminalReloadSignal((s) => s + 1) : null
        }
        // 분할이 2개 이상일 때만 의미 있음 — 단일 pane 에선 숨긴다.
        onEqualizePanes={
          !isMobile && (activeTab?.panes?.length || 0) > 1
            ? handleEqualizeRequest
            : null
        }
        isBroadcasting={broadcastActive}
        onBroadcastToggle={
          (activeTab?.panes?.length || 0) > 1
            ? () => broadcastTabRef.current?.()
            : null
        }
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
        onRenameTab={handleRenameTab}
        canSplit={!!activeTab && !isMobile}
        t={t}
      />

      {/* ── main body ── 모든 탭의 PaneGrid 를 stack 으로 마운트 (xterm 보존 → scrollback/사이즈 유지).
          [TODO Phase 3] 비활성 탭의 WS 를 grace 후 close → tmux capture-pane 으로 scrollback 복원.
          현재는 모든 탭의 WS 가 항상 open 상태. 활성/비활성 구분은 fit/poll 같은 보조 작업에만 적용.
          탭 전환 시 xterm 은 그대로라 사이즈 jitter 없음, scrollback 도 그대로. */}
      {/* 터미널이 사는 영역. 모바일 입력 도크가 이 안으로 음영 막을 포탈한다 —
          헤더·탭바까지 덮이면 안 되므로 화면 전체가 아니라 **이 상자**가 기준이다. */}
      <div id="iterm-terminal-area"
           style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
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
              isVisible={activeTabId === null}
              hosts={hosts}
              hostsLoading={hostsLoading}
              settings={settings}
              localCard={{
                name: (settings.localName || '').trim() || (t('thisMachine') || 'This machine'),
                icon: settings.localIcon || '',
                accent: tokens.color.dotPalette[
                  (settings.localColorIndex ?? 0) % tokens.color.dotPalette.length
                ],
                startPath: settings.localStartPath || '',
              }}
              onOpenHost={openHostTab}
              onOpenVnc={(host) => setVncPickerHost(host)}
              /* 로컬 원격 데스크톱은 "이 배포에 VNC 가 실제로 있을 때" 만 노출한다.
                 컨테이너 배포에서 local 은 컨테이너 자신이고 이미지에 VNC 가 없다 —
                 버튼만 있고 눌러야 미설치 안내가 나오면 소음이다. 원격 호스트는
                 SSH 를 타야 알 수 있어 매번 프로브할 수 없지만(클릭 시 조회),
                 로컬은 SSH 없이 한 번이면 알 수 있으므로 자동 감지한다. */
              showLocalVnc={localVncAvailable}
              refreshHosts={refreshHosts}
              onOpenHostAtPath={(h) => setFolderPickerHost(h)}
              onEditLocal={() => setLocalEditorOpen(true)}
              onPickLocalPath={() => setLocalFolderPicker({
                open: true,
                initial: settings.localStartPath || '',
                onPick: (chosen) => openLocalTab(chosen),
                slot: null,
              })}
              onAddHost={() => setHostEditorState({ isOpen: true, host: null })}
              onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
              onDeleteHost={async (h) => { await deleteHost(h.id); await refreshHosts(); }}
              onOpenSettings={() => setIsSettingsOpen(true)}
              tabs={tabsWithMeta}
              busyTabIds={busyTabIds}
              onJumpTab={(tabId) => setActiveTabId(tabId)}
              onJumpPane={(tabId, paneId) => { setActiveTabId(tabId); focusPane(tabId, paneId); }}
              onResumeHostSession={(host, sessionName) => openHostTab(host, null, sessionName)}
              onTerminateHostSession={terminateHostSession}
              onConfirm={(opts) => setConfirmModal({ isOpen: true, ...opts })}
              onNotify={(message) => setNotification({ isOpen: true, message })}
              t={t}
              settings={settings}
              refreshSignal={sessionRefreshNonce}
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
            const tabLayoutSignal = `tab:${tab.id}:editor:${isThisActive && activeFile ? editorHeight : 0}:active:${isThisActive ? 1 : 0}:layout:${tab.layout || 'single'}:n:${tab.panes?.length || 1}:vh:${isMobile ? Math.round(viewportHeight) : 0}:tree:${tab.splitTree ? JSON.stringify(tab.splitTree).length : 0}`;
            return (
              <div
                key={tab.id}
                {...(!isThisActive ? { inert: '' } : {})}
                style={{
                  position: 'absolute', inset: 0,
                  /* display:none ↔ flex 토글은 ResizeObserver 를 깨워 fit/redraw 가 다시 일어나
                     탭 전환마다 화면 flicker. visibility/opacity/pointer-events 로 가리면 layout
                     안 변해 ResizeObserver 안 짖음 → xterm 이 그대로 정지된 그림 그대로 살아있음.
                     inert: pointer-events:none 은 xterm.js canvas 자식까지 전파 안 되므로
                     inert 속성으로 모든 하위 이벤트 차단 (scroll 포함). */
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
                        onCloseAll={handleFileCloseAll}
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
                    equalizeRef={isThisActive ? equalizeTabRef : null}
                    broadcastRef={isThisActive ? broadcastTabRef : null}
                    onBroadcastChange={isThisActive ? setBroadcastActive : null}
                    onReadyChange={handleTabReady}
                    activeFilePath={isThisActive ? activeFile : null}
                    isMobile={isMobile}
                    onFocusPane={focusPane}
                    onClosePane={closePane}
                    onClosePaneImmediate={(tabId, paneId) => closePane(tabId, paneId, { skipConfirm: true })}
                    onActivatePane={activatePane}
                    onExtractPaneToTab={extractPaneToTab}
                    onReorderPane={reorderPane}
                    onPaneDragToSplit={dropPaneToSplit}
                    onSplitPane={(tabId, paneId, dir) => splitActivePane(dir, tabId, paneId)}
                    onDropTabToPane={(sourceTabId, targetTabId, targetPaneId, dir) => dropTabToSplitPane(sourceTabId, targetTabId, targetPaneId, dir)}
                    onPaneCwdChange={handlePaneCwdChange}
                    onPaneThemeChange={handlePaneThemeChange}
                    onPersistSplitSizes={handlePersistSplitSizes}
                    onRenamePane={handleRenamePane}
                    layoutSignal={tabLayoutSignal}
                    reloadSignal={isThisActive ? terminalReloadSignal : 0}
                    settings={effectiveSettings}
                    updateSettings={updateSettings}
                    cwd={tabCwd}
                    onFileSelect={handleFileOpen}
                    onFolderSelect={setSelectedFolderPath}
                    onOpenTerminalAtFolder={(path, hostId = null, source = null) => {
                      if (isMobile && source?.tabId) {
                        const paneId = generateUUID();
                        const sessionId = hostId ? null : generateUUID();
                        const host = hostId ? hosts.find((h) => h.id === hostId) : null;
                        setTabs((prev) => prev.map((tt) =>
                          tt.id === source.tabId
                            ? appendPaneAsSplit(tt, makePane({
                                id: paneId,
                                ...(hostId ? { hostId, tmuxSessionName: makeFreshHostTmuxSessionName(host) } : { sessionId }),
                                cwd: path,
                                ...(() => {
                                  const profileTheme = hostId
                                    ? hosts.find((h) => h.id === hostId)?.theme
                                    : settings.localTheme;
                                  const resolvedTheme = resolveProfileTheme(profileTheme, usedThemeIdsFromTabs(prev));
                                  return resolvedTheme ? { themeOverride: resolvedTheme } : {};
                                })(),
                              }), {
                                afterPaneId: source.paneId,
                                dir: 'right',
                              })
                            : tt
                        ));
                        setActiveTabId(source.tabId);
                        return;
                      }
                      if (hostId) {
                        const host = hosts.find((h) => h.id === hostId);
                        if (host) { openHostTab(host, path); return; }
                      }
                      const sessionId = generateUUID();
                      const tabId = `local:${sessionId}`;
                      const name = path.split('/').pop() || (settings.localName || 'terminal');
                      setTabs((prev) => {
                        const newTab = makLocalTab(sessionId, name, path, {
                          icon: settings.localIcon || null,
                          colorIndex: settings.localColorIndex ?? 0,
                          themeOverride: resolveProfileTheme(settings.localTheme, usedThemeIdsFromTabs(prev)),
                        });
                        return [...prev, newTab];
                      });
                      setActiveTabId(tabId);
                    }}
                    language={settings.language}
                    t={t}
                    viewportHeight={viewportHeight}
                    onScreenDump={(text) => setScreenDumpText(text || '— empty —')}
                    /* EmptyPane → 내부 Resumable 카드의 종료 confirm 을 표준 ConfirmModal 로. */
                    onConfirm={(opts) => setConfirmModal({ isOpen: true, ...opts })}
                    onNotify={(message) => setNotification({ isOpen: true, message })}
                    onResumeHostSession={(host, sessionName) => openHostTab(host, null, sessionName)}
                    onTerminateHostSession={terminateHostSession}
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
                      slot: slot || null,
                    })}
                    onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
                    onEditLocal={() => setLocalEditorOpen(true)}
                    refreshHosts={refreshHosts}
                    /* 인라인 picker 상태 — 매칭되는 (tabId, paneId) pane 안에서 오버레이. */
                    localPicker={localFolderPicker}
                    onLocalPickerClose={() => setLocalFolderPicker({ open: false, initial: '', onPick: null, slot: null })}
                    onLocalPickerPick={(chosen) => {
                      const fn = localFolderPicker.onPick;
                      setLocalFolderPicker({ open: false, initial: '', onPick: null, slot: null });
                      fn?.(chosen);
                    }}
                    remotePickerHost={folderPickerHost}
                    remotePickerSlot={folderPickerSlot}
                    onRemotePickerClose={() => { setFolderPickerHost(null); setFolderPickerSlot(null); }}
                    onRemotePickerPick={async (chosen) => {
                      const host = folderPickerHost;
                      const slot = folderPickerSlot;
                      setFolderPickerHost(null);
                      setFolderPickerSlot(null);
                      if (!host || !chosen) return;
                      try {
                        await fetch(`/api/hosts/${host.id}/last-cwd`, {
                          method: 'POST',
                          headers: authHeaders({ 'Content-Type': 'application/json' }),
                          body: JSON.stringify({ cwd: chosen }),
                        });
                      } catch { /* 무시 */ }
                      if (slot?.tabId && slot?.paneId) {
                        activatePane(slot.tabId, slot.paneId, { type: 'host', hostId: host.id, cwd: chosen });
                      } else {
                        openHostTab(host, chosen);
                      }
                      refreshHosts();
                    }}
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
          VNC pane 도 마찬가지 — 터미널 세션이 없어 키를 받을 곳이 없다(누르면 영영 로딩).
          SSH 2FA 인증 prompt 열려 있을 때도 키보드와 같이 따라 올라와 모달 가리므로 숨김. */}
      {isMobile && activeTabId !== null && !!focusedPane && focusedPane.mode !== 'vnc'
        && (focusedPane.sessionId || focusedPane.hostId) && !authPromptOpen && (
        <LazyErrorBoundary><Suspense fallback={null}>
          {/* ⚠️ 퀵바는 입력 도크보다 **먼저** 그려져야 한다 — 도크가 이 안의 고정
              슬롯(DOCK_SLOT_ID)으로 포탈하기 때문. 순서를 바꾸면 첫 렌더에 슬롯이 없어
              대상·히스토리 버튼이 한 틱 늦게 나타난다(도크가 재시도하긴 한다). */}
          <MobileToolbar
            onSendKey={(key) => window.terminalSessions?.[terminalKey]?.sendData?.(key)}
            onOpenCommandInput={() => setCommandInputOpen(true)}
            onAction={(type) => {
              const session = window.terminalSessions?.[terminalKey];
              if (!session) return;
              // 결과를 반드시 말한다. 예전엔 navigator.clipboard 를 그냥 불러서, 없는
              // 컨텍스트(비보안 오리진·인앱 웹뷰)에서는 예외만 나고 화면은 조용했다.
              const copyAndTell = (text) => copyToClipboard(text).then((ok) => {
                setNotification({
                  isOpen: true,
                  message: ok ? t('copied') : (t('clipboardError') || 'Copy failed'),
                  type: ok ? 'success' : 'error',
                });
              });
              if (type === 'copy') {
                const sel = session.getSelection?.();
                if (sel) copyAndTell(sel);
                else setNotification({ isOpen: true, message: t('noSelection') || 'No text selected', type: 'info' });
              } else if (type === 'copyAll') {
                const text = session.getBufferText?.() || '';
                if (text) copyAndTell(text);
              }
            }}
            language={settings.language}
            keys={settings.mobileKeys}
            terminalSessionId={terminalKey}
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

      {/* ── command input ──
          모바일은 **하단에 상시 도크**, 데스크탑은 예전처럼 모달.
          폰에서 사람이 하는 일은 대개 키를 치는 게 아니라 한 줄 보내는 것이라, 네 걸음
          (터미널 탭 → 키보드 → 키바에서 버튼 찾기 → 모달)을 0 걸음으로 줄인다.
          도크 자리는 MobileToolbar 바로 위 — 둘 다 wrapper 의 flex 흐름 끝이라
          키보드가 올라오면 같이 밀려 올라간다. */}
      {(commandInputOpen || showCommandDock) && (
        <LazyErrorBoundary><Suspense fallback={null}>
          <CommandInput
            docked={showCommandDock}
            isOpen={showCommandDock || commandInputOpen}
            onClose={() => setCommandInputOpen(false)}
            /* 빈 전송(도크 우측 버튼) → 그 대상들에 키를 그대로 흘린다. onSend 와 같은
               폴백 규칙: 대상이 비면 활성 pane. */
            onSendKey={(data, targetKeys) => {
              const keys = (Array.isArray(targetKeys) && targetKeys.length) ? targetKeys : [terminalKey];
              keys.filter(Boolean).forEach((k) => window.terminalSessions?.[k]?.sendData?.(data));
            }}
            onSend={(cmd, targetKeys, textByKey = {}) => {
              // targetKeys = 보낼 pane key 배열. 비면 활성 pane 으로 폴백.
              // textByKey = pane 별로 다른 텍스트(첨부 이미지 경로가 호스트마다 다르다).
              const keys = (Array.isArray(targetKeys) && targetKeys.length) ? targetKeys : [terminalKey];
              keys.filter(Boolean).forEach((k) => {
                const terminal = window.terminalSessions?.[k];
                const text = textByKey[k] ?? cmd;
                if (!terminal?.sendCommand?.(text)) {
                  terminal?.sendData?.(text);
                  window.setTimeout(() => terminal?.sendData?.('\r'), 40);
                  window.setTimeout(() => terminal?.sendData?.('\r'), 180);
                }
              });
              setCommandText('');
            }}
            command={commandText}
            setCommand={setCommandText}
            t={t}
            language={settings.language}
            terminalKey={terminalKey}
            // 활성 탭만이 아니라 열려있는 모든 탭의 pane 을 모아서 넘긴다 — 팝업에서
            // 탭을 넘나들며 그룹으로 선택해 동시에 보낼 수 있게 (탭별로 묶어 표시).
            // CommandInput 은 탭 그룹 안에서 자기 인덱스로 "분할 N" 을 붙이므로
            // 여기서 label/name 을 만들 필요가 없다. 그룹핑은 탭 순서대로 이어붙인
            // 이 배열이 tabId 기준으로 연속이라는 점에 의존한다(flatMap 이 보장).
            panes={tabsWithMeta.flatMap((tb, ti) => (tb.panes || [])
              .filter((p) => p.sessionId || p.id)
              .map((p) => {
                const host = p.hostId ? hosts.find((h) => h.id === p.hostId) : null;
                const isLocal = !!p.sessionId && !p.hostId;
                const colorIdx = host?.color_index ?? (isLocal ? settings.localColorIndex : null) ?? tb.color_index ?? 0;
                return {
                  key: p.sessionId || p.id,
                  hostId: p.hostId || null,   // 이미지 첨부를 그 호스트로 올리기 위해
                  color: color.dotPalette[colorIdx % color.dotPalette.length],
                  host: host?.name || (isLocal ? ((settings.localName || '').trim() || (t('thisMachine') || 'Local')) : '—'),
                  tabId: tb.id,
                  tabName: tb.name || `${t('tab', 'Tab')} ${ti + 1}`,
                  isActiveTab: tb.id === activeTabId,
                };
              }))}
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

      {/* ── remote folder picker (open-at-path) — slot 있으면 Pane 안 인라인 ── */}
      <RemoteFolderPicker
        isOpen={!!folderPickerHost && !folderPickerSlot}
        host={folderPickerHost}
        onClose={() => { setFolderPickerHost(null); setFolderPickerSlot(null); }}
        onPick={async (chosen) => {
          const host = folderPickerHost;
          const slot = folderPickerSlot;
          setFolderPickerHost(null);
          setFolderPickerSlot(null);
          if (!host || !chosen) return;
          try {
            await fetch(`/api/hosts/${host.id}/last-cwd`, {
              method: 'POST',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
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

      {/* ── VNC display picker (home dashboard entry) ── */}
      {vncPickerHost && (
        <VncDisplayPicker
          host={vncPickerHost}
          t={t}
          onConfirm={(opts) => setConfirmModal({ isOpen: true, ...opts })}
          onPick={(display) => { openVncTab(vncPickerHost, display); setVncPickerHost(null); }}
          onClose={() => setVncPickerHost(null)}
        />
      )}

      {/* ── local machine editor ── */}
      <LocalEditor
        isOpen={localEditorOpen}
        zIndex={isSettingsOpen ? 200002 : undefined}
        settings={settings}
        onSave={(patch) => updateSettings(patch)}
        onClose={() => setLocalEditorOpen(false)}
        onPickFolder={(initial, applyChosen) => setLocalFolderPicker({
          open: true,
          initial: initial || '',
          onPick: (chosen) => applyChosen?.(chosen),
          slot: null,
        })}
        t={t}
      />

      {/* ── local workspace folder picker (전역 모달) ──
          slot 이 있으면 Pane 안 인라인으로 렌더되므로 여기서는 skip. */}
      <LocalFolderPicker
        isOpen={localFolderPicker.open && !localFolderPicker.slot}
        initialPath={localFolderPicker.initial}
        onClose={() => setLocalFolderPicker({ open: false, initial: '', onPick: null, slot: null })}
        onPick={(chosen) => {
          const fn = localFolderPicker.onPick;
          setLocalFolderPicker({ open: false, initial: '', onPick: null, slot: null });
          fn?.(chosen);
        }}
        t={t}
      />

      {/* ── modals ── (Settings/SSH키/호스트편집/확인/알림/커맨드팔레트/파일피커) → AppModals */}
      <AppModals
        isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen}
        settings={settings} updateSettings={updateSettings} username={username}
        hosts={hosts} sshKeys={sshKeys} refreshHosts={refreshHosts}
        setHostEditorState={setHostEditorState} setLocalEditorOpen={setLocalEditorOpen}
        setEditingKey={setEditingKey} setKeyManagerOpen={setKeyManagerOpen} logout={logout}
        keyManagerOpen={keyManagerOpen} editingKey={editingKey}
        createKey={createKey} updateKey={updateKey} deleteKey={deleteKey}
        hostEditorState={hostEditorState} createHost={createHost} updateHost={updateHost}
        deleteHost={deleteHost} setNotification={setNotification}
        confirmModal={confirmModal} handleConfirmModal={handleConfirmModal} setConfirmModal={setConfirmModal}
        notification={notification}
        isCommandPaletteOpen={isCommandPaletteOpen} setIsCommandPaletteOpen={setIsCommandPaletteOpen}
        handleAddTab={handleAddTab} openTerminalSearch={openTerminalSearch} openFilePicker={openFilePicker}
        isFilePickerOpen={isFilePickerOpen} setIsFilePickerOpen={setIsFilePickerOpen}
        filePickerItems={filePickerItems} filePickerQuery={filePickerQuery} setFilePickerQuery={setFilePickerQuery}
        isFilePickerLoading={isFilePickerLoading} handleFileOpen={handleFileOpen}
        t={t}
      />
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
