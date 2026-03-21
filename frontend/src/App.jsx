/**
 * App 컴포넌트
 * 메인 애플리케이션 - 멀티 터미널 세션 관리
 */
import { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react';
import useSettings from './hooks/useSettings';
import useTranslation from './hooks/useTranslation';
import useAuth from './hooks/useAuth';
import useSessionManager from './hooks/useSessionManager';
import useSwipe from './hooks/useSwipe';
import themes from './styles/themes';
import AppStyles from './styles/AppStyles';

// Layout Components
import Header from './components/layout/Header';
import StatusBar from './components/layout/StatusBar';
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
  
  // File/Folder State
  const [fileEditorOpen, setFileEditorOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
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
  }, [isSidebarOpen, sidebarWidth]);

  // Swipe Gestures
  const { handleTouchStart, handleTouchEnd } = useSwipe(
    () => { // Swipe Left -> Next
      const idx = sessions.findIndex(s => s.id === activeSessionId);
      if (idx < sessions.length - 1) setActiveSessionId(sessions[idx + 1].id);
    },
    () => { // Swipe Right -> Prev
      const idx = sessions.findIndex(s => s.id === activeSessionId);
      if (idx > 0) setActiveSessionId(sessions[idx - 1].id);
    }
  );

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

  // Renderers
  if (isLoading) return <LoadingScreen currentTheme={currentTheme} t={t} />;
  if (needsSetup) return <Suspense fallback={null}><InitialSetup onComplete={completeSetup} language={settings.language} /></Suspense>;
  if (!isAuthenticated) return <Suspense fallback={null}><Login onLogin={login} language={settings.language} /></Suspense>;

  return (
    <div style={{
      ...AppStyles.container,
      backgroundColor: currentTheme.ui.bg,
      height: isMobile ? `${viewportHeight}px` : '100vh',
    }}>
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
        hoveredDropdownItem={hoveredDropdownItem}
        setHoveredDropdownItem={setHoveredDropdownItem}
      />

      <div 
        ref={terminalRef}
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        style={{
          ...AppStyles.terminalContainer,
          paddingBottom: isMobile ? '80px' : '0',
          marginLeft: !isMobile && isSidebarOpen ? `${sidebarWidth}px` : '0',
          transition: isResizing ? 'none' : 'margin-left 0.3s ease',
        }}
      >
        {sessions.length === 0 ? (
          <EmptyState currentTheme={currentTheme} t={t} handleNewSession={handleNewSession} />
        ) : (
          sessions.map((session) => (
            <div key={session.id} style={{ display: session.id === activeSessionId ? 'block' : 'none', width: '100%', height: '100%' }}>
              <Suspense fallback={null}>
                <Terminal sessionId={session.id} settings={settings} isActive={session.id === activeSessionId} />
              </Suspense>
            </div>
          ))
        )}
      </div>

      {fileEditorOpen && selectedFile && (
        <Suspense fallback={null}>
          <div style={{ position: 'absolute', top: '40px', left: !isMobile && isSidebarOpen ? `${sidebarWidth}px` : '0', right: 0, bottom: isMobile ? '80px' : 0, transition: isResizing ? 'none' : 'left 0.3s ease' }}>
            <FileEditor filePath={selectedFile} onClose={() => setFileEditorOpen(false)} theme={currentTheme} />
          </div>
        </Suspense>
      )}

      {isMobile && <StatusBar sessions={sessions} activeSessionId={activeSessionId} setActiveSessionId={setActiveSessionId} currentTheme={currentTheme} />}

      {isMobile && (
        <Suspense fallback={null}>
          <MobileToolbar 
            onSendKey={(key) => window.terminalSessions?.[activeSessionId]?.sendData(key)} 
            isVisible={true} 
            activeSessionId={activeSessionId} 
            onOpenCommandInput={() => setCommandInputOpen(true)}
            language={settings.language}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <CommandInput 
          isOpen={commandInputOpen} 
          onClose={() => setCommandInputOpen(false)} 
          onSend={(cmd) => window.terminalSessions?.[activeSessionId]?.sendData(cmd + '\n')} 
          command={commandText} 
          setCommand={setCommandText} 
          theme={currentTheme} 
          t={t} 
        />
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
          onFileSelect={(path) => { setSelectedFile(path); setFileEditorOpen(true); }} 
          onFolderSelect={setSelectedFolderPath} 
          onOpenTerminalAtFolder={createSession} 
        />
        <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onSave={updateSettings} theme={currentTheme} username={username} />
        <ConfirmModal 
          isOpen={confirmModal.isOpen} 
          title={confirmModal.title} 
          message={confirmModal.message} 
          confirmText={confirmModal.isLogout ? t('logout') : t('close')} 
          cancelText={t('cancel')} 
          onConfirm={handleConfirmModal} 
          onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })} 
          language={settings.language} 
          danger={true} 
          theme={currentTheme} 
        />
        <NotificationModal isOpen={notification.isOpen} message={notification.message} onClose={() => setNotification({ isOpen: false, message: '' })} theme={currentTheme} />
      </Suspense>
    </div>
  );
}

export default App;
