/**
 * App 컴포넌트
 * 메인 애플리케이션 - 멀티 터미널 세션 관리
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Plus, Settings as SettingsIcon, Power, Menu, X, PanelLeftClose, PanelLeft, ChevronsDown } from 'lucide-react';
import useSettings from './hooks/useSettings';
import useTranslation from './hooks/useTranslation';
import themes from './styles/themes';

// Lazy load components
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

// UUID 생성 함수
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// API에서 세션 목록 가져오기 (서버에서 관리)
const fetchSessionsFromAPI = async () => {
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      console.log('[DEBUG] fetchSessions: 토큰 없음');
      return [];
    }

    console.log('[DEBUG] fetchSessions: API 호출 시작');
    const response = await fetch('/api/sessions', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error('[DEBUG] fetchSessions 실패:', response.status);
      return [];
    }

    const sessions = await response.json();
    console.log('[DEBUG] fetchSessions API 응답:', sessions);

    // API 응답 형식을 앱 형식으로 변환
    const mapped = sessions.map(s => ({ id: s.id, name: s.name }));
    console.log('[DEBUG] fetchSessions 매핑 결과:', mapped);
    return mapped;
  } catch (error) {
    console.error('[DEBUG] fetchSessions 에러:', error);
    return [];
  }
};

// 활성 세션 ID 가져오기
const loadActiveSessionId = (sessions) => {
  try {
    const stored = localStorage.getItem('active_session_id');
    if (stored && sessions.some(s => s.id === stored)) {
      return stored;
    }
  } catch (error) {
    console.error('Failed to load active session:', error);
  }
  return sessions[0]?.id;
};

function App() {
  // 인증 상태
  const [authState, setAuthState] = useState({
    isLoading: true,
    needsSetup: false,
    isAuthenticated: false,
    username: null,
  });

  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  // 디버깅: sessions 변경 감지
  useEffect(() => {
    console.log('[DEBUG] sessions 변경됨:', sessions.length, sessions);
  }, [sessions]);
  const [isMobile, setIsMobile] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    // localStorage에서 사이드바 상태 복원
    const saved = localStorage.getItem('sidebar_open');
    if (saved !== null) {
      return saved === 'true';
    }
    // 기본값: PC에서는 열림
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    return !mobile;
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false); // 모바일 메뉴 드롭다운
  const [hoveredDropdownItem, setHoveredDropdownItem] = useState(null); // 드롭다운 호버
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    // localStorage에서 사이드바 너비 복원
    const saved = localStorage.getItem('sidebar_width');
    return saved ? parseInt(saved) : 280; // 기본 너비 280
  });
  const [isResizing, setIsResizing] = useState(false); // 리사이즈 중
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight); // Visual Viewport 높이
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    sessionId: null,
    title: '',
    message: '',
    isLogout: false,
  });
  const [notification, setNotification] = useState({
    isOpen: false,
    message: '',
  });
  const [fileEditorOpen, setFileEditorOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [commandInputOpen, setCommandInputOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const terminalRef = useRef(null);

  // 설정 관리
  const { settings, updateSettings } = useSettings();

  // 다국어
  const { t } = useTranslation(settings.language);

  // 스크롤바 테마 적용
  useEffect(() => {
    // 인증되지 않은 상태에서는 적용하지 않음
    if (!authState.isAuthenticated) return;

    const currentTheme = themes[settings.theme] || themes.catppuccin;
    const styleId = 'dynamic-scrollbar-theme';
    let styleElement = document.getElementById(styleId);

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = `
      ::-webkit-scrollbar {
        width: 12px;
        height: 12px;
      }

      ::-webkit-scrollbar-track {
        background: ${currentTheme.ui.bg};
      }

      ::-webkit-scrollbar-thumb {
        background: ${currentTheme.ui.border};
        border-radius: 6px;
        border: 2px solid ${currentTheme.ui.bg};
      }

      ::-webkit-scrollbar-thumb:hover {
        background: ${currentTheme.ui.textSecondary};
      }

      /* Firefox */
      * {
        scrollbar-width: thin;
        scrollbar-color: ${currentTheme.ui.border} ${currentTheme.ui.bg};
      }
    `;
  }, [settings.theme, authState.isAuthenticated]);

  // 초기 인증 상태 확인
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        // 1. 초기 설정 완료 여부 확인
        const statusResponse = await fetch('/api/auth/status');
        const statusData = await statusResponse.json();

        if (!statusData.setup_complete) {
          // 초기 설정 필요 - localStorage 정리
          localStorage.removeItem('auth_token');
          localStorage.removeItem('username');
          setAuthState({
            isLoading: false,
            needsSetup: true,
            isAuthenticated: false,
            username: null,
          });
          return;
        }

        // 2. 저장된 토큰 확인
        const token = localStorage.getItem('auth_token');
        if (!token) {
          // 로그인 필요
          setAuthState({
            isLoading: false,
            needsSetup: false,
            isAuthenticated: false,
            username: null,
          });
          return;
        }

        // 3. 토큰 유효성 검증
        const verifyResponse = await fetch('/api/auth/verify', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!verifyResponse.ok) {
          // 토큰 만료 또는 무효 - 로그인 필요
          localStorage.removeItem('auth_token');
          localStorage.removeItem('username');
          setAuthState({
            isLoading: false,
            needsSetup: false,
            isAuthenticated: false,
            username: null,
          });
          return;
        }

        const verifyData = await verifyResponse.json();

        // 인증 완료
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: true,
          username: verifyData.username,
        });
      } catch (error) {
        console.error('Auth check failed:', error);
        // 에러 발생 시 로그인 화면으로
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: false,
          username: null,
        });
      }
    };

    checkAuthStatus();
  }, []);

  // 초기 설정 완료 핸들러
  const handleSetupComplete = () => {
    // 설정 완료 후 로그인 화면으로
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: false,
      username: null,
    });
  };

  // 로그인 완료 핸들러
  const handleLogin = (token, username) => {
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: true,
      username,
    });
  };

  // 로그아웃 요청 (확인 모달 표시)
  const handleLogoutRequest = () => {
    setConfirmModal({
      isOpen: true,
      sessionId: null,
      isLogout: true,
      title: t('confirmLogout'),
      message: t('logoutMessage'),
    });
  };

  // 로그아웃 실행
  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    setSessions([]);
    setActiveSessionId(null);
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: false,
      username: null,
    });
    setConfirmModal({ isOpen: false, sessionId: null, title: '', message: '', isLogout: false });
  };

  // 세션 목록 새로고침 함수
  const refreshSessions = async () => {
    console.log('[DEBUG] refreshSessions 호출됨');
    const loadedSessions = await fetchSessionsFromAPI();
    console.log('[DEBUG] refreshSessions - 로드된 세션:', loadedSessions);
    setSessions(loadedSessions);
    console.log('[DEBUG] refreshSessions - setSessions 호출 완료');
    return loadedSessions;
  };

  // 인증 완료 시 세션 목록 로드
  useEffect(() => {
    console.log('[DEBUG] 인증 상태 변경:', authState);
    if (authState.isAuthenticated) {
      console.log('[DEBUG] 인증됨 - refreshSessions 호출');
      refreshSessions().then((loadedSessions) => {
        console.log('[DEBUG] 로드된 세션 목록:', loadedSessions);
        // 활성 세션 설정 (localStorage에서 복원 또는 첫 번째 세션)
        const storedActiveId = localStorage.getItem('active_session_id');
        if (storedActiveId && loadedSessions.some(s => s.id === storedActiveId)) {
          console.log('[DEBUG] localStorage에서 활성 세션 복원:', storedActiveId);
          setActiveSessionId(storedActiveId);
        } else if (loadedSessions.length > 0) {
          console.log('[DEBUG] 첫 번째 세션 활성화:', loadedSessions[0].id);
          setActiveSessionId(loadedSessions[0].id);
        } else {
          console.log('[DEBUG] 세션 없음');
        }
      });
    }
  }, [authState.isAuthenticated]);

  // 활성 세션 변경 시 저장 (디바이스별 활성 세션만 localStorage)
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('active_session_id', activeSessionId);
    }
  }, [activeSessionId]);

  // 사이드바 상태 저장
  useEffect(() => {
    localStorage.setItem('sidebar_open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // 사이드바 너비 저장
  useEffect(() => {
    localStorage.setItem('sidebar_width', sidebarWidth.toString());
  }, [sidebarWidth]);

  useEffect(() => {
    // 모바일 감지
    let previousIsMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

    const checkMobile = () => {
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
      setIsMobile(mobile);

      // 모바일↔PC 전환 시에만 자동 조정
      if (mobile !== previousIsMobile) {
        if (mobile) {
          setIsSidebarOpen(false);
        } else {
          setIsSidebarOpen(true);
        }
        previousIsMobile = mobile;
      }
      // 같은 디바이스 타입 내 크기 변경은 사용자 선택 유지
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Visual Viewport 감지 (키보드 올라올 때 높이 조정)
  useEffect(() => {
    if (!window.visualViewport) return;

    const handleViewportChange = () => {
      setViewportHeight(window.visualViewport.height);
    };

    handleViewportChange();
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);

    return () => {
      window.visualViewport.removeEventListener('resize', handleViewportChange);
      window.visualViewport.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  // 툴바에서 키 전송
  const handleSendKey = (key) => {
    if (window.terminalSessions && activeSessionId && window.terminalSessions[activeSessionId]) {
      window.terminalSessions[activeSessionId].sendData(key);
    }
  };

  // 스크롤 버튼 애니메이션 상태
  const [scrollBtnClicked, setScrollBtnClicked] = useState(false);

  // 맨 아래로 스크롤
  const handleScrollToBottom = () => {
    if (window.terminalSessions && activeSessionId && window.terminalSessions[activeSessionId]) {
      // 버튼 클릭 애니메이션
      setScrollBtnClicked(true);
      setTimeout(() => setScrollBtnClicked(false), 300);

      window.terminalSessions[activeSessionId].scrollToBottom();
    }
  };

  // 명령어 입력창에서 명령어 전송
  const handleSendCommand = (command) => {
    if (window.terminalSessions && activeSessionId && window.terminalSessions[activeSessionId]) {
      // 명령어 전송 후 Enter 추가
      window.terminalSessions[activeSessionId].sendData(command + '\n');
    }
  };

  // 선택된 폴더 경로 상태
  const [selectedFolderPath, setSelectedFolderPath] = useState('');

  // 파일 선택 (파일 에디터 열기)
  const handleFileSelect = (filePath) => {
    setSelectedFile(filePath);
    setFileEditorOpen(true);
  };

  // 폴더 선택 (새 터미널 시작 경로로 사용)
  const handleFolderSelect = (folderPath) => {
    setSelectedFolderPath(folderPath);
  };

  // 파일 에디터 닫기
  const handleCloseEditor = () => {
    setFileEditorOpen(false);
    setSelectedFile(null);
  };

  // 새 세션 추가
  const handleNewSession = async () => {
    const newSessionId = generateUUID();
    const token = localStorage.getItem('auth_token');

    try {
      // 서버에 세션 생성 요청
      const response = await fetch(`/api/sessions/${newSessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      });

      if (!response.ok) {
        console.error('Failed to create session on server');
        return;
      }

      // 로컬 상태 업데이트
      const newSession = { id: newSessionId };
      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSessionId);

      // 선택된 폴더가 있으면 해당 경로로 이동
      if (selectedFolderPath) {
        setTimeout(() => {
          if (window.terminalSessions && window.terminalSessions[newSessionId]) {
            const targetPath = `/workspace/${selectedFolderPath}`;
            window.terminalSessions[newSessionId].sendData(`cd "${targetPath}"\n`);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to create new session:', error);
    }
  };

  // 세션 전환
  const handleSelectSession = (sessionId) => {
    setActiveSessionId(sessionId);
  };

  // 세션 닫기 요청 (확인 모달 표시)
  const handleCloseSessionRequest = (sessionId) => {
    setConfirmModal({
      isOpen: true,
      sessionId,
      isLogout: false,
      title: t('closeTerminal'),
      message: t('confirmCloseTerminal') || 'Are you sure you want to close this terminal? All unsaved work will be lost.',
    });
  };

  // 확인 모달 확인 버튼 핸들러
  const handleConfirmModal = async () => {
    if (confirmModal.isLogout) {
      // 로그아웃 실행
      handleLogout();
    } else {
      // 세션 닫기 실행
      const sessionId = confirmModal.sessionId;
      const token = localStorage.getItem('auth_token');

      try {
        // 서버에서 세션 삭제 요청
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          console.error('Failed to delete session on server');
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }

      // 로컬 상태에서 세션 제거
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

      // 닫는 세션이 활성 세션이면 다른 세션으로 전환
      if (activeSessionId === sessionId) {
        const remainingSessions = sessions.filter((s) => s.id !== sessionId);
        if (remainingSessions.length > 0) {
          setActiveSessionId(remainingSessions[0].id);
        } else {
          // 모든 세션이 닫히면 null로 설정
          setActiveSessionId(null);
        }
      }

      // 모달 닫기
      setConfirmModal({ isOpen: false, sessionId: null, title: '', message: '', isLogout: false });
    }
  };

  // 확인 모달 취소 버튼 핸들러
  const handleCancelModal = () => {
    setConfirmModal({ isOpen: false, sessionId: null, title: '', message: '', isLogout: false });
  };

  // 설정 저장
  const handleSaveSettings = (newSettings) => {
    updateSettings(newSettings);
    setNotification({
      isOpen: true,
      message: t('settingsSaved'),
    });
  };

  // 사이드바 토글
  const toggleSidebar = () => {
    console.log('[DEBUG] 사이드바 토글 전:', { isSidebarOpen, sessionsCount: sessions.length, activeSessionId });
    setIsSidebarOpen((prev) => !prev);
    console.log('[DEBUG] 사이드바 토글 후');
  };

  // 세션 이름 변경
  const handleRenameSession = async (sessionId, newName) => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName }),
      });

      if (response.ok) {
        // 세션 목록만 업데이트 (로컬 상태 수정)
        setSessions(prevSessions =>
          prevSessions.map(s =>
            s.id === sessionId ? { ...s, name: newName } : s
          )
        );
      } else {
        console.error('Failed to rename session');
      }
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  // 세션 재연결
  const handleReconnectSession = (sessionId) => {
    console.log('재연결 시도:', sessionId);

    // Terminal 컴포넌트를 언마운트했다가 다시 마운트하여 WebSocket 재연결
    const wasActive = activeSessionId === sessionId;

    if (wasActive) {
      // 활성 세션이면 null로 만들었다가 다시 설정
      setActiveSessionId(null);
      setTimeout(() => {
        setActiveSessionId(sessionId);
      }, 50);
    } else {
      // 활성 세션이 아니면 해당 세션으로 전환 (자동으로 재연결됨)
      setActiveSessionId(sessionId);
    }
  };

  // 사이드바 리사이즈
  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(180, Math.min(400, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  // 로딩 중
  if (authState.isLoading) {
    const loadingTheme = themes[settings.theme] || themes.catppuccin;
    return (
      <div style={{ ...styles.loadingContainer, backgroundColor: loadingTheme.ui.bg }}>
        <h1 style={{
          ...styles.loadingLogo,
          color: loadingTheme.ui.accent
        }}>{t('appName')}</h1>
        <p style={{ ...styles.loadingText, color: loadingTheme.ui.textSecondary }}>{t('loading') || 'Loading...'}</p>
      </div>
    );
  }

  // 초기 설정 필요
  if (authState.needsSetup) {
    return <InitialSetup onComplete={handleSetupComplete} language={settings.language} />;
  }

  // 로그인 필요
  if (!authState.isAuthenticated) {
    return <Login onLogin={handleLogin} language={settings.language} />;
  }

  // 현재 테마 가져오기
  const currentTheme = themes[settings.theme] || themes.catppuccin;

  // 인증 완료 - 메인 앱 렌더링
  return (
    <div style={{
      ...styles.container,
      backgroundColor: currentTheme.ui.bg,
      height: isMobile ? `${viewportHeight}px` : '100vh',
    }}>
      {/* 헤더 */}
      <div style={{
        ...styles.header,
        backgroundColor: currentTheme.ui.bgSecondary,
        borderBottomColor: currentTheme.ui.border,
      }}>
        <div style={styles.headerLeft}>
          {/* 사이드바 토글 */}
          <button onClick={toggleSidebar} style={{
            ...styles.hamburgerBtn,
            backgroundColor: 'transparent',
            color: currentTheme.ui.iconColor,
          }} title={isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}>
            {isSidebarOpen ? <PanelLeftClose size={20} strokeWidth={2} /> : <PanelLeft size={20} strokeWidth={2} />}
          </button>

          <h1 style={{
            ...styles.title,
            color: currentTheme.ui.accent
          }}>{t('appName')}</h1>
        </div>

        <div style={styles.headerRight}>
          {/* 세션 정보 */}
          {sessions.length > 0 && (
            <div style={{ ...styles.sessionInfo, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border }}>
              <span style={{ color: currentTheme.ui.accent, fontWeight: '600' }}>
                {sessions.findIndex((s) => s.id === activeSessionId) + 1}
              </span>
              <span style={{ color: currentTheme.ui.textSecondary }}> / </span>
              <span style={{ color: currentTheme.ui.textSecondary }}>
                {sessions.length}
              </span>
            </div>
          )}
          {isMobile ? (
            /* 모바일: 드롭다운 메뉴 */
            <>
              {/* 맨 아래로 스크롤 버튼 */}
              <button
                onClick={handleScrollToBottom}
                disabled={sessions.length === 0}
                style={{
                  ...styles.hamburgerBtn,
                  backgroundColor: scrollBtnClicked ? currentTheme.ui.bgTertiary : 'transparent',
                  color: sessions.length === 0 ? currentTheme.ui.textSecondary + '60' : currentTheme.ui.iconColor,
                  transition: 'background-color 0.15s ease',
                  cursor: sessions.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: sessions.length === 0 ? 0.5 : 1
                }}
                title={sessions.length === 0 ? 'No terminal open' : 'Scroll to bottom'}
              >
                <ChevronsDown size={20} strokeWidth={2} />
              </button>

              <div style={{ position: 'relative', height: '100%' }}>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  style={{
                    ...styles.hamburgerBtn,
                    backgroundColor: isMenuOpen ? currentTheme.ui.bgTertiary : 'transparent',
                    color: currentTheme.ui.iconColor
                  }}
                >
                  <Menu size={20} strokeWidth={2} />
                </button>

              {isMenuOpen && (
                <>
                  <div style={styles.menuOverlay} onClick={() => setIsMenuOpen(false)} />
                  <div style={{ ...styles.dropdown, backgroundColor: currentTheme.ui.bgSecondary, borderColor: currentTheme.ui.border }}>
                    <div style={{ ...styles.dropdownItem, borderBottomColor: currentTheme.ui.border }}>
                      <span style={{ ...styles.dropdownLabel, color: currentTheme.ui.textSecondary }}>{t('user')}</span>
                      <span style={{ ...styles.dropdownValue, color: currentTheme.ui.accent }}>{authState.username}</span>
                    </div>
                    <button
                      onClick={() => { handleNewSession(); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('new')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.ui.text,
                        backgroundColor: hoveredDropdownItem === 'new' ? currentTheme.ui.bgTertiary : 'transparent'
                      }}
                    >
                      <Plus size={16} strokeWidth={2} />
                      <span>{t('newSession')}</span>
                    </button>
                    <button
                      onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('settings')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.ui.text,
                        backgroundColor: hoveredDropdownItem === 'settings' ? currentTheme.ui.bgTertiary : 'transparent'
                      }}
                    >
                      <SettingsIcon size={16} strokeWidth={2} />
                      <span>{t('settings')}</span>
                    </button>
                    <button
                      onClick={() => { handleLogoutRequest(); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('logout')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.red,
                        backgroundColor: hoveredDropdownItem === 'logout' ? currentTheme.ui.bgTertiary : 'transparent'
                      }}
                    >
                      <Power size={16} strokeWidth={2} />
                      <span>{t('logout')}</span>
                    </button>
                  </div>
                </>
              )}
              </div>
            </>
          ) : (
            /* PC: 기존 버튼들 */
            <>
              <button onClick={() => setIsSettingsOpen(true)} style={{ ...styles.settingsBtn, color: currentTheme.ui.iconColor, borderColor: currentTheme.ui.border }} title={t('settings')}>
                <SettingsIcon size={18} strokeWidth={2.5} />
              </button>
              <button onClick={handleLogoutRequest} style={{ ...styles.logoutBtn, color: currentTheme.red, borderColor: currentTheme.ui.border }} title={t('logout')}>
                <Power size={18} strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 터미널 영역 (파일 에디터가 열리면 숨김) */}
      {!fileEditorOpen && (
        <div
          ref={terminalRef}
          style={{
            ...styles.terminalContainer,
            paddingBottom: isMobile ? '45px' : '0',
            backgroundColor: currentTheme.ui.bg,
            marginLeft: !isMobile && isSidebarOpen ? `${sidebarWidth}px` : '0',
            transition: isResizing ? 'none' : 'margin-left 0.3s ease',
          }}
        >
          {sessions.length === 0 ? (
            /* 터미널이 없을 때 빈 화면 */
            <div style={styles.emptyState}>
              <div style={{ ...styles.emptyIcon, color: currentTheme.ui.textSecondary }}>
                <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M7 10l3 3-3 3" />
                  <line x1="13" y1="16" x2="17" y2="16" />
                </svg>
              </div>
              <h2 style={{ ...styles.emptyTitle, color: currentTheme.ui.text }}>
                {t('noTerminals') || 'No Terminals Open'}
              </h2>
              <p style={{ ...styles.emptyMessage, color: currentTheme.ui.textSecondary, opacity: 0.95 }}>
                {t('createFirstTerminal') || 'Create a new terminal to get started'}
              </p>
              <button onClick={handleNewSession} style={{ ...styles.emptyButton, backgroundColor: currentTheme.ui.accent, color: currentTheme.ui.bg }}>
                <Plus size={20} strokeWidth={2.5} />
                <span>{t('newSession') || 'New Terminal'}</span>
              </button>
            </div>
          ) : (
            /* 모든 세션의 Terminal 렌더링 (활성화된 것만 표시) */
            sessions.map((session) => (
              <div
                key={session.id}
                style={{
                  display: session.id === activeSessionId ? 'block' : 'none',
                  width: '100%',
                  height: '100%',
                }}
              >
                <Terminal
                  sessionId={session.id}
                  settings={settings}
                  isActive={session.id === activeSessionId}
                />
              </div>
            ))
          )}
        </div>
      )}

      {/* 파일 에디터 (파일이 선택되었을 때 표시) */}
      {fileEditorOpen && selectedFile && (
        <div
          style={{
            position: 'absolute',
            top: '36px',
            left: !isMobile && isSidebarOpen ? `${sidebarWidth}px` : '0',
            right: 0,
            bottom: isMobile ? '45px' : 0,
            transition: isResizing ? 'none' : 'left 0.3s ease',
          }}
        >
          <FileEditor
            filePath={selectedFile}
            onClose={handleCloseEditor}
            theme={currentTheme}
          />
        </div>
      )}

      {/* 모바일 툴바 */}
      {isMobile && (
        <MobileToolbar
          onSendKey={handleSendKey}
          isVisible={true}
          activeSessionId={activeSessionId}
          onOpenCommandInput={() => setCommandInputOpen(true)}
        />
      )}

      {/* 명령어 입력 모달 */}
      <CommandInput
        isOpen={commandInputOpen}
        onClose={() => setCommandInputOpen(false)}
        onSend={handleSendCommand}
        command={commandText}
        setCommand={setCommandText}
        theme={currentTheme}
        t={t}
      />

      {/* 사이드바 */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => {
          console.log('[DEBUG] Sidebar onClose 호출됨:', { sessionsCount: sessions.length, activeSessionId });
          setIsSidebarOpen(false);
        }}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onCloseSession={handleCloseSessionRequest}
        onRenameSession={handleRenameSession}
        onReconnectSession={handleReconnectSession}
        language={settings.language}
        theme={currentTheme}
        isMobile={isMobile}
        width={sidebarWidth}
        onResizeStart={handleResizeStart}
        onFileSelect={handleFileSelect}
        onFolderSelect={handleFolderSelect}
      />

      {/* 설정 모달 */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        theme={currentTheme}
        username={authState.username}
      />

      {/* 확인 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.isLogout ? t('logout') : t('close') || 'Close'}
        cancelText={t('cancel')}
        onConfirm={handleConfirmModal}
        onCancel={handleCancelModal}
        language={settings.language}
        danger={true}
        theme={currentTheme}
      />

      {/* 알림 토스트 */}
      <NotificationModal
        isOpen={notification.isOpen}
        message={notification.message}
        onClose={() => setNotification({ isOpen: false, message: '' })}
        theme={currentTheme}
      />
    </div>
  );
}

const styles = {
  loadingContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e2e',
    position: 'fixed',
  },
  loadingLogo: {
    margin: 0,
    fontSize: '28px',
    fontWeight: '700',
    color: '#89b4fa',
    marginBottom: '12px',
    textTransform: 'uppercase',
  },
  loadingText: {
    margin: 0,
    fontSize: '16px',
    color: '#6c7086',
  },
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#1e1e2e',
    position: 'fixed',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0',
    backgroundColor: '#181825',
    borderBottom: '1px solid #313244',
    flexShrink: 0,
    height: '32px',
    boxSizing: 'border-box',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    flexWrap: 'nowrap',
    height: '100%',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    height: '100%',
  },
  username: {
    fontSize: '11px',
    color: '#a6e3a1',
    fontWeight: '500',
    padding: '3px 8px',
    backgroundColor: '#11111b',
    borderRadius: '2px',
  },
  hamburgerBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0',
    transition: 'background-color 0.15s ease',
    height: '100%',
  },
  title: {
    margin: 0,
    fontSize: '13px',
    fontWeight: '600',
    textTransform: 'uppercase',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    height: '100%',
  },
  sessionInfo: {
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 12px',
    borderRight: '1px solid #313244',
    borderRadius: '0',
    height: '100%',
  },
  newSessionBtn: {
    padding: '0 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRight: '1px solid #313244',
    borderRadius: '0',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  settingsBtn: {
    padding: '0 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRight: '1px solid #313244',
    borderRadius: '0',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  logoutBtn: {
    padding: '0 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '0',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  terminalContainer: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    padding: '8px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '20px',
    padding: '40px',
  },
  emptyIcon: {
    opacity: 0.5,
  },
  emptyTitle: {
    margin: 0,
    fontSize: '24px',
    fontWeight: '600',
  },
  emptyMessage: {
    margin: 0,
    fontSize: '14px',
  },
  emptyButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
    marginTop: '12px',
  },
  menuOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9998,
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: '180px',
    backgroundColor: '#181825',
    border: '1px solid #313244',
    borderRadius: '2px',
    zIndex: 9999,
    overflow: 'hidden',
  },
  dropdownItem: {
    padding: '8px 12px',
    borderBottom: '1px solid #313244',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownLabel: {
    fontSize: '12px',
    color: '#6c7086',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  dropdownValue: {
    fontSize: '13px',
    fontWeight: '600',
  },
  dropdownButton: {
    width: '100%',
    padding: '10px 12px',
    background: 'none',
    border: 'none',
    color: '#cdd6f4',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'background-color 0.15s ease',
    textAlign: 'left',
    lineHeight: '1',
  },
};

export default App;
