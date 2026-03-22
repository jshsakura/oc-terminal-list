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
    scrollSensitivity: 'Scroll Sensitivity (AI)',
    scrollSensitivityHint: 'Higher values respond more sensitively to user scrolling',

    // Themes
    themeCatppuccinMocha: 'Catppuccin Mocha',
    themeCatppuccinMacchiato: 'Catppuccin Macchiato',
    themeCatppuccinFrappe: 'Catppuccin Frappé',
    themeCatppuccinLatte: 'Catppuccin Latte',
    themeTokyoNight: 'Tokyo Night',
    themeOneDark: 'One Dark',
    themeNightOwl: 'Night Owl',
    themeAyuMirage: 'Ayu Mirage',
    themeMonokaiPro: 'Monokai Pro',
    themeMonokai: 'Monokai',
    themeSynthwave84: "SynthWave '84",
    themeShadesOfPurple: 'Shades of Purple',
    themeCobalt2: 'Cobalt2',
    themeDracula: 'Dracula',
    themeOceanicNext: 'Oceanic Next',
    themeGruvboxDark: 'Gruvbox Dark',
    themeGruvboxLight: 'Gruvbox Light',
    themeEverforest: 'Everforest',
    themeSolarizedDark: 'Solarized Dark',
    themeSolarizedLight: 'Solarized Light',
    themeNord: 'Nord',
    themeRosePine: 'Rosé Pine',
    themeGithubDark: 'GitHub Dark',
    themeGithubLight: 'GitHub Light',

    // Languages
    languageEnglish: 'English (US)',
    languageKorean: '한국어 (KR)',

    // Toolbar
    paste: 'Paste',
    commandInput: 'Quick Input',
    commandInputPlaceholder: 'Type command here... (Ctrl+Enter to send)',
    commandInputHint: '💡 Shift+Enter for new line, Ctrl+Enter to send',
    send: 'Send',
    clear: 'Clear',
    clearInput: 'Clear field',
    confirmClearInput: 'Wipe all input text?',
    unsavedChanges: 'Unsaved Changes',
    unsavedChangesMessage: 'File has unsaved changes. Discard and close?',
    externalChangeDetected: 'External Change Detected',
    externalChangeMessage: 'This file was modified outside. Reload from disk?',
    reload: 'Reload',
    keepMine: 'Keep Mine',
    preview: 'Preview',
    edit: 'Edit',

    // Messages
    settingsSaved: 'Settings updated',
    sessionCreated: 'Terminal ready',
    confirmNewSession: 'Open new terminal?',

    // Confirm Modal
    confirm: 'Confirm',
    close: 'Close',
    closeTerminal: 'Kill Terminal',
    confirmCloseTerminal: 'Terminate this session? Unsaved progress will be lost.',
    cannotCloseLastSession: 'Keep at least one terminal open.',

    // Sidebar
    sessions: 'Terminals',
    closeSidebar: 'Hide sidebar',
    resizeSidebar: 'Adjust width',
    activeTerminals: 'Active Sessions',
    files: 'Workspace',
    explorer: 'Explorer',
    parentFolder: 'Parent Folder',

    // Empty State
    noTerminals: 'No active terminals',
    createFirstTerminal: 'Launch a new terminal to start',

    // Errors
    clipboardError: 'Permission denied',
    networkError: 'Server unreachable',

    // Authentication
    loading: 'Booting...',
    logout: 'Sign Out',
    confirmLogout: 'Exit System',
    logoutMessage: 'Disconnect from the server?',
    user: 'Operator',
    initialSetup: 'System Initialization',
    initialSetupDescription: 'Configure your root administrator credentials.',
    username: 'ID',
    password: 'Key',
    confirmPassword: 'Verify Key',
    usernamePlaceholder: 'Admin username',
    passwordPlaceholder: 'Secure password',
    confirmPasswordPlaceholder: 'Match password',
    createAccount: 'Initialize Admin',
    creating: 'Provisioning...',
    setupFooter: 'Restricted access: Authorized personnel only.',
    usernameMinLength: 'Min 3 chars required',
    passwordMinLength: 'Min 8 chars required',
    passwordMismatch: 'Keys do not match',
    login: 'Access Terminal',
    loginDescription: 'Authorization required.',
    signIn: 'Authorize',
    signingIn: 'Verifying...',
    fillAllFields: 'All fields mandatory',
  },

  ko: {
    // 헤더
    appName: 'Terminal List',
    session: '세션',
    newSession: '새 세션',
    settings: '시스템 설정',

    // 터미널
    connecting: '서버 연결 중...',
    connected: '터미널 활성화',
    disconnected: '연결 끊김',
    connectionError: '통신 오류',

    // 설정
    settingsTitle: '환경 설정',
    theme: 'UI 테마',
    language: '언어 설정',
    fontSize: '글자 크기',
    fontFamily: '서체 선택',
    scrollBehavior: '스크롤 제어',
    autoScroll: '자동 스크롤',
    smoothScroll: '부드러운 화면 전환',
    save: '저장',
    cancel: '취소',
    reset: '초기화',
    scrollSensitivity: '스크롤 감도 (AI)',
    scrollSensitivityHint: '높을수록 사용자 조작에 민감하게 반응합니다',

    // 테마
    themeCatppuccinMocha: 'Catppuccin Mocha',
    themeCatppuccinMacchiato: 'Catppuccin Macchiato',
    themeCatppuccinFrappe: 'Catppuccin Frappé',
    themeCatppuccinLatte: 'Catppuccin Latte',
    themeTokyoNight: 'Tokyo Night',
    themeOneDark: 'One Dark',
    themeNightOwl: 'Night Owl',
    themeAyuMirage: 'Ayu Mirage',
    themeMonokaiPro: 'Monokai Pro',
    themeMonokai: 'Monokai',
    themeSynthwave84: "SynthWave '84",
    themeShadesOfPurple: 'Shades of Purple',
    themeCobalt2: 'Cobalt2',
    themeDracula: 'Dracula',
    themeOceanicNext: 'Oceanic Next',
    themeGruvboxDark: 'Gruvbox Dark',
    themeGruvboxLight: 'Gruvbox Light',
    themeEverforest: 'Everforest',
    themeSolarizedDark: 'Solarized Dark',
    themeSolarizedLight: 'Solarized Light',
    themeNord: 'Nord',
    themeRosePine: 'Rosé Pine',
    themeGithubDark: 'GitHub Dark',
    themeGithubLight: 'GitHub Light',

    // 언어
    languageEnglish: 'English (US)',
    languageKorean: '한국어 (KR)',

    // 툴바
    paste: '붙여넣기',
    commandInput: '빠른 입력',
    commandInputPlaceholder: '명령어 입력... (Ctrl+Enter로 전송)',
    commandInputHint: '💡 Shift+Enter 줄바꿈, Ctrl+Enter 전송',
    send: '전송',
    clear: '화면 정리',
    clearInput: '입력창 비우기',
    confirmClearInput: '입력한 내용을 모두 삭제하시겠습니까?',
    unsavedChanges: '저장되지 않은 변경사항',
    unsavedChangesMessage: '변경사항이 저장되지 않았습니다. 무시하고 닫으시겠습니까?',
    externalChangeDetected: '외부 변경 감지됨',
    externalChangeMessage: '파일이 외부에서 수정되었습니다. 다시 불러오시겠습니까?',
    reload: '다시 불러오기',
    keepMine: '내용 유지',
    preview: '미리보기',
    edit: '편집하기',

    // 메시지
    settingsSaved: '설정이 반영되었습니다',
    sessionCreated: '터미널 준비 완료',
    confirmNewSession: '새 터미널을 여시겠습니까?',

    // 확인 모달
    confirm: '확인',
    close: '닫기',
    closeTerminal: '세션 종료',
    confirmCloseTerminal: '현재 세션을 종료하시겠습니까? 작업 내용이 사라질 수 있습니다.',
    cannotCloseLastSession: '최소 하나의 터미널은 유지해야 합니다.',

    // 사이드바
    sessions: '세션 목록',
    closeSidebar: '사이드바 숨기기',
    resizeSidebar: '너비 조정',
    activeTerminals: '활성 세션',
    files: '워크스페이스',
    explorer: '파일 탐색기',
    parentFolder: '상위 폴더',

    // 빈 화면
    noTerminals: '활성화된 세션 없음',
    createFirstTerminal: '+ 버튼을 눌러 새 터미널을 시작하세요',

    // 오류
    clipboardError: '권한이 거부되었습니다',
    networkError: '서버에 연결할 수 없습니다',

    // 인증
    loading: '시스템 로딩 중...',
    logout: '로그아웃',
    confirmLogout: '시스템 종료',
    logoutMessage: '서버 연결을 종료하시겠습니까?',
    user: '운영자',
    initialSetup: '시스템 초기화',
    initialSetupDescription: '루트 관리자 계정을 설정하십시오.',
    username: '아이디',
    password: '비밀번호',
    confirmPassword: '비밀번호 확인',
    usernamePlaceholder: '관리자 아이디',
    passwordPlaceholder: '보안 비밀번호',
    confirmPasswordPlaceholder: '비밀번호 재입력',
    createAccount: '관리자 생성',
    creating: '계정 생성 중...',
    setupFooter: '제한된 구역: 인가된 사용자만 접근 가능합니다.',
    usernameMinLength: '최소 3자 이상 입력',
    passwordMinLength: '최소 8자 이상 입력',
    passwordMismatch: '비밀번호가 일치하지 않습니다',
    login: '터미널 접속',
    loginDescription: '인증이 필요합니다.',
    signIn: '인증하기',
    signingIn: '인증 처리 중...',
    fillAllFields: '모든 항목을 입력해야 합니다',
  },
};

export const defaultLocale = 'en';

export default locales;
