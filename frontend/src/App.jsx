import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import { Terminal as TerminalIcon, Menu } from 'lucide-react';
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

const { color, font, fontSize, fontWeight, space } = tokens;

// ── tab helpers ──────────────────────────────────────────────────────────────
// 모델: tab = { id, type, name, ..., panes:[Pane], layout:'single'|'h'|'v', activePaneId }
// Pane = { id, mode:'terminal'|'editor', sessionId?, hostId?, openFiles?, activeFile? }

const makePane = (extra = {}) => ({
  id: generateUUID(),
  mode: 'terminal',
  ...extra,
});

const makLocalTab = (sessionId, name, cwd = null, { icon = null, colorIndex = null } = {}) => {
  const pane = makePane({ sessionId });
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

const makeHostTab = (host, cwd = null) => {
  const pane = makePane({ hostId: host.id });
  return {
    id: `host:${host.id}:${Date.now()}`,
    type: 'host',
    hostId: host.id,
    name: host.name,
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
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation(settings.language);
  const currentTheme = useMemo(() => themes[settings.theme] || themes.catppuccin, [settings.theme]);

  useEffect(() => { applyThemeVars(currentTheme); }, [currentTheme]);

  const { isLoading, needsSetup, isAuthenticated, username, login, logout, completeSetup } = useAuth();
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

  useEffect(() => { localStorage.setItem('tabs_v2', JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => {
    if (activeTabId) localStorage.setItem('active_tab_id', activeTabId);
    else localStorage.removeItem('active_tab_id');
  }, [activeTabId]);

  // validate active tab still exists
  useEffect(() => {
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id || null);
    }
  }, [tabs, activeTabId]);

  // 키보드 핸들러 클로저에서 stale 안 되게 ref 로 보관
  const activeTabIdRef = useRef(null);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) || null, [tabs, activeTabId]);

  // ── open / close tabs ─────────────────────────────────────────────────────
  const openLocalTab = useCallback(async (cwd = null) => {
    const sessionId = generateUUID();
    const name = (settings.localName || '').trim() || 'terminal';
    const tab = makLocalTab(sessionId, name, cwd, {
      icon: settings.localIcon || null,
      colorIndex: settings.localColorIndex ?? 0,
    });
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [settings.localName, settings.localIcon, settings.localColorIndex]);

  const openHostTab = useCallback((host, cwd = null) => {
    if (!host || host.isLocal || host.id === 'local') {
      openLocalTab();
      return;
    }
    const tab = makeHostTab(host, cwd);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [openLocalTab]);

  // ── pane operations ───────────────────────────────────────────────────────
  // 활성 탭에 *빈* pane 을 분할 추가. 사용자가 클릭해야 세션이 시작됨.
  // dir = 'h' (좌우) | 'v' (상하)
  // 중요: prev (latest) 에서 panes 길이 판단 → useCallback 클로저의 stale activeTab 영향 안 받음
  const splitActivePane = useCallback((dir = 'h') => {
    setTabs((prev) => {
      const targetId = activeTabIdRef.current;
      if (!targetId) return prev;
      return prev.map((t) => {
        if (t.id !== targetId) return t;
        if ((t.panes?.length || 1) >= 4) return t; // 최대 4
        const newPane = makePane({});
        const panes = [...(t.panes || []), newPane];
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
  //  - { type: 'tab',  sourceTabId } 다른 열린 탭의 활성 pane 을 그대로 복제 (mirror)
  // target 없으면 부모 탭 타입 그대로 따라감 (단순 클릭 케이스)
  const activatePane = useCallback((tabId, paneId, target = null) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const panes = (t.panes || []).map((p) => {
        if (p.id !== paneId) return p;
        if (p.sessionId || p.hostId) return p;
        // 1) 다른 열린 탭에서 미러
        if (target?.type === 'tab' && target.sourceTabId) {
          const src = prev.find((tt) => tt.id === target.sourceTabId);
          if (src) {
            const srcPane = src.panes?.find((pp) => pp.id === src.activePaneId) || src.panes?.[0];
            if (srcPane?.sessionId) return { ...p, sessionId: srcPane.sessionId, hostId: undefined };
            if (srcPane?.hostId) return { ...p, hostId: srcPane.hostId, sessionId: undefined };
          }
        }
        // 2) 명시 target
        if (target?.type === 'host' && target.hostId) {
          return { ...p, hostId: target.hostId, sessionId: undefined };
        }
        if (target?.type === 'local') {
          return { ...p, sessionId: generateUUID(), hostId: undefined };
        }
        // 3) 부모 탭 타입 폴백
        if (t.type === 'host') return { ...p, hostId: t.hostId };
        return { ...p, sessionId: generateUUID() };
      });
      return { ...t, panes, activePaneId: paneId };
    }));
  }, []);

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
        // 마지막 1개 pane 이면 비움 (탭은 유지)
        if (panes.length === 1) {
          const single = panes[0];
          if (single.id !== paneId) return t;   // id 매치 안 되면 무동작
          const emptied = [{ id: single.id, mode: 'terminal' }];
          return { ...t, panes: emptied, layout: 'single', activePaneId: emptied[0].id };
        }
        // 다중 pane → 해당 pane 제거
        const remaining = panes.filter((p) => p.id !== paneId);
        if (remaining.length === 0) return t;   // 위에서 걸러줘야 정상이지만 방어
        const layout = remaining.length === 1 ? 'single' : (remaining.length === 2 ? (t.layout === 'v' ? 'v' : 'h') : '2x2');
        const activePaneId = t.activePaneId === paneId ? remaining[0].id : t.activePaneId;
        return { ...t, panes: remaining, layout, activePaneId };
      }));
      const token = localStorage.getItem('auth_token');
      // 로컬 세션 정리
      if (pane.sessionId && !pane.hostId) {
        fetch(`/api/sessions/${pane.sessionId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      // 호스트 분할 pane (paneIndex > 0) → 자동 부여된 원격 tmux 세션 정리.
      // pane 0 (메인) 은 영속이므로 안 죽임.
      if (pane.hostId && paneIndex > 0) {
        const host = hosts.find((h) => h.id === pane.hostId);
        const baseSession = host?.remote_tmux_session || 'mobile';
        const targetSession = `${baseSession}.${paneIndex + 1}`;
        fetch(`/api/hosts/${pane.hostId}/kill-tmux?session=${encodeURIComponent(targetSession)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    };

    // 빈 pane (이미 picker 상태) 마지막 1개 → 닫을 게 없음
    const paneCount = tab.panes?.length || 0;
    if (!pane.sessionId && !pane.hostId && paneCount <= 1) return;

    const isEmpty = !pane.sessionId && !pane.hostId;
    const isHost = !!pane.hostId;
    const isLastPane = paneCount === 1;
    // 호스트면 그 호스트의 tmux 설정 보고 메시지 결정 (작업 유지/소실)
    const host = isHost ? hosts.find((h) => h.id === pane.hostId) : null;
    const willPersist = isEmpty || !isHost /* local 항상 tmux */ || !!host?.use_remote_tmux;

    let title, message;
    if (isEmpty) {
      // 빈 pane (멀티 중) 제거
      title = t('removePane') || 'Remove pane';
      message = t('confirmRemoveEmptyPane') || 'Remove this empty pane?';
    } else if (isLastPane) {
      // 단일 pane 닫기 → 탭은 유지 + picker 노출
      title = t('closeTerminal') || 'Close terminal';
      message = willPersist
        ? (t('confirmCloseLastPane') || 'Close this terminal? The tab stays (empty picker).')
        : (t('confirmCloseLastPaneNoTmux') || 'Close this terminal? Work will be lost (tmux off). Tab stays.');
    } else {
      // 멀티 pane 중 하나 닫기
      title = t('closePane') || 'Close pane';
      message = willPersist
        ? (t('confirmClosePane') || 'Close this pane?')
        : (t('confirmClosePaneNoTmux') || 'Close this pane? Work will be lost (tmux off).');
    }

    setConfirmModal({
      isOpen: true,
      title, message,
      onConfirm: doClose,
    });
  }, [tabs, t, hosts]);

  const focusPane = useCallback((tabId, paneId) => {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, activePaneId: paneId } : t));
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
      // 로컬이면 모든 pane 의 백엔드 세션 정리 (호스트는 원격 tmux 살림)
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
      }
    };

    // 탭 안에 tmux 꺼진 호스트 pane 이 하나라도 있으면 경고 (작업 소실 가능)
    const hasNoTmuxPane = (tab.panes || []).some((p) => {
      if (!p.hostId) return false;
      const h = hosts.find((hh) => hh.id === p.hostId);
      return h && !h.use_remote_tmux;
    });
    const paneCount = tab.panes?.length || 1;
    const baseMsg = hasNoTmuxPane
      ? (t('confirmCloseTabLossy') || 'Close this tab? Work in non-tmux sessions will be lost.')
      : (t('confirmCloseTab') || 'Close this tab?');
    const message = paneCount > 1
      ? `${baseMsg} (${paneCount} ${t('panesInTab') || 'panes'})`
      : baseMsg;
    setConfirmModal({
      isOpen: true,
      title: t('closeTab') || 'Close tab',
      message,
      onConfirm: doClose,
    });
  }, [tabs, activeTabId, t, hosts]);

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

  // ── 탭 busy 인디케이터 (Jupyter 식 활동 점멸) ─────────────────────────────
  // Terminal.jsx 가 데이터 도착 시 'iterm:activity' 윈도우 이벤트를 paneId 와 함께
  // 디스패치 → 여기서 paneId → ts 맵에 기록 → 250ms 마다 만료 (>700ms 비활성) 검사 후
  // tabId 단위 busy 집합으로 변환. tabs 는 ref 로 잡아 stale closure 방지.
  const [busyTabIds, setBusyTabIds] = useState(() => new Set());
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => {
    const activity = new Map(); // paneId -> ts (ms)
    const onActivity = (e) => {
      const paneId = e?.detail?.paneId;
      if (paneId) activity.set(paneId, Date.now());
    };
    window.addEventListener('iterm:activity', onActivity);

    const tick = setInterval(() => {
      const now = Date.now();
      const busyPaneIds = new Set();
      for (const [pid, ts] of activity.entries()) {
        if (now - ts < 700) busyPaneIds.add(pid);
        else activity.delete(pid);
      }
      const next = new Set();
      for (const tb of tabsRef.current) {
        if (tb.panes?.some((p) => busyPaneIds.has(p.id))) next.add(tb.id);
      }
      setBusyTabIds((prev) => {
        if (prev.size === next.size && [...prev].every((x) => next.has(x))) return prev;
        return next;
      });
    }, 250);

    return () => {
      window.removeEventListener('iterm:activity', onActivity);
      clearInterval(tick);
    };
  }, []);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hostEditorState, setHostEditorState] = useState({ isOpen: false, host: null });
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [hostManagerOpen, setHostManagerOpen] = useState(false);
  const [folderPickerHost, setFolderPickerHost] = useState(null);
  const [localEditorOpen, setLocalEditorOpen] = useState(false);
  const [localFolderPicker, setLocalFolderPicker] = useState({
    open: false,
    initial: '',
    onPick: null,
  });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [notification, setNotification] = useState({ isOpen: false, message: '' });
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

  // ── responsive ────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    if (window.visualViewport) {
      const vp = () => setViewportHeight(window.visualViewport.height);
      window.visualViewport.addEventListener('resize', vp);
      return () => { window.removeEventListener('resize', check); window.visualViewport.removeEventListener('resize', vp); };
    }
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => { localStorage.setItem('editor_height', editorHeight.toString()); }, [editorHeight]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handleLogoutRequest = () => setConfirmModal({
    isOpen: true,
    title: t('confirmLogout'),
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

  const handleFileOpen = (path) => {
    if (!openFiles.includes(path)) setOpenFiles((prev) => [...prev, path]);
    setActiveFile(path);
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
    const onMove = (me) => {
      const y = me.clientY || me.touches?.[0]?.clientY;
      setEditorHeight(Math.max(150, Math.min(window.innerHeight - 150, startH + y - startY)));
    };
    const onUp = () => {
      setIsResizingEditor(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

  // file picker search
  useEffect(() => {
    if (!isFilePickerOpen) return;
    const query = filePickerQuery.trim();
    const token = localStorage.getItem('auth_token');
    const ctrl = new AbortController();
    if (!query) {
      setFilePickerItems(openFiles.map((p) => ({ id: `recent:${p}`, path: p, label: p })));
      return () => ctrl.abort();
    }
    const timer = setTimeout(async () => {
      setIsFilePickerLoading(true);
      try {
        const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}&limit=200`, {
          headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal,
        });
        const data = await res.json();
        setFilePickerItems((data.items || []).map((item) => ({ id: `s:${item.path}`, path: item.path, label: item.path })));
      } catch (err) {
        if (err.name !== 'AbortError') setFilePickerItems([]);
      } finally { setIsFilePickerLoading(false); }
    }, 120);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [isFilePickerOpen, filePickerQuery, openFiles]);

  // ── terminal key for session registry ─────────────────────────────────────
  const terminalKey = activeTab?.sessionId || activeTab?.id || null;
  const terminalLayoutSignal = `tab:${activeTabId}:editor:${activeFile ? editorHeight : 0}`;

  // ── guards ────────────────────────────────────────────────────────────────
  if (isLoading) return <LoadingScreen currentTheme={currentTheme} t={t} />;
  if (needsSetup) return <Suspense fallback={null}><InitialSetup onComplete={completeSetup} language={settings.language} /></Suspense>;
  if (!isAuthenticated) return <Suspense fallback={null}><Login onLogin={login} language={settings.language} /></Suspense>;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: isMobile ? `${viewportHeight}px` : '100vh',
      background: currentTheme.ui.bg,
      overflow: 'hidden',
      fontFamily: font.sans,
    }}>
      <style>{`
        * { scrollbar-width: thin; scrollbar-color: ${currentTheme.ui.bgTertiary} transparent; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${currentTheme.ui.bgTertiary}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${currentTheme.ui.accent}88; }
      `}</style>

      {/* ── 단일 상단 바: 홈 + 탭 + 액션 (호스트 / SSH 키 / 설정 / 로그아웃) ── */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
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

      {/* ── main body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* center: home or terminal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {activeTabId === null ? (
            /* ── home dashboard ── */
            <HomeDashboard
              hosts={hosts}
              localCard={{
                name: (settings.localName || '').trim() || (t('thisMachine') || 'This machine'),
                icon: settings.localIcon || '',
                accent: designTokens.color.dotPalette[
                  (settings.localColorIndex ?? 0) % designTokens.color.dotPalette.length
                ],
                subtitle: settings.localStartPath
                  ? `localhost · /${settings.localStartPath}`
                  : 'localhost',
              }}
              onOpenHost={openHostTab}
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
              t={t}
              settings={settings}
            />
          ) : (
            /* ── active terminal ── */
            <>
              {/* file editor (optional split) */}
              {activeFile && (
                <div style={{ height: `${editorHeight}px`, flexShrink: 0, position: 'relative', minHeight: '150px', zIndex: 10 }}>
                  <Suspense fallback={null}>
                    <FileEditor
                      activeFile={activeFile}
                      openFiles={openFiles}
                      onFileSelect={handleFileOpen}
                      onClose={handleFileClose}
                      theme={currentTheme}
                      language={settings.language}
                      onResizeStart={onEditorResizeStart}
                    />
                  </Suspense>
                </div>
              )}

              {/* terminal panes (각 pane 안에 RightPanel 포함) */}
              <div style={{
                flex: 1, position: 'relative', overflow: 'hidden', minHeight: '150px',
                paddingBottom: isMobile ? '80px' : 0,
              }}>
                <PaneGrid
                  tab={activeTab}
                  allTabs={tabs}
                  hosts={hosts}
                  isActive={true}
                  isMobile={isMobile}
                  onFocusPane={focusPane}
                  onClosePane={closePane}
                  onActivatePane={activatePane}
                  onPaneCwdChange={handlePaneCwdChange}
                  layoutSignal={terminalLayoutSignal}
                  settings={settings}
                  updateSettings={updateSettings}
                  cwd={
                    activeTab?.type === 'local'
                      ? (activeTab?.cwd ?? (settings.localStartPath || null))
                      : (activeTab?.cwd ?? null)
                  }
                  onFileSelect={handleFileOpen}
                  onFolderSelect={setSelectedFolderPath}
                  onOpenTerminalAtFolder={async (path) => {
                    const sessionId = generateUUID();
                    const name = path.split('/').pop() || (settings.localName || 'terminal');
                    const tab = makLocalTab(sessionId, name, path, {
                      icon: settings.localIcon || null,
                      colorIndex: settings.localColorIndex ?? 0,
                    });
                    setTabs((prev) => [...prev, tab]);
                    setActiveTabId(tab.id);
                  }}
                  language={settings.language}
                  t={t}
                  viewportHeight={viewportHeight}
                />
              </div>
            </>
          )}
        </div>

        {/* RightPanel 은 각 pane 내부로 이동 (PaneGrid 가 처리) */}
      </div>

      {/* ── terminal search overlay ── */}
      {isTerminalSearchOpen && (
        <div style={{
          position: 'fixed', top: '80px', right: '56px', zIndex: 1002,
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

      {/* ── mobile toolbar ── */}
      {isMobile && activeTabId !== null && (
        <Suspense fallback={null}>
          <MobileToolbar
            sessionId={terminalKey}
            isMenuOpen={isMenuOpen}
            setIsMenuOpen={setIsMenuOpen}
            currentTheme={currentTheme}
            t={t}
            commandInputOpen={commandInputOpen}
            setCommandInputOpen={setCommandInputOpen}
            commandText={commandText}
            setCommandText={setCommandText}
          />
        </Suspense>
      )}

      {/* ── host manager modal (top action) ── */}
      <HostManager
        isOpen={hostManagerOpen}
        onClose={() => setHostManagerOpen(false)}
        hosts={hosts}
        onAdd={() => { setHostManagerOpen(false); setHostEditorState({ isOpen: true, host: null }); }}
        onEdit={(h) => { setHostManagerOpen(false); setHostEditorState({ isOpen: true, host: h }); }}
        onConnect={(h) => { setHostManagerOpen(false); openHostTab(h); }}
        t={t}
      />

      {/* ── remote folder picker (open-at-path) ── */}
      <RemoteFolderPicker
        isOpen={!!folderPickerHost}
        host={folderPickerHost}
        onClose={() => setFolderPickerHost(null)}
        onPick={async (chosen) => {
          const host = folderPickerHost;
          setFolderPickerHost(null);
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
          openHostTab(host, chosen);
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
      <Suspense fallback={null}>
        {isSettingsOpen && (
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSave={updateSettings}
            username={username}
            hosts={hosts}
            sshKeys={sshKeys}
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
            message={confirmModal.message}
            onConfirm={handleConfirmModal}
            onCancel={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}
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
      </Suspense>
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
