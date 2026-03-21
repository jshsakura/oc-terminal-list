import { useState, useEffect } from 'react';

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
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        setAuthState({
          isLoading: false,
          needsSetup: true,
          isAuthenticated: false,
          username: null,
        });
        return;
      }

      // 2. 저장된 토큰 확인
      const token = localStorage.getItem('auth_token');
      if (!token) {
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: false,
          username: null,
        });
        return;
      }

      // 3. 토큰 유효성 검증
      const verifyResponse = await fetch('/api/auth/verify', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!verifyResponse.ok) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
        setAuthState({
          isLoading: false,
          needsSetup: false,
          isAuthenticated: false,
          username: null,
        });
        return;
      }

      const verifyData = await verifyResponse.json();

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

  const login = (token, username) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('username', username);
    setAuthState({
      isLoading: false,
      needsSetup: false,
      isAuthenticated: true,
      username,
    });
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
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
