/**
 * 다국어 지원 (i18n)
 */

export const locales = {
  en: {
    // Header
    appName: 'Terminal List',
    session: 'Session',
    newSession: 'New Session',
    settings: 'Settings',

    // Terminal
    connecting: 'Connecting...',
    connected: 'Terminal Connected',
    disconnected: 'Connection Lost',
    connectionError: 'Connection Error',

    // Settings
    settingsTitle: 'Settings',
    theme: 'Theme',
    language: 'Language',
    fontSize: 'Font Size',
    fontFamily: 'Font Family',
    scrollBehavior: 'Scroll Behavior',
    autoScroll: 'Auto Scroll',
    smoothScroll: 'Smooth Scroll',
    save: 'Save',
    cancel: 'Cancel',
    reset: 'Reset to Default',

    // Themes
    themeCatppuccin: 'Catppuccin',
    themeDracula: 'Dracula',
    themeMonokai: 'Monokai',
    themeSolarizedDark: 'Solarized Dark',
    themeGithub: 'GitHub Dark',

    // Languages
    languageEnglish: 'English',
    languageKorean: '한국어',

    // Toolbar
    paste: 'Paste',
    commandInput: 'Command Input',
    commandInputPlaceholder: 'Enter command... (Ctrl+Enter to send)',
    commandInputHint: '💡 Enter for new line, Ctrl+Enter to send',
    send: 'Send',
    clearInput: 'Clear input',

    // Messages
    settingsSaved: 'Settings saved successfully',
    sessionCreated: 'New session created',
    confirmNewSession: 'Create a new session? Current session will continue in background.',

    // Confirm Modal
    confirm: 'Confirm',
    close: 'Close',
    closeTerminal: 'Close Terminal',
    confirmCloseTerminal: 'Are you sure you want to close this terminal? All unsaved work will be lost.',
    cannotCloseLastSession: 'Cannot close the last terminal. Create a new one first.',

    // Sidebar
    sessions: 'Sessions',
    closeSidebar: 'Close sidebar',
    closeTerminal: 'Close terminal',
    resizeSidebar: 'Resize sidebar',
    activeTerminals: 'Active Terminals',

    // Empty State
    noTerminals: 'No terminals open',
    createFirstTerminal: 'Click + to create a new terminal',

    // Errors
    clipboardError: 'Clipboard access denied',
    networkError: 'Network error occurred',

    // Authentication
    loading: 'Loading...',
    logout: 'Logout',
    confirmLogout: 'Confirm Logout',
    logoutMessage: 'Are you sure you want to logout?',
    user: 'User',
    initialSetup: 'Initial Setup',
    initialSetupDescription: 'Create an administrator account to get started. You will need these credentials to access the terminal.',
    username: 'Username',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    usernamePlaceholder: 'Enter username',
    passwordPlaceholder: 'Enter password (min 8 characters)',
    confirmPasswordPlaceholder: 'Re-enter password',
    createAccount: 'Create Administrator',
    creating: 'Creating...',
    setupFooter: 'This account will have full access to all terminals and settings.',
    usernameMinLength: 'Username must be at least 3 characters',
    passwordMinLength: 'Password must be at least 8 characters',
    passwordMismatch: 'Passwords do not match',
    login: 'Sign In',
    loginDescription: 'Enter your administrator credentials',
    signIn: 'Sign In',
    signingIn: 'Signing in...',
    fillAllFields: 'Please fill in all fields',
  },

  ko: {
    // 헤더
    appName: 'Terminal List',
    session: '세션',
    newSession: '새로운 세션',
    settings: '설정',

    // 터미널
    connecting: '연결 중...',
    connected: '터미널 연결됨',
    disconnected: '연결이 끊어졌습니다',
    connectionError: '연결 오류',

    // 설정
    settingsTitle: '설정',
    theme: '테마',
    language: '언어',
    fontSize: '글꼴 크기',
    fontFamily: '글꼴',
    scrollBehavior: '스크롤 동작',
    autoScroll: '자동 스크롤',
    smoothScroll: '부드러운 스크롤',
    save: '저장',
    cancel: '취소',
    reset: '기본값으로 재설정',

    // 테마
    themeCatppuccin: 'Catppuccin',
    themeDracula: 'Dracula',
    themeMonokai: 'Monokai',
    themeSolarizedDark: 'Solarized Dark',
    themeGithub: 'GitHub Dark',

    // 언어
    languageEnglish: 'English',
    languageKorean: '한국어',

    // 툴바
    paste: '붙여넣기',
    commandInput: '명령어 입력',
    commandInputPlaceholder: '명령어를 입력하세요... (Ctrl+Enter로 전송)',
    commandInputHint: '💡 Enter로 줄바꿈, Ctrl+Enter로 전송',
    send: '전송',
    clearInput: '내용 지우기',

    // 메시지
    settingsSaved: '설정이 저장되었습니다',
    sessionCreated: '새 세션이 생성되었습니다',
    confirmNewSession: '새 세션을 만드시겠습니까? 현재 세션은 백그라운드에서 계속됩니다.',

    // 확인 모달
    confirm: '확인',
    close: '닫기',
    closeTerminal: '터미널 종료',
    confirmCloseTerminal: '이 터미널을 닫으시겠습니까? 저장되지 않은 모든 작업이 손실됩니다.',
    cannotCloseLastSession: '마지막 터미널은 닫을 수 없습니다. 먼저 새 터미널을 생성하세요.',

    // 사이드바
    sessions: '세션 목록',
    closeSidebar: '사이드바 닫기',
    closeTerminal: '터미널 종료',
    resizeSidebar: '사이드바 크기 조정',
    activeTerminals: '활성 터미널',

    // 빈 화면
    noTerminals: '열려있는 터미널이 없습니다',
    createFirstTerminal: '+ 버튼을 눌러 새 터미널을 만드세요',

    // 오류
    clipboardError: '클립보드 접근 권한이 필요합니다',
    networkError: '네트워크 오류가 발생했습니다',

    // 인증
    loading: '로딩 중...',
    logout: '로그아웃',
    confirmLogout: '로그아웃 확인',
    logoutMessage: '로그아웃 하시겠습니까?',
    user: '사용자',
    initialSetup: '초기 설정',
    initialSetupDescription: '시작하려면 관리자 계정을 생성하세요. 터미널에 접근하려면 이 자격 증명이 필요합니다.',
    username: '사용자명',
    password: '비밀번호',
    confirmPassword: '비밀번호 확인',
    usernamePlaceholder: '사용자명을 입력하세요',
    passwordPlaceholder: '비밀번호를 입력하세요 (최소 8자)',
    confirmPasswordPlaceholder: '비밀번호를 다시 입력하세요',
    createAccount: '관리자 생성',
    creating: '생성 중...',
    setupFooter: '이 계정은 모든 터미널과 설정에 대한 전체 액세스 권한을 갖습니다.',
    usernameMinLength: '사용자명은 최소 3자 이상이어야 합니다',
    passwordMinLength: '비밀번호는 최소 8자 이상이어야 합니다',
    passwordMismatch: '비밀번호가 일치하지 않습니다',
    login: '로그인',
    loginDescription: '관리자 자격 증명을 입력하세요',
    signIn: '로그인',
    signingIn: '로그인 중...',
    fillAllFields: '모든 필드를 입력해주세요',
  },
};

export const defaultLocale = 'en';

export default locales;
