import { useState, useEffect, useRef } from 'react';
import {
  authHeaders,
  clearAuthFallbacks,
  clearLegacyAuthStorage,
  clearVolatileAuthToken,
  getLegacyAuthToken,
  setVolatileAuthToken,
} from '../utils/auth';

const useAuth = () => {
  const [authState, setAuthState] = useState({
    isLoading: true,
    needsSetup: false,
    isAuthenticated: false,
    username: null,
  });

  const checkAuthStatus = async () => {
    try {
      // 1. 초기 설정 완료 여부 확인
      const statusResponse = await fetch('/api/auth/status');
      const statusData = await statusResponse.json();

      if (!statusData.setup_complete) {
        clearAuthFallbacks();
        setAuthState({
          isLoading: false,
          needsSetup: true,
          isAuthenticated: false,
          username: null,
        });
        return;
      }

      // 2. 쿠키 세션 확인. 예전 localStorage Bearer 토큰이 있으면 이 요청에서
      // 서버가 HttpOnly 쿠키로 승격하고, 성공 후 로컬 토큰은 제거한다.
      const verifyResponse = await fetch('/api/auth/verify', {
        headers: getLegacyAuthToken() ? authHeaders() : {},
      });

      if (!verifyResponse.ok) {
        clearAuthFallbacks();
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: false,
          username: null,
        });
        return;
      }

      const verifyData = await verifyResponse.json();
      clearAuthFallbacks();

      setAuthState({
        isLoading: false,
        needsSetup: false,
        isAuthenticated: true,
        username: verifyData.username,
      });
    } catch (error) {
      console.error('Auth check failed:', error);
      setAuthState({
        isLoading: false,
        needsSetup: false,
        isAuthenticated: false,
        username: null,
      });
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  // 어디서든 auth:session-expired 이벤트가 발생하면 즉시 로그인 화면으로 전환
  const logoutRef = useRef(null);
  logoutRef.current = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
    clearAuthFallbacks();
    setAuthState({ isLoading: false, needsSetup: false, isAuthenticated: false, username: null });
  };
  useEffect(() => {
    const handler = () => logoutRef.current?.();
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, []);

  // 활동 기반 토큰 갱신 — 사용자가 실제로 쓰고 있는 동안엔 24h 만료로 튕기지 않게
  // 주기적으로 만료 시각을 미룬다. 자리를 비우면(활동 없음) 갱신하지 않아 결국 만료되어
  // 보안 의도(24h)는 그대로 유지된다 ("상황에 따라 자동 대처").
  useEffect(() => {
    if (!authState.isAuthenticated) return undefined;
    const ACTIVITY_WINDOW_MS = 2 * 60 * 60 * 1000; // 최근 2h 내 활동이면 active 로 간주
    const REFRESH_INTERVAL_MS = 30 * 60 * 1000;     // 30분마다 점검 — 24h 만료 전 충분히 갱신
    let lastActivity = Date.now();
    const bump = () => { lastActivity = Date.now(); };
    // 터미널 입출력(iterm:activity) + 키/마우스 활동을 모두 활동 신호로 본다.
    window.addEventListener('iterm:activity', bump);
    window.addEventListener('keydown', bump, true);
    window.addEventListener('mousedown', bump, true);
    const id = setInterval(() => {
      if (Date.now() - lastActivity > ACTIVITY_WINDOW_MS) return; // idle → 만료 허용
      fetch('/api/auth/refresh', { method: 'POST', headers: authHeaders() })
        .then((res) => {
          // 이미 만료된 뒤(자리 오래 비움)면 401 → 로그인 유도. 재로그인 시 탭/세션 자동 복원됨.
          if (res.status === 401 || res.status === 403) {
            window.dispatchEvent(new CustomEvent('auth:session-expired'));
          }
        })
        .catch(() => { /* 일시적 네트워크 오류 — 다음 틱에 재시도 */ });
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      window.removeEventListener('iterm:activity', bump);
      window.removeEventListener('keydown', bump, true);
      window.removeEventListener('mousedown', bump, true);
    };
  }, [authState.isAuthenticated]);

  const login = (username, sessionToken = null) => {
    setVolatileAuthToken(sessionToken);
    clearLegacyAuthStorage();
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: true,
      username,
    });
    if (sessionToken) {
      // Cookie-only verification. If this succeeds, the HttpOnly cookie path is
      // healthy and the in-memory fallback can be discarded immediately.
      fetch('/api/auth/verify')
        .then((res) => {
          if (res.ok) clearVolatileAuthToken();
        })
        .catch(() => {});
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 네트워크 실패여도 클라이언트 상태는 정리한다.
    }
    clearAuthFallbacks();
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: false,
      username: null,
    });
  };

  const completeSetup = () => {
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: false,
      username: null,
    });
  };

  return {
    ...authState,
    login,
    logout,
    completeSetup,
    refreshAuth: checkAuthStatus
  };
};

export default useAuth;
