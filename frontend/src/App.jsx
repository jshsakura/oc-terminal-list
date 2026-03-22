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
  } = useSessionManager(isAuthenticated);

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

  const terminalRef = useRef(null);

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
    e.preventDefault();
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
              paddingBottom: isMobile ? '80px' : '5px',
              minHeight: '150px'
            }}
          >
            {sessions.length === 0 ? (
              <EmptyState currentTheme={currentTheme} t={t} handleNewSession={handleNewSession} />
            ) : (
              <>
                {sessions.map((session) => (
                  <div 
                    key={`session-container-${session.id}`} 
                    style={{ display: session.id === activeSessionId ? 'block' : 'none', width: '100%', height: '100%' }}
                  >
                    <Suspense fallback={null}>
                      <Terminal sessionId={session.id} settings={settings} isActive={session.id === activeSessionId} />
                    </Suspense>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {isMobile && (
        <Suspense fallback={null}>
          <MobileToolbar 
            onSendKey={(key) => window.terminalSessions?.[activeSessionId]?.sendData(key)} 
            isVisible={true} 
            activeSessionId={activeSessionId} 
            onOpenCommandInput={() => setCommandInputOpen(true)}
            language={settings.language}
            theme={currentTheme}
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
        <CommandInput isOpen={commandInputOpen} onClose={() => setCommandInputOpen(false)} onSend={(cmd) => window.terminalSessions?.[activeSessionId]?.sendData(cmd + '\n')} command={commandText} setCommand={setCommandText} theme={currentTheme} t={t} />
        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onSave={updateSettings} theme={currentTheme} username={username} />
        <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} confirmText={confirmModal.isLogout ? t('logout') : t('close')} cancelText={t('cancel')} onConfirm={handleConfirmModal} onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })} language={settings.language} danger={true} theme={currentTheme} />
        <NotificationModal isOpen={notification.isOpen} message={notification.message} onClose={() => setNotification({ isOpen: false, message: '' })} theme={currentTheme} />
      </Suspense>
    </div>
  );
}

export default App;
