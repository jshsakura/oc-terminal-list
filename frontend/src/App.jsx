/**
 * App 컴포넌트
 * 메인 애플리케이션 - 멀티 터미널 세션 관리 및 에디터 리사이즈 지원
 */
import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import useSettings from './hooks/useSettings';
import useTranslation from './hooks/useTranslation';
import useAuth from './hooks/useAuth';
import useSessionManager from './hooks/useSessionManager';
import useSwipe from './hooks/useSwipe';
import themes from './styles/themes';
import AppStyles from './styles/AppStyles';

// Layout Components
import Header from './components/layout/Header';
import EmptyState from './components/layout/EmptyState';
import LoadingScreen from './components/layout/LoadingScreen';

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
    sessions, activeSessionId, setActiveSessionId, 
    createSession, deleteSession, renameSession 
  } = useSessionManager(isAuthenticated, settings.defaultShell);

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
  const [isSplitTerminal, setIsSplitTerminal] = useState(false);
  const [secondarySessionId, setSecondarySessionId] = useState(null);
  const [isTerminalSearchOpen, setIsTerminalSearchOpen] = useState(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('');
  const [terminalSearchStatus, setTerminalSearchStatus] = useState('');
  const terminalSearchInputRef = useRef(null);

  const terminalRef = useRef(null);
  const terminalLayoutSignal = `${isMobile ? 'm' : 'd'}:${isSidebarOpen ? sidebarWidth : 0}:${activeFile ? editorHeight : 0}:${activeFile ? 'editor-open' : 'editor-closed'}:${isSplitTerminal ? `split-${secondarySessionId || 'none'}` : 'single'}`;

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

  const toggleTerminalSplit = useCallback(() => {
    if (sessions.length < 2) {
      setNotification({ isOpen: true, message: t('needTwoSessionsForSplit') });
      return;
    }

    if (isSplitTerminal) {
      setIsSplitTerminal(false);
      setSecondarySessionId(null);
      return;
    }

    const fallbackSecondary = sessions.find((session) => session.id !== activeSessionId)?.id || null;
    setSecondarySessionId(fallbackSecondary);
    setIsSplitTerminal(true);
  }, [sessions, isSplitTerminal, activeSessionId, t]);

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
      id: 'split-terminal',
      label: isSplitTerminal ? t('unsplitTerminal') : t('splitTerminal'),
      shortcut: 'Ctrl+\\',
      keywords: ['split', 'pane', 'terminal'],
      action: toggleTerminalSplit,
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
    isSplitTerminal,
    toggleTerminalSplit,
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

  useEffect(() => {
    if (!isSplitTerminal) return;

    if (sessions.length < 2) {
      setIsSplitTerminal(false);
      setSecondarySessionId(null);
      return;
    }

    if (!secondarySessionId || secondarySessionId === activeSessionId || !sessions.some((session) => session.id === secondarySessionId)) {
      const fallbackSecondary = sessions.find((session) => session.id !== activeSessionId)?.id || null;
      setSecondarySessionId(fallbackSecondary);
    }
  }, [isSplitTerminal, sessions, activeSessionId, secondarySessionId]);

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
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          
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

          {/* 터미널 영역 (남은 공간 차지) */}
          <div
            ref={terminalRef}
            style={{
              ...AppStyles.terminalContainer,
              backgroundColor: currentTheme.ui.bg,
              flex: 1,
              userSelect: 'text',
              WebkitUserSelect: 'text',
              paddingTop: isMobile ? '5px' : '6px',
              paddingBottom: isMobile ? '80px' : '6px',
              paddingLeft: '10px',
              paddingRight: '10px',
              minHeight: '150px'
            }}
          >
            {sessions.length === 0 ? (
              <EmptyState currentTheme={currentTheme} t={t} handleNewSession={handleNewSession} />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: isSplitTerminal ? (isMobile ? 'column' : 'row') : 'column',
                  gap: isSplitTerminal ? '6px' : 0,
                }}
              >
                {sessions.map((session) => {
                  const visibleInSplit = isSplitTerminal && (session.id === activeSessionId || session.id === secondarySessionId);
                  const isVisible = isSplitTerminal ? visibleInSplit : session.id === activeSessionId;
                  if (!isVisible) return null;

                  const isFocusedPane = session.id === activeSessionId;
                  return (
                    <div
                      key={`session-container-${session.id}`}
                      onMouseDown={() => setActiveSessionId(session.id)}
                      style={{
                        width: isSplitTerminal && !isMobile ? '50%' : '100%',
                        height: isSplitTerminal && isMobile ? '50%' : '100%',
                        border: isSplitTerminal ? `1px solid ${isFocusedPane ? currentTheme.ui.accent : currentTheme.ui.borderLight}` : 'none',
                        borderRadius: isSplitTerminal ? '8px' : 0,
                        overflow: 'hidden',
                        boxShadow: isSplitTerminal && isFocusedPane ? `0 0 0 1px ${currentTheme.ui.accent}66 inset` : 'none',
                      }}
                    >
                      <Suspense fallback={null}>
                        <Terminal
                          sessionId={session.id}
                          settings={settings}
                          isActive={session.id === activeSessionId}
                          layoutSignal={terminalLayoutSignal}
                        />
                      </Suspense>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
      </Suspense>
    </div>
  );
}

export default App;
