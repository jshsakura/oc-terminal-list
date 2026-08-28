/**
 * 터미널 테마 정의 (part E) — "히어로" 테마 모음.
 *
 * 기존 A~D 가 전부 "다크 배경 + 파스텔 ANSI" 한 문법이라 서로 비슷해 보이는 문제를
 * 배경/질감/모노크롬 축을 흔들어 확연히 구분되는 소수 정예로 해결한다.
 *
 * 이 파트의 테마는 추가로 `texture` 필드를 가진다:
 *   - 'scanline' : CRT 주사선 오버레이 (정적, 애니 없음)
 *   - 'glow'     : 네온 채도 강화 + 가장자리 비네트
 *   - 'flat'     : 질감·애니·그림자 전부 제거 (e-ink 지향)
 *   - (없음)     : 오버레이 없음
 * texture 는 xterm theme 으로 넘어가도 무시되며(ui 블록과 동일), TerminalTexture 가 소비한다.
 */
import { commonUI } from './commonUI';

const SHADOW = '0 8px 32px rgba(0,0,0,0.45)';
const INNER = 'inset 0 1px 0 rgba(255,255,255,0.04)';

// 1. CRT Amber — 앰버 인광 모노 + 주사선. 근흑색 위 호박색.
export const crtAmberTheme = {
  texture: 'scanline',
  background: '#120c02',
  foreground: '#ffb000',
  cursor: '#ffcf3c',
  cursorAccent: '#120c02',
  selection: 'rgba(255, 176, 0, 0.28)',
  black: '#2a1e00', red: '#ff7a34', green: '#d9a51a', yellow: '#ffcf3c',
  blue: '#caa02e', magenta: '#ff9a52', cyan: '#e6bb3a', white: '#ffb000',
  brightBlack: '#7a5c14', brightRed: '#ff9a5c', brightGreen: '#f0c032',
  brightYellow: '#ffe06a', brightBlue: '#e0bc48', brightMagenta: '#ffb877',
  brightCyan: '#ffd257', brightWhite: '#ffe4a3',
  ui: {
    ...commonUI,
    bg: '#1a1204', bgSecondary: '#120c02', bgTertiary: '#241900',
    glassBg: 'rgba(26, 18, 4, 0.82)', cardBg: '#241900',
    border: 'rgba(255, 176, 0, 0.12)', borderLight: 'rgba(255, 176, 0, 0.22)',
    text: '#ffe4a3', textSecondary: '#b0851a',
    accent: '#ffb000', accentMuted: 'rgba(255, 176, 0, 0.16)',
    iconColor: '#b0851a', shadow: SHADOW, innerShadow: INNER,
  },
};

// 2. CRT Green — 클래식 인광 그린 모노 + 주사선.
export const crtGreenTheme = {
  texture: 'scanline',
  background: '#020f02',
  foreground: '#33ff66',
  cursor: '#5cff8a',
  cursorAccent: '#020f02',
  selection: 'rgba(51, 255, 102, 0.24)',
  black: '#062a10', red: '#5cff8a', green: '#33ff66', yellow: '#9dff5c',
  blue: '#2fd6a0', magenta: '#66ff99', cyan: '#33ffcc', white: '#33ff66',
  brightBlack: '#1f7a44', brightRed: '#8affab', brightGreen: '#66ff8f',
  brightYellow: '#c0ff8a', brightBlue: '#5cf0c0', brightMagenta: '#96ffbb',
  brightCyan: '#66ffdd', brightWhite: '#c8ffd6',
  ui: {
    ...commonUI,
    bg: '#04160a', bgSecondary: '#020f02', bgTertiary: '#062010',
    glassBg: 'rgba(4, 22, 10, 0.82)', cardBg: '#062010',
    border: 'rgba(51, 255, 102, 0.12)', borderLight: 'rgba(51, 255, 102, 0.22)',
    text: '#c8ffd6', textSecondary: '#3f9e5e',
    accent: '#33ff66', accentMuted: 'rgba(51, 255, 102, 0.15)',
    iconColor: '#3f9e5e', shadow: SHADOW, innerShadow: INNER,
  },
};

// 3. Cyberpunk — 딥 퍼플블랙 + 마젠타/시안 네온. glow.
export const cyberpunkTheme = {
  texture: 'glow',
  background: '#0d0221',
  foreground: '#f0e6ff',
  cursor: '#00f0ff',
  cursorAccent: '#0d0221',
  selection: 'rgba(255, 47, 240, 0.26)',
  black: '#241040', red: '#ff2a6d', green: '#05ffa1', yellow: '#ffd319',
  blue: '#01c8ff', magenta: '#ff2ff0', cyan: '#00f0ff', white: '#f0e6ff',
  brightBlack: '#6a4a9e', brightRed: '#ff5c8f', brightGreen: '#5cffc0',
  brightYellow: '#ffe05c', brightBlue: '#5cd6ff', brightMagenta: '#ff6cf5',
  brightCyan: '#5cf7ff', brightWhite: '#ffffff',
  ui: {
    ...commonUI,
    bg: '#150836', bgSecondary: '#0d0221', bgTertiary: '#1f0f4d',
    glassBg: 'rgba(21, 8, 54, 0.82)', cardBg: '#1f0f4d',
    border: 'rgba(0, 240, 255, 0.14)', borderLight: 'rgba(255, 47, 240, 0.24)',
    text: '#f0e6ff', textSecondary: '#9a7fd6',
    accent: '#ff2ff0', accentMuted: 'rgba(255, 47, 240, 0.16)',
    iconColor: '#9a7fd6', shadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 24px rgba(255,47,240,0.15)', innerShadow: INNER,
  },
};

// 4. Vaporwave — 퍼플/핑크 파스텔 네온. glow. 사이버펑크보다 부드러운 신스 톤.
export const vaporwaveTheme = {
  texture: 'glow',
  background: '#1a0b2e',
  foreground: '#ffe6ff',
  cursor: '#ff6aac',
  cursorAccent: '#1a0b2e',
  selection: 'rgba(209, 107, 165, 0.30)',
  black: '#2e1a47', red: '#ff6aac', green: '#7ce0c0', yellow: '#ffcf7a',
  blue: '#86a8ff', magenta: '#d16bd6', cyan: '#7ae0ff', white: '#ffe6ff',
  brightBlack: '#6e5090', brightRed: '#ff8fc0', brightGreen: '#a0f0d6',
  brightYellow: '#ffe0a0', brightBlue: '#a8c0ff', brightMagenta: '#e08fe6',
  brightCyan: '#a0eeff', brightWhite: '#ffffff',
  ui: {
    ...commonUI,
    bg: '#251140', bgSecondary: '#1a0b2e', bgTertiary: '#32195c',
    glassBg: 'rgba(37, 17, 64, 0.82)', cardBg: '#32195c',
    border: 'rgba(209, 107, 214, 0.14)', borderLight: 'rgba(255, 106, 172, 0.24)',
    text: '#ffe6ff', textSecondary: '#b090d0',
    accent: '#ff6aac', accentMuted: 'rgba(255, 106, 172, 0.16)',
    iconColor: '#b090d0', shadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 24px rgba(209,107,214,0.15)', innerShadow: INNER,
  },
};

// 5. Paper E-ink — 따뜻한 종이 + 잉크. 무채색·질감 없음(flat). 라이트 테마.
export const paperEinkTheme = {
  texture: 'flat',
  background: '#e8e4d8',
  foreground: '#2b2a26',
  cursor: '#2b2a26',
  cursorAccent: '#e8e4d8',
  selection: 'rgba(43, 42, 38, 0.16)',
  black: '#2b2a26', red: '#6e3b34', green: '#3f5238', yellow: '#6b5a2e',
  blue: '#3a4a5e', magenta: '#5a3f52', cyan: '#3a5451', white: '#5c5a52',
  brightBlack: '#4a4842', brightRed: '#844a42', brightGreen: '#4e6346',
  brightYellow: '#7e6a38', brightBlue: '#485c72', brightMagenta: '#6e4e64',
  brightCyan: '#486663', brightWhite: '#2b2a26',
  ui: {
    ...commonUI,
    bg: '#e8e4d8', bgSecondary: '#ddd8c9', bgTertiary: '#f0ece1',
    glassBg: 'rgba(232, 228, 216, 0.88)', cardBg: '#f0ece1',
    border: 'rgba(43, 42, 38, 0.14)', borderLight: 'rgba(43, 42, 38, 0.22)',
    text: '#2b2a26', textSecondary: '#6b685f',
    accent: '#6e3b34', accentMuted: 'rgba(110, 59, 52, 0.12)',
    iconColor: '#6b685f', shadow: '0 1px 2px rgba(43,42,38,0.12)', innerShadow: 'none',
  },
};

// 6. True Black — 순수 #000 OLED + 클린 하이컨트라스트 팔레트. 질감 없음.
export const trueBlackTheme = {
  background: '#000000',
  foreground: '#eaeaea',
  cursor: '#ffffff',
  cursorAccent: '#000000',
  selection: 'rgba(255, 255, 255, 0.22)',
  black: '#1a1a1a', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
  blue: '#61afef', magenta: '#d77bff', cyan: '#4de8e8', white: '#eaeaea',
  brightBlack: '#6a6a6a', brightRed: '#ff7b7b', brightGreen: '#7dfaa0',
  brightYellow: '#f8ffa8', brightBlue: '#8ac6ff', brightMagenta: '#e2a0ff',
  brightCyan: '#7bf5f5', brightWhite: '#ffffff',
  ui: {
    ...commonUI,
    bg: '#0a0a0a', bgSecondary: '#000000', bgTertiary: '#161616',
    glassBg: 'rgba(10, 10, 10, 0.85)', cardBg: '#161616',
    border: 'rgba(255, 255, 255, 0.10)', borderLight: 'rgba(255, 255, 255, 0.18)',
    text: '#ffffff', textSecondary: '#8a8a8a',
    accent: '#61afef', accentMuted: 'rgba(97, 175, 239, 0.16)',
    iconColor: '#8a8a8a', shadow: '0 8px 32px rgba(0,0,0,0.7)', innerShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  },
};

// 7. Game Boy — DMG 4계조 올리브 LCD. flat. 밝은 연두 위 짙은 녹색 잉크.
export const gameboyTheme = {
  texture: 'flat',
  background: '#9bbc0f',
  foreground: '#0f380f',
  cursor: '#0f380f',
  cursorAccent: '#9bbc0f',
  selection: 'rgba(15, 56, 15, 0.20)',
  black: '#0f380f', red: '#0f380f', green: '#306230', yellow: '#306230',
  blue: '#0f380f', magenta: '#306230', cyan: '#306230', white: '#0f380f',
  brightBlack: '#306230', brightRed: '#306230', brightGreen: '#306230',
  brightYellow: '#306230', brightBlue: '#0f380f', brightMagenta: '#306230',
  brightCyan: '#306230', brightWhite: '#0f380f',
  ui: {
    ...commonUI,
    bg: '#8bac0f', bgSecondary: '#9bbc0f', bgTertiary: '#a8c818',
    glassBg: 'rgba(139, 172, 15, 0.90)', cardBg: '#a8c818',
    border: 'rgba(15, 56, 15, 0.22)', borderLight: 'rgba(15, 56, 15, 0.34)',
    text: '#0f380f', textSecondary: '#306230',
    accent: '#0f380f', accentMuted: 'rgba(15, 56, 15, 0.14)',
    iconColor: '#306230', shadow: '0 1px 2px rgba(15,56,15,0.20)', innerShadow: 'none',
  },
};

/* 8. E-ink — 이북 모드 전용. 순백 종이 위 검은 잉크, ANSI 는 회색 계조로만.
 *
 * Not a taste, a constraint: e-ink renders colour as dithered grey, and dithering on
 * small text is mud. So every ANSI slot is a real grey level, and the "bright" half goes
 * *darker* rather than lighter — on paper, emphasis means more ink, not more light.
 * The band stops at #7a7a7a: anything paler stops being text on a 16-level panel.
 *
 * `texture: 'flat'` is what keeps the home canvas scanlines and the pane overlay off. */
export const einkTheme = {
  texture: 'flat',
  background: '#ffffff',
  foreground: '#000000',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selection: 'rgba(0, 0, 0, 0.22)',
  black: '#000000', red: '#2e2e2e', green: '#4a4a4a', yellow: '#5f5f5f',
  blue: '#1c1c1c', magenta: '#3a3a3a', cyan: '#545454', white: '#262626',
  brightBlack: '#7a7a7a', brightRed: '#000000', brightGreen: '#2e2e2e',
  brightYellow: '#454545', brightBlue: '#000000', brightMagenta: '#1c1c1c',
  brightCyan: '#3a3a3a', brightWhite: '#000000',
  ui: {
    ...commonUI,
    bg: '#ffffff', bgSecondary: '#f2f2f2', bgTertiary: '#e6e6e6',
    glassBg: '#ffffff', cardBg: '#ffffff',
    border: '#6b6b6b', borderLight: '#000000',
    text: '#000000', textSecondary: '#4a4a4a',
    accent: '#000000', accentMuted: 'rgba(0, 0, 0, 0.08)',
    iconColor: '#333333', shadow: 'none', innerShadow: 'none',
  },
};
