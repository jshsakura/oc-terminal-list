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
  const [openFiles, setOpenFiles] = useState([]); // 열려있는 파일 배열
  const [activeFile, setActiveFile] = useState(null); // 현재 활성화된 파일
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

  // 파일 열기 핸들러
  const handleFileOpen = (path) => {
    if (!openFiles.includes(path)) {
      setOpenFiles([...openFiles, path]);
    }
    setActiveFile(path);
  };

  // 파일 닫기 핸들러
  const handleFileClose = (path) => {
    const newOpenFiles = openFiles.filter(f => f !== path);
    setOpenFiles(newOpenFiles);
    
    // 닫는 파일이 활성 파일이었다면 다른 파일 활성화
    if (activeFile === path) {
      if (newOpenFiles.length > 0) {
        setActiveFile(newOpenFiles[newOpenFiles.length - 1]);
      } else {
        setActiveFile(null);
      }
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
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* 1. 사이드바 (모바일은 오버레이, 데스크탑은 고정) */}
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
        onOpenTerminalAtFolder={createSession} 
        selectedFolderPath={selectedFolderPath}
      />

      {/* 2. 메인 콘텐츠 영역 (사이드바에 의해 밀려남) */}
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
        overflow: 'visible', // 헤더 드롭다운이 밖으로 나갈 수 있게 함
        zIndex: 10,
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

        {/* 에디터와 터미널 작업 영역 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          {/* 에디터 영역 */}
          {activeFile && (
            <div style={{ flex: 1, position: 'relative', zIndex: 10 }}>
              <Suspense fallback={null}>
                <FileEditor 
                  activeFile={activeFile} 
                  openFiles={openFiles}
                  onFileSelect={handleFileOpen}
                  onClose={handleFileClose} 
                  theme={currentTheme} 
                />
              </Suspense>
            </div>
          )}

          {/* 터미널 영역 */}
          <div 
            ref={terminalRef}
            style={{
              ...AppStyles.terminalContainer,
              display: activeFile && !isMobile ? 'none' : 'block',
              paddingBottom: isMobile ? '80px' : '0',
              backgroundColor: currentTheme.ui.bg,
              flex: 1,
              height: activeFile && !isMobile ? '0' : 'auto',
              userSelect: 'text', // 텍스트 선택 강제 허용
              WebkitUserSelect: 'text',
            }}
          >
            {sessions.length === 0 ? (
              <EmptyState currentTheme={currentTheme} t={t} handleNewSession={handleNewSession} />
            ) : (
              sessions.map((session) => (
                <div 
                  key={`session-container-${session.id}`} 
                  style={{ display: session.id === activeSessionId ? 'block' : 'none', width: '100%', height: '100%' }}
                >
                  <Suspense fallback={null}>
                    <Terminal sessionId={session.id} settings={settings} isActive={session.id === activeSessionId} />
                  </Suspense>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3. 모바일 하단 툴바 */}
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

      {/* 4. [중요] 모바일 드롭다운 메뉴 - 모든 레이어의 최상위에 배치 */}
      {isMobile && isMenuOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 100000 }}>
          {/* 오버레이 (클릭 시 닫힘) */}
          <div 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.4)' }} 
            onClick={() => setIsMenuOpen(false)} 
          />
          
          {/* 메뉴 박스 (헤더 바로 아래 우측 상단 고정) */}
          <div style={{
            position: 'absolute',
            top: '40px',
            right: '8px',
            width: '180px',
            backgroundColor: currentTheme.ui.bgSecondary,
            border: `1px solid ${currentTheme.ui.border}`,
            borderRadius: '0 0 8px 8px',
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            zIndex: 100001
          }}>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${currentTheme.ui.border}`, marginBottom: '4px' }}>
              <div style={{ fontSize: '10px', color: currentTheme.ui.textSecondary, textTransform: 'uppercase' }}>{t('user')}</div>
              <div style={{ fontWeight: '800', color: currentTheme.ui.accent }}>{username}</div>
            </div>
            
            <button
              onClick={() => { handleNewSession(); setIsMenuOpen(false); }}
              style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.ui.text, textAlign: 'left', fontWeight: '600', fontSize: '14px', borderRadius: '4px' }}
            >
              {t('newSession')}
            </button>
            
            <button
              onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
              style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.ui.text, textAlign: 'left', fontWeight: '600', fontSize: '14px', borderRadius: '4px' }}
            >
              {t('settings')}
            </button>
            
            <button
              onClick={() => { handleLogoutRequest(); setIsMenuOpen(false); }}
              style={{ padding: '12px', background: 'none', border: 'none', color: currentTheme.red, textAlign: 'left', fontWeight: '700', fontSize: '14px', borderRadius: '4px' }}
            >
              {t('logout')}
            </button>
          </div>
        </div>
      )}

      {/* 5. 모달들 */}
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
