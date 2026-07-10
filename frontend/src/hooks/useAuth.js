import { useState, useEffect, useRef } from 'react';
import {
  authHeaders,
  clearAuthFallbacks,
  clearLegacyAuthStorage,
  clearVolatileAuthToken,
  getLegacyAuthToken,
  setVolatileAuthToken,
} from '../utils/auth';
import { clearDraft } from '../utils/quickInputDraft';
import { clearAllLocalCommands } from '../utils/commandHistory';

const useAuth = () => {
  const [authState, setAuthState] = useState({
    isLoading: true,
    needsSetup: false,
    isAuthenticated: false,
    username: null,
  });

  // verify 를 일시적 실패(네트워크 끊김 / 5xx)에는 재시도하고, 진짜 만료(401/403)만 즉시
  // 포기한다. Cloudflare 터널이 순간 502/끊김일 때 멀쩡한 세션을 로그인으로 튕기던 문제 방지.
  // 반환: { ok, expired, username } — ok=검증성공, expired=확정 만료(로그인 필요),
  // 둘 다 false = 일시적 장애(아직 만료 단정 불가).
  const VERIFY_MAX_ATTEMPTS = 4;
  const VERIFY_RETRY_BASE_MS = 400;
  const verifyWithRetry = async () => {
    for (let attempt = 0; attempt < VERIFY_MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch('/api/auth/verify', {
          headers: getLegacyAuthToken() ? authHeaders() : {},
        });
        // 401/403 = 토큰 진짜 만료/무효 → 재시도해도 소용없다. 즉시 로그인.
        if (res.status === 401 || res.status === 403) return { ok: false, expired: true };
        if (res.ok) {
          const data = await res.json();
          return { ok: true, expired: false, username: data.username };
        }
        // 그 외(5xx/502 등) = 서버/터널 일시 장애 → 재시도.
      } catch {
        // 네트워크 오류(터널 순간 끊김 등) → 재시도.
      }
      // 마지막 시도가 아니면 백오프 후 재시도.
      if (attempt < VERIFY_MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, VERIFY_RETRY_BASE_MS * (attempt + 1)));
      }
    }
    return { ok: false, expired: false }; // 일시적 장애로 확정 못 함
  };

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

      // 2. 쿠키 세션 확인(재시도 포함). 예전 localStorage Bearer 토큰이 있으면 이 요청에서
      // 서버가 HttpOnly 쿠키로 승격하고, 성공 후 로컬 토큰은 제거한다.
      const result = await verifyWithRetry();

      if (result.ok) {
        clearAuthFallbacks();
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: true,
          username: result.username,
        });
        return;
      }

      // 여기까지 왔으면 확정 만료(401/403)이거나, 재시도를 다 쓴 지속적 장애.
      // 둘 다 로그인 화면으로 보낸다(쿠키는 HttpOnly 라 JS 에서 살릴 수단이 없음).
      // 단, 일시적 블립은 위 verifyWithRetry(4회 ~2.4s)가 이미 흡수하므로 한 번 끊겼다고 안 튕긴다.
      clearAuthFallbacks();
      setAuthState({
        isLoading: false,
        needsSetup: false,
        isAuthenticated: false,
        username: null,
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
    // 명시적 로그아웃에서만 기기에 남은 명령 흔적을 지운다 — 쓰다 만 빠른입력 초안과
    // 터미널별 로컬 복구 슬롯에는 비밀번호가 섞일 수 있고, 공용 PC 라면 다음 사용자가
    // localStorage 에서 그대로 읽는다. (세션 만료 경로는 재로그인 복원을 위해 남겨둔다.)
    clearDraft();
    clearAllLocalCommands();
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
