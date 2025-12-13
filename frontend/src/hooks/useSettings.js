/**
 * useSettings 훅
 * 사용자 설정 관리 (테마, 언어, 스크롤 등)
 */
import { useState, useEffect } from 'react';

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
  fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
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
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
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
      [key]: value,
    }));
  };

  // 여러 설정 동시 업데이트
  const updateSettings = (newSettings) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
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
