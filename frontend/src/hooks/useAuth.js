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
