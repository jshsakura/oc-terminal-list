/**
 * useSettings 훅
 * 사용자 설정 관리 (테마, 언어, 스크롤 등)
 *
 * 영속성 정책:
 * - 인증 후: GET /api/user/settings 으로 서버 값 받아 즉시 반영 (localStorage 에도 캐시).
 * - 변경 시: localStorage 즉시 + 600ms 디바운스 후 PUT /api/user/settings.
 * - 미인증 / 오프라인: localStorage 만 사용 (캐시).
 */
import { useState, useEffect, useRef } from 'react';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../utils/terminalFonts';
import { DEFAULT_MOBILE_KEYS } from '../utils/mobileKeys';

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
  fontSize: 12,            // PC 글자크기
  fontSizeMobile: 13,      // 모바일 글자크기 (별도 — 작은 화면 보정)
  fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  defaultShell: 'auto',  // 시스템 로그인 쉘 자동 사용 (zsh, bash 등)
  autoScroll: 'smart', // 'always' | 'smart' | 'never'
  smoothScroll: true,
  scrollSensitivity: 0.8, // AI 스트리밍 대응 (0~1, 높을수록 민감)
  localStartPath: '',  // 현재 머신 새 터미널 시작 경로 (워크스페이스 상대, 빈 값 = 루트)
  localTheme: '',       // 로컬 기본 테마 — 비우면 글로벌 theme. 호스트 와 동등 (호스트별 theme 필드와 짝).
  localName: '',       // 비우면 i18n 의 'thisMachine' 기본값 사용
  localIcon: '',       // 비우면 Monitor 아이콘
  localColorIndex: 0,  // 호스트 카드의 ColorPicker 와 동일한 인덱스
  useWebgl: true,      // GPU 가속 렌더러 — context loss / 초기화 실패 시 Terminal.jsx 가 자동으로 DOM 으로 폴백
  mobileKeys: DEFAULT_MOBILE_KEYS,  // 모바일 하단 단축키 목록 — 사용자가 Settings 에서 편집
};

const STORAGE_KEY = 'terminal_settings';

export const useSettings = () => {
  const [settings, setSettings] = useState(() => {
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

  // ── 서버에서 가져오기 (인증 후 한 번) — 다른 디바이스에서 저장된 값 반영 ──
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/user/settings', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data?.settings;
        if (remote && typeof remote === 'object' && Object.keys(remote).length > 0) {
          setSettings((prev) => ({
            ...DEFAULT_SETTINGS,
            ...prev,
            ...remote,
            fontFamily: normalizeTerminalFontFamily(remote.fontFamily ?? prev.fontFamily),
            defaultShell: normalizeDefaultShell(remote.defaultShell ?? prev.defaultShell),
          }));
        }
      } catch (err) {
        // 오프라인이면 그냥 localStorage 값으로 진행
        console.warn('user settings fetch failed:', err);
      }
    })();
  }, []);

  // ── 변경 시: localStorage 즉시, 서버는 디바운스 ──
  const saveDebounceRef = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}

    const token = localStorage.getItem('auth_token');
    // 서버 저장은 인증된 상태 + 첫 fetch 가 끝난 후에만 (초기 로드 직후 덮어쓰기 방지)
    if (!token || !fetchedRef.current) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      fetch('/api/user/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ settings }),
      }).catch((err) => console.warn('user settings save failed:', err));
    }, 600);
    return () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); };
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
