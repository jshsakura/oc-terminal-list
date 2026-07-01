/**
 * 터미널 테마 정의 (part D) — 색다른 다크 테마 모음.
 * 기존 A/B/C 와 겹치지 않는 개성 있는 다크 팔레트. themes/index.js 가 모아 themes 맵을 만든다.
 */
import { commonUI } from './commonUI';

const SHADOW = '0 8px 32px rgba(0,0,0,0.45)';
const INNER = 'inset 0 1px 0 rgba(255,255,255,0.04)';

// 1. Espresso — 따뜻한 커피/카라멜 톤 다크
export const espressoTheme = {
  background: '#1c1410',
  foreground: '#e6d5c3',
  cursor: '#d9a066',
  cursorAccent: '#1c1410',
  selection: 'rgba(217, 160, 102, 0.25)',
  black: '#2a201a', red: '#e0715c', green: '#a3b565', yellow: '#d9a066',
  blue: '#8ab0b0', magenta: '#c99aa8', cyan: '#8fbcbb', white: '#e6d5c3',
  brightBlack: '#6b5748', brightRed: '#e88a76', brightGreen: '#b6c77e',
  brightYellow: '#e6b57e', brightBlue: '#a4c4c4', brightMagenta: '#d6adb9',
  brightCyan: '#a6cfce', brightWhite: '#f3e8db',
  ui: {
    ...commonUI,
    bg: '#241a14', bgSecondary: '#1c140f', bgTertiary: '#31241b',
    glassBg: 'rgba(36, 26, 20, 0.78)', cardBg: '#31241b',
    border: 'rgba(230, 213, 195, 0.09)', borderLight: 'rgba(230, 213, 195, 0.16)',
    text: '#f3e8db', textSecondary: '#a8927e',
    accent: '#d9a066', accentMuted: 'rgba(217, 160, 102, 0.15)',
    iconColor: '#a8927e', shadow: SHADOW, innerShadow: INNER,
  },
};

// 2. Blood Moon — 근흑색 + 크림슨
export const bloodMoonTheme = {
  background: '#17090b',
  foreground: '#e8d0d0',
  cursor: '#e0384f',
  cursorAccent: '#17090b',
  selection: 'rgba(224, 56, 79, 0.28)',
  black: '#2a1418', red: '#e0384f', green: '#8fae7a', yellow: '#d6a45c',
  blue: '#7a8fb8', magenta: '#c76b8f', cyan: '#6fb0ac', white: '#e8d0d0',
  brightBlack: '#6e444b', brightRed: '#f25668', brightGreen: '#a6c390',
  brightYellow: '#e6bd7a', brightBlue: '#98a9cc', brightMagenta: '#dc89a6',
  brightCyan: '#8ac6c2', brightWhite: '#f5e6e6',
  ui: {
    ...commonUI,
    bg: '#200d10', bgSecondary: '#17090b', bgTertiary: '#2e1519',
    glassBg: 'rgba(32, 13, 16, 0.80)', cardBg: '#2e1519',
    border: 'rgba(232, 208, 208, 0.09)', borderLight: 'rgba(232, 208, 208, 0.16)',
    text: '#f5e6e6', textSecondary: '#b08a8f',
    accent: '#e0384f', accentMuted: 'rgba(224, 56, 79, 0.16)',
    iconColor: '#b08a8f', shadow: SHADOW, innerShadow: INNER,
  },
};

// 3. Matrix — 흑색 + 인광 그린 (클래식 터미널)
export const matrixTheme = {
  background: '#0a0f0a',
  foreground: '#9fe0a0',
  cursor: '#38d651',
  cursorAccent: '#0a0f0a',
  selection: 'rgba(56, 214, 81, 0.24)',
  black: '#16211a', red: '#d66a5a', green: '#38d651', yellow: '#b8d65a',
  blue: '#5aa8a0', magenta: '#7ac97a', cyan: '#4fd6a8', white: '#9fe0a0',
  brightBlack: '#3f6b4d', brightRed: '#e6836f', brightGreen: '#5cec72',
  brightYellow: '#cfe676', brightBlue: '#78c2ba', brightMagenta: '#96e096',
  brightCyan: '#6fecc0', brightWhite: '#d6f5d6',
  ui: {
    ...commonUI,
    bg: '#0e150e', bgSecondary: '#0a0f0a', bgTertiary: '#17211a',
    glassBg: 'rgba(14, 21, 14, 0.80)', cardBg: '#17211a',
    border: 'rgba(159, 224, 160, 0.10)', borderLight: 'rgba(159, 224, 160, 0.18)',
    text: '#d6f5d6', textSecondary: '#6fa878',
    accent: '#38d651', accentMuted: 'rgba(56, 214, 81, 0.15)',
    iconColor: '#6fa878', shadow: SHADOW, innerShadow: INNER,
  },
};

// 4. Deep Sea — 심해 네이비 + 아쿠아
export const deepSeaTheme = {
  background: '#071018',
  foreground: '#c4dde6',
  cursor: '#2fb6c9',
  cursorAccent: '#071018',
  selection: 'rgba(47, 182, 201, 0.26)',
  black: '#122430', red: '#e0697a', green: '#6fc39a', yellow: '#d6bf7a',
  blue: '#4a9fd6', magenta: '#a98fd6', cyan: '#2fb6c9', white: '#c4dde6',
  brightBlack: '#3d6478', brightRed: '#ec8492', brightGreen: '#8ad6b0',
  brightYellow: '#e6d294', brightBlue: '#6cb6e6', brightMagenta: '#bfa6e6',
  brightCyan: '#54cddd', brightWhite: '#e0f0f5',
  ui: {
    ...commonUI,
    bg: '#0a1620', bgSecondary: '#071018', bgTertiary: '#12242f',
    glassBg: 'rgba(10, 22, 32, 0.80)', cardBg: '#12242f',
    border: 'rgba(196, 221, 230, 0.09)', borderLight: 'rgba(196, 221, 230, 0.16)',
    text: '#e0f0f5', textSecondary: '#7fa0ad',
    accent: '#2fb6c9', accentMuted: 'rgba(47, 182, 201, 0.15)',
    iconColor: '#7fa0ad', shadow: SHADOW, innerShadow: INNER,
  },
};

// 5. Amethyst — 다크 플럼 + 바이올렛
export const amethystTheme = {
  background: '#17111f',
  foreground: '#e0d4ec',
  cursor: '#a678e0',
  cursorAccent: '#17111f',
  selection: 'rgba(166, 120, 224, 0.26)',
  black: '#251b31', red: '#e07a9a', green: '#9fc98a', yellow: '#d6b87a',
  blue: '#8a9fe0', magenta: '#c78fe0', cyan: '#7ac9c4', white: '#e0d4ec',
  brightBlack: '#5b4a6e', brightRed: '#ec95b0', brightGreen: '#b3dba0',
  brightYellow: '#e6cd94', brightBlue: '#a4b6ec', brightMagenta: '#d8a9ec',
  brightCyan: '#95dcd7', brightWhite: '#f0e8f7',
  ui: {
    ...commonUI,
    bg: '#1e1729', bgSecondary: '#17111f', bgTertiary: '#2a2039',
    glassBg: 'rgba(30, 23, 41, 0.80)', cardBg: '#2a2039',
    border: 'rgba(224, 212, 236, 0.09)', borderLight: 'rgba(224, 212, 236, 0.16)',
    text: '#f0e8f7', textSecondary: '#9d8bb0',
    accent: '#a678e0', accentMuted: 'rgba(166, 120, 224, 0.16)',
    iconColor: '#9d8bb0', shadow: SHADOW, innerShadow: INNER,
  },
};

// 6. Carbon — OLED 뉴트럴 그래파이트 + 클린 블루
export const carbonTheme = {
  background: '#0c0c0e',
  foreground: '#d4d6da',
  cursor: '#6aa0ff',
  cursorAccent: '#0c0c0e',
  selection: 'rgba(106, 160, 255, 0.24)',
  black: '#1a1a1e', red: '#e0707a', green: '#8fc98f', yellow: '#d6c47a',
  blue: '#6aa0ff', magenta: '#b48fd6', cyan: '#6fc4c9', white: '#d4d6da',
  brightBlack: '#55575e', brightRed: '#ec8b93', brightGreen: '#a6dba6',
  brightYellow: '#e6d894', brightBlue: '#8ab6ff', brightMagenta: '#c9a9e6',
  brightCyan: '#8ad6db', brightWhite: '#eef0f3',
  ui: {
    ...commonUI,
    bg: '#141416', bgSecondary: '#0c0c0e', bgTertiary: '#202024',
    glassBg: 'rgba(20, 20, 22, 0.82)', cardBg: '#202024',
    border: 'rgba(212, 214, 218, 0.09)', borderLight: 'rgba(212, 214, 218, 0.16)',
    text: '#eef0f3', textSecondary: '#8a8c93',
    accent: '#6aa0ff', accentMuted: 'rgba(106, 160, 255, 0.15)',
    iconColor: '#8a8c93', shadow: SHADOW, innerShadow: INNER,
  },
};
