/**
 * App 컴포넌트
 * 메인 애플리케이션 - 멀티 터미널 세션 관리 및 에디터 리사이즈 지원
 */
import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import useSettings from './hooks/useSettings';
import useTranslation from './hooks/useTranslation';
import useAuth from './hooks/useAuth';
import useSessionManager from './hooks/useSessionManager';
import useHosts from './hooks/useHosts';
import useSshKeys from './hooks/useSshKeys';
import useGitChanges from './hooks/useGitChanges';
import useActiveTerminalCwd from './hooks/useActiveTerminalCwd';
import useSwipe from './hooks/useSwipe';
import themes from './styles/themes';
import AppStyles from './styles/AppStyles';

// Layout Components
import Header from './components/layout/Header';
import EmptyState from './components/layout/EmptyState';
import LoadingScreen from './components/layout/LoadingScreen';
import PaneGrid from './components/layout/PaneGrid';

// Lazy load modals/pages
const Terminal = lazy(() => import('./components/Terminal'));
const MobileToolbar = lazy(() => import('./components/MobileToolbar'));
const CommandInput = lazy(() => import('./components/CommandInput'));
const Settings = lazy(() => import('./components/Settings'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const ConfirmModal = lazy(() => import('./components/ConfirmModal'));
const NotificationModal = lazy(() => import('./components/NotificationModal'));
const InitialSetup = lazy(() => import('./components/InitialSetup'));
const Login = lazy(() => import('./components/Login'));
const FileEditor = lazy(() => import('./components/FileEditor'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const HostEditor = lazy(() => import('./components/HostEditor'));
const SshKeyManager = lazy(() => import('./components/SshKeyManager'));
const ChangesPanel = lazy(() => import('./components/ChangesPanel'));

function App() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation(settings.language);
  const currentTheme = useMemo(() => themes[settings.theme] || themes.catppuccin, [settings.theme]);
  
  // Custom Hooks
  const { 
    isLoading, needsSetup, isAuthenticated, username, 
    login, logout, completeSetup 
  } = useAuth();
  
  const {
    sessions: localSessions, activeSessionId, setActiveSessionId,
    createSession, deleteSession: deleteLocalSession, renameSession,
  } = useSessionManager(isAuthenticated, settings.defaultShell);

  const { hosts, refresh: refreshHosts, createHost, updateHost, deleteHost } = useHosts(isAuthenticated);
  const { keys: sshKeys, createKey, deleteKey } = useSshKeys(isAuthenticated);

  // 호스트 연결 = 클라이언트 사이드 세션 (로컬 tmux 와 별개로 메모리에서만 추적)
  const [hostTabs, setHostTabs] = useState([]);  // {id, hostId, name, color_index}

  // 사이드바/터미널이 함께 다루는 통합 세션 목록 (로컬 tmux + 호스트 연결)
  const sessions = useMemo(() => {
    return [...localSessions, ...hostTabs];
  }, [localSessions, hostTabs]);

  const deleteSession = useCallback(async (id) => {
    const ht = hostTabs.find(t => t.id === id);
    if (ht) {
      setHostTabs(prev => prev.filter(t => t.id !== id));
      if (activeSessionId === id) {
        const remaining = [...localSessions, ...hostTabs.filter(t => t.id !== id)];
        setActiveSessionId(remaining[0]?.id || null);
      }
      return true;
    }
    return await deleteLocalSession(id);
  }, [hostTabs, localSessions, activeSessionId, setActiveSessionId, deleteLocalSession]);

  // 호스트 관련 모달 상태
  const [hostEditorState, setHostEditorState] = useState({ isOpen: false, host: null });
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);

  // 우측 Changes 패널 (git 변경사항)
  const [isChangesPanelOpen, setIsChangesPanelOpen] = useState(() => localStorage.getItem('changes_panel_open') === 'true');
  useEffect(() => { localStorage.setItem('changes_panel_open', String(isChangesPanelOpen)); }, [isChangesPanelOpen]);
  const [requestedDiffPath, setRequestedDiffPath] = useState(null);
  // 활성 세션 정보 — host 세션이면 cwd 추적 안 함
  const activeSessionInfo = useMemo(() => sessions.find((s) => s.id === activeSessionId) || null, [sessions, activeSessionId]);
  const isActiveLocal = activeSessionInfo && !activeSessionInfo.hostId;
  // 활성 터미널의 현재 작업 디렉토리 → git context 의 기준 경로
  const { workspaceRelative: activeCwdRel } = useActiveTerminalCwd({
    sessionId: isActiveLocal ? activeSessionId : null,
    isLocal: !!isActiveLocal,
  });
  const gitContextPath = activeCwdRel ?? '';
  // 헤더 뱃지/사이드바 둘 다 라이브 — 활성 터미널의 cwd 기준 git 폴링.
  // 경로 미지정 (= 전체 워크스페이스 집계) 일 때는 부하 줄이려고 폴링 간격 길게.
  const { items: gitChanges } = useGitChanges({
    enabled: true,
    path: gitContextPath,
    intervalMs: gitContextPath ? 4000 : 9000,
  });
  const handleSelectChangedFile = useCallback((path) => {
    setRequestedDiffPath(path);
    setIsChangesPanelOpen(true);
  }, []);

  const openHost = useCallback(async (host) => {
    // \"This machine\" 가상 호스트 → 로컬 tmux 세션 새로 생성
    if (host?.id === 'local' || host?.isLocal) {
      await createSession(null);
      return;
    }
    const tabId = `host:${host.id}:${Date.now()}`;
    setHostTabs(prev => [...prev, {
      id: tabId,
      hostId: host.id,
      name: host.name,
      color_index: host.color_index,
      kind: 'host',
    }]);
    setActiveSessionId(tabId);
  }, [createSession, setActiveSessionId]);

  // UI State
  const [isMobile, setIsMobile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebar_open');
    if (saved !== null) return saved === 'true';
    return window.innerWidth >= 768;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => parseInt(localStorage.getItem('sidebar_width') || '280'));
  const [isResizing, setIsResizing] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hoveredDropdownItem, setHoveredDropdownItem] = useState(null);
  const [scrollBtnClicked, setScrollBtnClicked] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, sessionId: null, title: '', message: '', isLogout: false });
  const [notification, setNotification] = useState({ isOpen: false, message: '' });
  
  // Split View State
  const [editorHeight, setEditorHeight] = useState(() => parseInt(localStorage.getItem('editor_height') || '500'));
  const [isResizingEditor, setIsResizingEditor] = useState(false);

  // File/Folder State
  const [openFiles, setOpenFiles] = useState([]); 
  const [activeFile, setActiveFile] = useState(null); 
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const [commandInputOpen, setCommandInputOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState('');
  const [filePickerItems, setFilePickerItems] = useState([]);
  const [isFilePickerLoading, setIsFilePickerLoading] = useState(false);
  // N-pane split: activeSessionId = focused pane(0). extraPanes = 옆 pane들의 sessionId (최대 3).
  // 전체 visible panes = [activeSessionId, ...extraPanes] (길이 1..4)
  const [extraPanes, setExtraPanes] = useState([]);
  const MAX_PANES = 4;
  const [isTerminalSearchOpen, setIsTerminalSearchOpen] = useState(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('');
  const [terminalSearchStatus, setTerminalSearchStatus] = useState('');
  const terminalSearchInputRef = useRef(null);

  const terminalRef = useRef(null);
  const visiblePaneIds = useMemo(() => [activeSessionId, ...extraPanes].filter(Boolean).slice(0, MAX_PANES), [activeSessionId, extraPanes]);
  const paneCount = visiblePaneIds.length;
  const terminalLayoutSignal = `${isMobile ? 'm' : 'd'}:${isSidebarOpen ? sidebarWidth : 0}:${activeFile ? editorHeight : 0}:${activeFile ? 'editor-open' : 'editor-closed'}:panes-${visiblePaneIds.join(',')}`;

  // Responsive & Viewport
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    if (window.visualViewport) {
      const handleViewport = () => setViewportHeight(window.visualViewport.height);
      window.visualViewport.addEventListener('resize', handleViewport);
      return () => {
        window.removeEventListener('resize', checkMobile);
        window.visualViewport.removeEventListener('resize', handleViewport);
      };
    }
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    localStorage.setItem('sidebar_open', isSidebarOpen.toString());
    localStorage.setItem('sidebar_width', sidebarWidth.toString());
    localStorage.setItem('editor_height', editorHeight.toString());
  }, [isSidebarOpen, sidebarWidth, editorHeight]);

  // Actions
  const handleNewSession = () => createSession(selectedFolderPath);
  const handleLogoutRequest = () => setConfirmModal({
    isOpen: true, isLogout: true, title: t('confirmLogout'), message: t('logoutMessage')
  });

  const handleConfirmModal = async () => {
    if (confirmModal.isLogout) {
      logout();
    } else if (confirmModal.sessionId) {
      await deleteSession(confirmModal.sessionId);
    }
    setConfirmModal({ isOpen: false, sessionId: null, title: '', message: '', isLogout: false });
  };

  const handleScrollToBottom = () => {
    if (window.terminalSessions?.[activeSessionId]) {
      setScrollBtnClicked(true);
      setTimeout(() => setScrollBtnClicked(false), 300);
      window.terminalSessions[activeSessionId].scrollToBottom();
    }
  };

  const focusActiveTerminal = useCallback(() => {
    window.terminalSessions?.[activeSessionId]?.focus?.();
  }, [activeSessionId]);

  const clearActiveTerminal = useCallback(() => {
    window.terminalSessions?.[activeSessionId]?.clear?.();
  }, [activeSessionId]);

  const executeTerminalSearch = useCallback((direction = 'next') => {
    if (!terminalSearchQuery.trim()) return;

    const sessionApi = window.terminalSessions?.[activeSessionId];
    if (!sessionApi) return;

    let matched = false;
    if (direction === 'previous') {
      matched = sessionApi.searchPrevious?.(terminalSearchQuery, { caseSensitive: false, regex: false, wholeWord: false }) || false;
    } else {
      matched = sessionApi.searchNext?.(terminalSearchQuery, { caseSensitive: false, regex: false, wholeWord: false }) || false;
    }

    setTerminalSearchStatus(matched ? t('searchMatchFound') : t('searchNoResults'));
  }, [activeSessionId, terminalSearchQuery, t]);

  const openTerminalSearch = useCallback(() => {
    setTerminalSearchStatus('');
    setIsTerminalSearchOpen(true);
    setTimeout(() => terminalSearchInputRef.current?.focus(), 20);
  }, []);

  const closeTerminalSearch = useCallback(() => {
    setTerminalSearchStatus('');
    setIsTerminalSearchOpen(false);
    window.terminalSessions?.[activeSessionId]?.closeSearch?.();
  }, [activeSessionId]);

  const openCommandPalette = useCallback(() => {
    setCommandPaletteQuery('');
    setIsCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
  }, []);

  const openFilePicker = useCallback(() => {
    setFilePickerQuery('');
    setFilePickerItems(
      openFiles.map((path) => ({
        id: `recent:${path}`,
        path,
        label: path,
      }))
    );
    setIsFilePickerOpen(true);
  }, [openFiles]);

  const closeFilePicker = useCallback(() => {
    setIsFilePickerOpen(false);
  }, []);

  // pane 추가 — 사용 안 된 기존 세션이 있으면 그걸 쓰고, 없으면 새 로컬 세션을 즉석 생성
  const addPane = useCallback(async () => {
    if (paneCount >= MAX_PANES) return;
    const used = new Set(visiblePaneIds);
    const candidate = sessions.find((s) => !used.has(s.id));
    if (candidate) {
      setExtraPanes((prev) => [...prev, candidate.id]);
      return;
    }
    // 모든 세션이 이미 다른 pane 에 잡혀있다 → 새 로컬 세션 생성하면서 분할
    const newId = await createSession(null);
    if (newId) {
      setExtraPanes((prev) => [...prev, newId]);
    }
  }, [paneCount, visiblePaneIds, sessions, createSession]);

  // 특정 세션을 즉시 새 pane 으로 (드래그 드롭에서 사용)
  const addPaneWithSession = useCallback((sessionId) => {
    if (!sessionId) return;
    if (paneCount >= MAX_PANES) return;
    if (sessionId === activeSessionId || extraPanes.includes(sessionId)) {
      // 이미 어느 pane 에 있으면 활성 pane 으로 가져오기만
      setActiveSessionId(sessionId);
      return;
    }
    setExtraPanes((prev) => [...prev, sessionId]);
  }, [paneCount, activeSessionId, extraPanes, setActiveSessionId]);

  const removePane = useCallback((paneIdx) => {
    if (paneIdx === 0) {
      // 첫 pane(=active)을 닫으려면 다음 pane 으로 active 이동
      if (extraPanes.length === 0) return;
      const next = extraPanes[0];
      setExtraPanes((prev) => prev.slice(1));
      setActiveSessionId(next);
      return;
    }
    setExtraPanes((prev) => prev.filter((_, i) => i !== paneIdx - 1));
  }, [extraPanes, setActiveSessionId]);

  const focusPane = useCallback((paneIdx) => {
    if (paneIdx === 0) return;
    const targetId = extraPanes[paneIdx - 1];
    if (!targetId) return;
    // 첫 pane 의 session 과 클릭한 pane 의 session 을 swap → activeSessionId 가 클릭한 것으로 이동
    setExtraPanes((prev) => {
      const next = [...prev];
      next[paneIdx - 1] = activeSessionId;
      return next;
    });
    setActiveSessionId(targetId);
  }, [extraPanes, activeSessionId, setActiveSessionId]);

  // 세션이 사라지면 pane 정리
  useEffect(() => {
    setExtraPanes((prev) => prev.filter((id) => sessions.some((s) => s.id === id)));
  }, [sessions]);

  const commandPaletteItems = useMemo(() => [
    {
      id: 'new-terminal',
      label: t('newSession'),
      shortcut: 'Ctrl+Shift+N',
      keywords: ['terminal', 'session', 'new'],
      action: handleNewSession,
    },
    {
      id: 'toggle-sidebar',
      label: isSidebarOpen ? t('closeSidebar') : t('sessions'),
      shortcut: 'Ctrl+B',
      keywords: ['sidebar', 'panel', 'toggle'],
      action: () => setIsSidebarOpen((prev) => !prev),
    },
    {
      id: 'open-settings',
      label: t('settings'),
      shortcut: 'Ctrl+,',
      keywords: ['preferences', 'config'],
      action: () => setIsSettingsOpen(true),
    },
    {
      id: 'quick-open-files',
      label: t('quickOpenFiles'),
      shortcut: 'Ctrl+P',
      keywords: ['file', 'open', 'quick'],
      action: openFilePicker,
    },
    {
      id: 'split-add',
      label: t('splitTerminal'),
      shortcut: 'Ctrl+\\',
      keywords: ['split', 'pane', 'terminal'],
      action: addPane,
    },
    {
      id: 'split-remove',
      label: t('unsplitTerminal'),
      shortcut: 'Ctrl+Shift+\\',
      keywords: ['unsplit', 'close pane'],
      action: () => removePane(extraPanes.length),
    },
    {
      id: 'focus-terminal',
      label: t('focusTerminal'),
      shortcut: 'Ctrl+`',
      keywords: ['focus', 'terminal'],
      action: focusActiveTerminal,
    },
    {
      id: 'find-terminal',
      label: t('findInTerminal'),
      shortcut: 'Ctrl+Shift+F',
      keywords: ['search', 'find', 'terminal'],
      action: openTerminalSearch,
    },
    {
      id: 'clear-terminal',
      label: t('clearTerminal'),
      shortcut: 'Ctrl+K',
      keywords: ['clear', 'screen'],
      action: clearActiveTerminal,
    },
    {
      id: 'scroll-bottom',
      label: t('scrollToBottom'),
      shortcut: 'Ctrl+End',
      keywords: ['scroll', 'bottom'],
      action: handleScrollToBottom,
    },
    {
      id: 'close-active',
      label: t('closeActiveTerminal'),
      shortcut: 'Ctrl+W',
      keywords: ['close', 'terminal', 'session'],
      action: () => {
        if (!activeSessionId) return;
        setConfirmModal({
          isOpen: true,
          sessionId: activeSessionId,
          title: t('closeTerminal'),
          message: t('confirmCloseTerminal'),
          isLogout: false,
        });
      },
    },
  ], [
    t,
    handleNewSession,
    isSidebarOpen,
    openFilePicker,
    addPane,
    removePane,
    extraPanes,
    focusActiveTerminal,
    openTerminalSearch,
    clearActiveTerminal,
    handleScrollToBottom,
    activeSessionId,
  ]);

  const executeCommandPaletteAction = useCallback((commandId) => {
    const command = commandPaletteItems.find((item) => item.id === commandId);
    if (!command) return;
    closeCommandPalette();
    command.action();
  }, [commandPaletteItems, closeCommandPalette]);

  const executeFilePickerAction = useCallback((itemId) => {
    const selected = filePickerItems.find((item) => item.id === itemId);
    if (!selected) return;
    handleFileOpen(selected.path);
    closeFilePicker();
  }, [filePickerItems, closeFilePicker]);

  useEffect(() => {
    if (!isFilePickerOpen) return;

    const query = filePickerQuery.trim();
    const token = localStorage.getItem('auth_token');
    const controller = new AbortController();

    if (!query) {
      setFilePickerItems(
        openFiles.map((path) => ({
          id: `recent:${path}`,
          path,
          label: path,
        }))
      );
      setIsFilePickerLoading(false);
      return () => controller.abort();
    }

    const debounce = setTimeout(async () => {
      setIsFilePickerLoading(true);
      try {
        const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}&limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items = (data.items || []).map((item) => ({
          id: `search:${item.path}`,
          path: item.path,
          label: item.path,
          keywords: [item.name, item.path],
        }));
        setFilePickerItems(items);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setFilePickerItems([]);
        }
      } finally {
        setIsFilePickerLoading(false);
      }
    }, 120);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [isFilePickerOpen, filePickerQuery, openFiles]);

  // 활성 세션이 다른 pane 에도 있다면 (sidebar 클릭으로) 그 pane 을 제거 — 첫 pane 으로 통합
  useEffect(() => {
    if (!activeSessionId) return;
    setExtraPanes((prev) => prev.filter((id) => id !== activeSessionId));
  }, [activeSessionId]);

  useEffect(() => {
    const isFormElement = (target) => {
      if (!target || !(target instanceof HTMLElement)) return false;
      if (target.classList.contains('xterm-helper-textarea')) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const onKeyDown = (event) => {
      if (isFormElement(event.target)) return;
      if (isCommandPaletteOpen || isTerminalSearchOpen || isFilePickerOpen) return;

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'P' || event.key === 'p')) {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
        event.preventDefault();
        openFilePicker();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setIsSettingsOpen(true);
        return;
      }

    };

    const onOpenTerminalSearch = (event) => {
      if (!event.detail?.sessionId || event.detail.sessionId !== activeSessionId) return;
      openTerminalSearch();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('terminal:open-search', onOpenTerminalSearch);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('terminal:open-search', onOpenTerminalSearch);
    };
  }, [activeSessionId, openCommandPalette, openTerminalSearch, openFilePicker, isCommandPaletteOpen, isTerminalSearchOpen, isFilePickerOpen]);

  useEffect(() => {
    setTerminalSearchStatus('');
  }, [terminalSearchQuery]);

  useEffect(() => {
    if (!isTerminalSearchOpen) return;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTerminalSearch();
        focusActiveTerminal();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        executeTerminalSearch(event.shiftKey ? 'previous' : 'next');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTerminalSearchOpen, closeTerminalSearch, focusActiveTerminal, executeTerminalSearch]);

  const handleFileOpen = (path) => {
    if (!openFiles.includes(path)) {
      setOpenFiles([...openFiles, path]);
    }
    setActiveFile(path);
  };

  const handleFileClose = (path) => {
    const newOpenFiles = openFiles.filter(f => f !== path);
    setOpenFiles(newOpenFiles);
    if (activeFile === path) {
      if (newOpenFiles.length > 0) setActiveFile(newOpenFiles[newOpenFiles.length - 1]);
      else setActiveFile(null);
    }
  };

  // Editor Resizing Logic
  const onEditorResizeStart = (e) => {
    if (typeof e.preventDefault === 'function' && e.cancelable !== false) {
      e.preventDefault();
    }
    setIsResizingEditor(true);
    const startY = e.clientY || (e.touches && e.touches[0].clientY);
    const startHeight = editorHeight;

    const onMove = (moveEvent) => {
      const currentY = moveEvent.clientY || (moveEvent.touches && moveEvent.touches[0].clientY);
      const deltaY = currentY - startY;
      const newHeight = Math.max(150, Math.min(window.innerHeight - 150, startHeight + deltaY));
      setEditorHeight(newHeight);
    };

    const onUp = () => {
      setIsResizingEditor(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };
  if (isLoading) return <LoadingScreen currentTheme={currentTheme} t={t} />;
  if (needsSetup) return <Suspense fallback={null}><InitialSetup onComplete={completeSetup} language={settings.language} /></Suspense>;
  if (!isAuthenticated) return <Suspense fallback={null}><Login onLogin={login} language={settings.language} /></Suspense>;

  return (
    <div style={{
      ...AppStyles.container,
      backgroundColor: currentTheme.ui.bg,
      height: isMobile ? `${viewportHeight}px` : '100vh',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <style>{`
        /* Global Scrollbar Styles */
        * {
          scrollbar-width: thin;
          scrollbar-color: ${currentTheme.ui.bgTertiary} transparent;
        }

        /* Webkit browsers (Chrome, Safari, Edge) */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: ${currentTheme.ui.bgTertiary};
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: ${currentTheme.ui.accent}88;
        }

        ::-webkit-scrollbar-corner {
          background: transparent;
        }
      `}</style>
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewSession={handleNewSession}
        onCloseSession={(id) => setConfirmModal({ isOpen: true, sessionId: id, title: t('closeTerminal'), message: t('confirmCloseTerminal') })}
        onRenameSession={renameSession}
        onReconnectSession={(id) => { setActiveSessionId(null); setTimeout(() => setActiveSessionId(id), 50); }}
        hosts={hosts}
        activeSession={activeSessionInfo}
        gitContextPath={gitContextPath}
        onSelectChangedFile={handleSelectChangedFile}
        onConnectHost={openHost}
        onAddHost={() => setHostEditorState({ isOpen: true, host: null })}
        onEditHost={(h) => setHostEditorState({ isOpen: true, host: h })}
        onDeleteHost={async (h) => {
          if (confirm(t('confirmDeleteHost') || 'Delete this host?')) {
            await deleteHost(h.id);
          }
        }}
        onManageKeys={() => setKeyManagerOpen(true)}
        language={settings.language}
        theme={currentTheme}
        isMobile={isMobile} 
        width={sidebarWidth} 
        onResizeStart={(e) => {
          e.preventDefault();
          setIsResizing(true);
          const startX = e.clientX;
          const startWidth = sidebarWidth;
          const onMove = (me) => setSidebarWidth(Math.max(180, Math.min(400, startWidth + me.clientX - startX)));
          const onUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }} 
        onFileSelect={handleFileOpen} 
        onFolderSelect={setSelectedFolderPath} 
        onOpenTerminalAtFolder={async (path) => {
          const newId = await createSession(path);
          if (newId && isMobile) {
            setIsSidebarOpen(false);
          }
        }} 
        selectedFolderPath={selectedFolderPath}
        viewportHeight={viewportHeight}
      />

      <div style={{
        position: 'absolute',
        top: 0,
        left: !isMobile && isSidebarOpen ? `${sidebarWidth}px` : '0',
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        transition: isResizing ? 'none' : 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        backgroundColor: currentTheme.ui.bg,
        overflow: 'visible',
        zIndex: 10,
        boxShadow: currentTheme.ui.shadow,
      }}>
        {/* Inner Highlight for Skeuomorphism */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.05)',
          zIndex: 101,
          pointerEvents: 'none'
        }} />
        <Header
          isSidebarOpen={isSidebarOpen}
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          sessions={sessions}
          activeSessionId={activeSessionId}
          isMobile={isMobile}
          scrollBtnClicked={scrollBtnClicked}
          handleScrollToBottom={handleScrollToBottom}
          isMenuOpen={isMenuOpen}
          setIsMenuOpen={setIsMenuOpen}
          currentTheme={currentTheme}
          t={t}
          authState={{ username }}
          handleNewSession={handleNewSession}
          setIsSettingsOpen={setIsSettingsOpen}
          handleLogoutRequest={handleLogoutRequest}
          paneCount={paneCount}
          maxPanes={MAX_PANES}
          onAddPane={addPane}
          onClosePane={() => removePane(extraPanes.length)}
          isChangesPanelOpen={isChangesPanelOpen}
          toggleChangesPanel={() => setIsChangesPanelOpen((p) => !p)}
          changesCount={gitChanges.length}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', minWidth: 0 }}>
          
          {/* 에디터 영역 (높이 가변형) */}
          {activeFile && (
            <div style={{ 
              height: `${editorHeight}px`, 
              position: 'relative', 
              zIndex: 10,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: '150px'
            }}>
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

          {/* 터미널 영역 (남은 공간 차지) — 외곽 패딩 없음. 여백은 pane 내부에서 처리 */}
          <div
            ref={terminalRef}
            style={{
              ...AppStyles.terminalContainer,
              backgroundColor: currentTheme.background,
              flex: 1,
              userSelect: 'text',
              WebkitUserSelect: 'text',
              paddingBottom: isMobile ? '80px' : '0',
              minHeight: '150px'
            }}
          >
            {sessions.length === 0 ? (
              <EmptyState currentTheme={currentTheme} t={t} handleNewSession={handleNewSession} />
            ) : (
              <PaneGrid
                visiblePaneIds={visiblePaneIds}
                sessions={sessions}
                activeSessionId={activeSessionId}
                paneCount={paneCount}
                isMobile={isMobile}
                currentTheme={currentTheme}
                settings={settings}
                terminalLayoutSignal={terminalLayoutSignal}
                onFocusPane={focusPane}
                onClosePane={removePane}
                onDropSession={addPaneWithSession}
              />
            )}
          </div>
        </div>
        {isChangesPanelOpen && (
          <Suspense fallback={null}>
            <ChangesPanel
              isOpen={isChangesPanelOpen}
              onClose={() => setIsChangesPanelOpen(false)}
              onOpenFile={(path) => handleFileOpen(path)}
              externalSelectedPath={requestedDiffPath}
              onConsumedExternalPath={() => setRequestedDiffPath(null)}
              gitContextPath={gitContextPath}
              t={t}
            />
          </Suspense>
        )}
        </div>

        {isTerminalSearchOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: isMobile ? '8px' : '12px',
            zIndex: 1002,
            width: isMobile ? 'min(98vw, 360px)' : '420px',
            maxWidth: 'calc(100vw - 24px)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: currentTheme.ui.bgSecondary,
            border: `1px solid ${currentTheme.ui.border}`,
            borderRadius: currentTheme.ui.radius || '6px',
            padding: '6px',
            boxShadow: currentTheme.ui.shadow,
          }}>
            <input
              ref={terminalSearchInputRef}
              value={terminalSearchQuery}
              onChange={(event) => setTerminalSearchQuery(event.target.value)}
              placeholder={t('findInTerminal')}
              style={{
                flex: 1,
                height: '30px',
                border: `1px solid ${currentTheme.ui.borderLight}`,
                borderRadius: '4px',
                backgroundColor: currentTheme.ui.bg,
                color: currentTheme.ui.text,
                padding: '0 10px',
                outline: 'none',
                fontSize: '13px',
                fontWeight: 600,
              }}
            />
            <span style={{
              minWidth: '104px',
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: terminalSearchStatus === t('searchNoResults') ? currentTheme.red : currentTheme.ui.textSecondary,
            }}>
              {terminalSearchStatus}
            </span>
            <button
              type="button"
              onClick={() => executeTerminalSearch('previous')}
              style={{
                border: `1px solid ${currentTheme.ui.borderLight}`,
                background: 'transparent',
                color: currentTheme.ui.text,
                borderRadius: '4px',
                height: '30px',
                padding: '0 10px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => executeTerminalSearch('next')}
              style={{
                border: `1px solid ${currentTheme.ui.borderLight}`,
                background: currentTheme.ui.accent,
                color: currentTheme.ui.bg,
                borderRadius: '4px',
                height: '30px',
                padding: '0 10px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={closeTerminalSearch}
              style={{
                border: 'none',
                background: 'transparent',
                color: currentTheme.ui.textSecondary,
                height: '30px',
                width: '30px',
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: '14px',
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {isMobile && (
        <Suspense fallback={null}>
          <MobileToolbar 
            onSendKey={(key) => window.terminalSessions?.[activeSessionId]?.sendData(key)} 
            onOpenCommandInput={() => setCommandInputOpen(true)}
            language={settings.language}
            currentTheme={currentTheme}
          />
        </Suspense>
      )}

      {/* 모바일 드롭다운 메뉴 */}
      {isMobile && isMenuOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 100000 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={() => setIsMenuOpen(false)} />
          <div style={{
            position: 'absolute',
            top: '40px',
            right: '8px',
            width: '180px',
            backgroundColor: currentTheme.ui.bgSecondary,
            border: `1px solid ${currentTheme.ui.border}`,
            borderRadius: currentTheme.ui.radius || '4px',
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            zIndex: 100001
          }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${currentTheme.ui.borderLight}`, marginBottom: '4px' }}>
              <div style={{ fontSize: '10px', color: currentTheme.ui.textSecondary, textTransform: 'uppercase' }}>{t('user')}</div>
              <div style={{ fontWeight: '800', color: currentTheme.ui.accent }}>{username}</div>
            </div>
            <button onClick={() => { handleNewSession(); setIsMenuOpen(false); }} style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.ui.text, textAlign: 'left', fontWeight: '600', fontSize: '13px', borderRadius: '4px' }}>{t('newSession')}</button>
            <button onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }} style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.ui.text, textAlign: 'left', fontWeight: '600', fontSize: '13px', borderRadius: '4px' }}>{t('settings')}</button>
            <button onClick={() => { handleLogoutRequest(); setIsMenuOpen(false); }} style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.red, textAlign: 'left', fontWeight: '700', fontSize: '13px', borderRadius: '4px' }}>{t('logout')}</button>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          query={commandPaletteQuery}
          onQueryChange={setCommandPaletteQuery}
          onClose={closeCommandPalette}
          commands={commandPaletteItems}
          onExecute={executeCommandPaletteAction}
          theme={currentTheme}
          title={t('commandPalette')}
          placeholder={t('commandPalettePlaceholder')}
          emptyLabel={t('noCommandsFound')}
        />
        <CommandPalette
          isOpen={isFilePickerOpen}
          query={filePickerQuery}
          onQueryChange={setFilePickerQuery}
          onClose={closeFilePicker}
          commands={filePickerItems}
          onExecute={executeFilePickerAction}
          theme={currentTheme}
          title={isFilePickerLoading ? `${t('quickOpenFiles')}...` : t('quickOpenFiles')}
          placeholder={t('quickOpenPlaceholder')}
          emptyLabel={isFilePickerLoading ? t('searchingFiles') : t('noFilesFound')}
        />
        <CommandInput isOpen={commandInputOpen} onClose={() => setCommandInputOpen(false)} onSend={(cmd) => window.terminalSessions?.[activeSessionId]?.sendData(cmd + '\n')} command={commandText} setCommand={setCommandText} theme={currentTheme} t={t} />
        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onSave={updateSettings} theme={currentTheme} username={username} />
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} confirmText={confirmModal.isLogout ? t('logout') : t('close')} cancelText={t('cancel')} onConfirm={handleConfirmModal} onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })} language={settings.language} danger={true} theme={currentTheme} />
        <NotificationModal isOpen={notification.isOpen} message={notification.message} onClose={() => setNotification({ isOpen: false, message: '' })} theme={currentTheme} />

        <Suspense fallback={null}>
          <HostEditor
            isOpen={hostEditorState.isOpen}
            host={hostEditorState.host}
            sshKeys={sshKeys}
            t={t}
            onClose={() => setHostEditorState({ isOpen: false, host: null })}
            onSave={async (draft) => {
              if (hostEditorState.host) {
                await updateHost(hostEditorState.host.id, draft);
                setHostEditorState({ isOpen: false, host: null });
              } else {
                await createHost(draft);
                // 새 호스트 추가 직후 곧장 연결되도록 (Termius 풍의 \"이지\" UX)
                const fresh = await refreshHosts();
                const justAdded = (fresh || []).find(h => h.name === draft.name && h.hostname === draft.hostname);
                setHostEditorState({ isOpen: false, host: null });
                if (justAdded) openHost(justAdded);
              }
            }}
          />
          <SshKeyManager
            isOpen={keyManagerOpen}
            keys={sshKeys}
            t={t}
            onClose={() => setKeyManagerOpen(false)}
            onAdd={async (draft) => { await createKey(draft); }}
            onDelete={async (id) => {
              if (confirm(t('confirmDeleteKey') || 'Delete this SSH key?')) {
                await deleteKey(id);
              }
            }}
          />
        </Suspense>
      </Suspense>
    </div>
  );
}

export default App;
