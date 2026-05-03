/**
 * useSettings 훅
 * 사용자 설정 관리 (테마, 언어, 스크롤 등)
 */
import { useState, useEffect } from 'react';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../utils/terminalFonts';

const SUPPORTED_DEFAULT_SHELLS = new Set(['auto', 'bash', 'zsh', 'sh']);

const normalizeDefaultShell = (value) => {
  if (typeof value !== 'string') {
    return 'auto';
  }

  const normalized = value.trim().toLowerCase();
  // 'bash' 가 묵시적 기본값으로 박혀있던 옛 설정 → 시스템 쉘 사용으로 한 번 마이그레이션.
  // 명시적으로 bash 쓰려면 사용자가 Settings 에서 다시 선택.
  if (normalized === 'bash' && !localStorage.getItem('shell_pref_v2')) {
    try { localStorage.setItem('shell_pref_v2', '1'); } catch {}
    return 'auto';
  }
  return SUPPORTED_DEFAULT_SHELLS.has(normalized) ? normalized : 'auto';
};

// 브라우저 언어 자동 감지
const detectBrowserLanguage = () => {
  // navigator.language 또는 navigator.languages에서 언어 감지
  const browserLang = navigator.language || navigator.languages?.[0] || 'en';

  // 한국어 감지 (ko, ko-KR, ko-kr 등)
  if (browserLang.toLowerCase().startsWith('ko')) {
    return 'ko';
  }

  // 기본값 영어
  return 'en';
};

const DEFAULT_SETTINGS = {
  theme: 'catppuccin',
  language: detectBrowserLanguage(), // 브라우저 언어 자동 감지
  fontSize: 14,
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  defaultShell: 'auto',  // 시스템 로그인 쉘 자동 사용 (zsh, bash 등)
  autoScroll: 'smart', // 'always' | 'smart' | 'never'
  smoothScroll: true,
  scrollSensitivity: 0.8, // AI 스트리밍 대응 (0~1, 높을수록 민감)
};

const STORAGE_KEY = 'terminal_settings';

export const useSettings = () => {
  const [settings, setSettings] = useState(() => {
    // localStorage에서 설정 로드
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        return {
          ...merged,
          fontFamily: normalizeTerminalFontFamily(merged.fontFamily),
          defaultShell: normalizeDefaultShell(merged.defaultShell),
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return DEFAULT_SETTINGS;
  });

  // 설정이 변경될 때마다 localStorage에 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, [settings]);

  // 개별 설정 업데이트
  const updateSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: key === 'fontFamily'
        ? normalizeTerminalFontFamily(value)
        : key === 'defaultShell'
          ? normalizeDefaultShell(value)
          : value,
    }));
  };

  // 여러 설정 동시 업데이트
  const updateSettings = (newSettings) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      fontFamily: normalizeTerminalFontFamily(newSettings.fontFamily ?? prev.fontFamily),
      defaultShell: normalizeDefaultShell(newSettings.defaultShell ?? prev.defaultShell),
    }));
  };

  // 설정 초기화
  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
  };
};

export default useSettings;
