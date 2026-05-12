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

export const DEFAULT_SETTINGS = {
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
const DIRTY_KEY = 'terminal_settings_dirty';

const saveSettingsToServer = async (token, nextSettings) => {
  const payload = JSON.stringify(nextSettings);
  const res = await fetch('/api/user/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ settings: nextSettings }),
  });
  if (!res.ok) {
    throw new Error(`settings save failed: ${res.status}`);
  }
  return payload;
};

const markSettingsDirty = () => {
  try { localStorage.setItem(DIRTY_KEY, '1'); } catch {}
};

const clearSettingsDirty = (savedPayload, currentSettings) => {
  if (JSON.stringify(currentSettings) === savedPayload) {
    try { localStorage.removeItem(DIRTY_KEY); } catch {}
  }
};

// isAuthenticated 가 false → true 로 바뀌는 순간에도 fetch 가 다시 트리거되도록 dep 으로 받음.
// (생략하면 mount 1회만 실행 → 로그인 *후* 처음 로드 케이스에서 서버 설정 영원히 못 가져옴.)
export const useSettings = (isAuthenticated = null) => {
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
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // ── 서버에서 가져오기 (인증 후 한 번) — 다른 디바이스에서 저장된 값 반영 ──
  // isAuthenticated 가 dep — 로그인 *후* 처음 로드되는 케이스에서도 한 번 실행되도록.
  // (이전엔 deps=[] 라 mount 시 token 이 없으면 영원히 fetch 안 됨 → 모바일 폰트 등 서버측
  //  값이 절대 안 내려오는 버그.)
  const fetchedRef = useRef(false);
  const fetchStartedRef = useRef(false);
  useEffect(() => {
    if (fetchStartedRef.current) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    // isAuthenticated 를 명시적으로 전달받았는데 아직 false 면 보류 — useAuth 가 verify 끝나길 기다림.
    if (isAuthenticated === false) return;
    fetchStartedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/user/settings', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data?.settings;
        if (localStorage.getItem(DIRTY_KEY) === '1') {
          const savedPayload = await saveSettingsToServer(token, settingsRef.current);
          clearSettingsDirty(savedPayload, settingsRef.current);
          return;
        }
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
      } finally {
        fetchedRef.current = true;
      }
    })();
  }, [isAuthenticated]);

  // ── 변경 시: localStorage 즉시, 서버는 디바운스 ──
  const saveDebounceRef = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}

    const token = localStorage.getItem('auth_token');
    // 서버 저장은 인증된 상태 + 첫 fetch 가 끝난 후에만 (초기 로드 직후 덮어쓰기 방지)
    if (!token || !fetchedRef.current) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveSettingsToServer(token, settings)
        .then((savedPayload) => clearSettingsDirty(savedPayload, settingsRef.current))
        .catch((err) => console.warn('user settings save failed:', err));
    }, 600);
    return () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); };
  }, [settings]);

  // 개별 설정 업데이트
  const updateSetting = (key, value) => {
    markSettingsDirty();
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
    markSettingsDirty();
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      fontFamily: normalizeTerminalFontFamily(newSettings.fontFamily ?? prev.fontFamily),
      defaultShell: normalizeDefaultShell(newSettings.defaultShell ?? prev.defaultShell),
    }));
  };

  // 설정 초기화
  const resetSettings = () => {
    markSettingsDirty();
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
