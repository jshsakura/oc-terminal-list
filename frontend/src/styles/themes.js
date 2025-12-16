/**
 * 터미널 테마 모음
 */

// Dracula Theme
export const draculaTheme = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selection: 'rgba(68, 71, 90, 0.5)',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
  // UI Colors
  ui: {
    bg: '#282a36',
    bgSecondary: '#21222c',
    bgTertiary: '#44475a',
    border: '#2f3142',
    text: '#f8f8f2',
    textSecondary: '#6272a4',
    accent: '#bd93f9',
    iconColor: '#f8f8f2',
  }
};

// Monokai Theme
export const monokaiTheme = {
  background: '#272822',
  foreground: '#f8f8f2',
  cursor: '#f8f8f0',
  cursorAccent: '#272822',
  selection: 'rgba(73, 72, 62, 0.5)',
  black: '#272822',
  red: '#f92672',
  green: '#a6e22e',
  yellow: '#f4bf75',
  blue: '#66d9ef',
  magenta: '#ae81ff',
  cyan: '#a1efe4',
  white: '#f8f8f2',
  brightBlack: '#75715e',
  brightRed: '#f92672',
  brightGreen: '#a6e22e',
  brightYellow: '#f4bf75',
  brightBlue: '#66d9ef',
  brightMagenta: '#ae81ff',
  brightCyan: '#a1efe4',
  brightWhite: '#f9f8f5',
  // UI Colors
  ui: {
    bg: '#272822',
    bgSecondary: '#1e1f1c',
    bgTertiary: '#49483e',
    border: '#32332b',
    text: '#f8f8f2',
    textSecondary: '#75715e',
    accent: '#66d9ef',
    iconColor: '#f8f8f2',
  }
};

// Solarized Dark Theme (정확한 Solarized 색상 체계)
export const solarizedDarkTheme = {
  background: '#002b36',    // base03
  foreground: '#839496',    // base0
  cursor: '#839496',
  cursorAccent: '#002b36',
  selection: 'rgba(7, 54, 66, 0.5)',
  black: '#073642',         // base02
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',         // base2
  brightBlack: '#002b36',   // base03
  brightRed: '#cb4b16',
  brightGreen: '#586e75',   // base01
  brightYellow: '#657b83',  // base00
  brightBlue: '#839496',    // base0
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',    // base1
  brightWhite: '#fdf6e3',   // base3
  // UI Colors
  ui: {
    bg: '#002b36',          // base03
    bgSecondary: '#073642', // base02
    bgTertiary: '#0d4450',  // base02보다 밝게
    border: '#0a3c47',      // 더 은은하게
    text: '#93a1a1',        // base1 (더 밝은 텍스트)
    textSecondary: '#839496', // base0 (더 밝게)
    accent: '#268bd2',
    iconColor: '#93a1a1',   // base1
  }
};

// GitHub Dark Theme
export const githubDarkTheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#c9d1d9',
  cursorAccent: '#0d1117',
  selection: 'rgba(56, 139, 253, 0.3)',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
  // UI Colors
  ui: {
    bg: '#0d1117',
    bgSecondary: '#010409',
    bgTertiary: '#21262d', // 더 밝게 (기존: #161b22)
    border: '#181b20',
    text: '#e6edf3', // 더 밝게 (기존: #c9d1d9)
    textSecondary: '#7d8590', // 약간 어둡게 (기존: #8b949e)
    accent: '#58a6ff',
    iconColor: '#e6edf3',
  }
};

// Catppuccin Mocha Theme
export const catppuccinTheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selection: 'rgba(116, 199, 236, 0.3)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
  // UI Colors
  ui: {
    bg: '#1e1e2e',
    bgSecondary: '#181825',
    bgTertiary: '#313244',
    border: '#25263a',
    text: '#cdd6f4',
    textSecondary: '#6c7086',
    accent: '#89b4fa',
    iconColor: '#cdd6f4',
  }
};

// 테마 맵핑
export const themes = {
  catppuccin: catppuccinTheme,
  dracula: draculaTheme,
  monokai: monokaiTheme,
  solarizedDark: solarizedDarkTheme,
  github: githubDarkTheme,
};

export const themeNames = Object.keys(themes);

export const defaultTheme = 'catppuccin';

export default themes;
