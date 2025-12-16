/**
 * Login 컴포넌트
 * 관리자 로그인
 */
import { useState } from 'react';
import useTranslation from '../hooks/useTranslation';

const Login = ({ onLogin, language = 'en' }) => {
  const { t } = useTranslation(language);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError(t('fillAllFields') || 'Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Login failed');
      }

      // 로그인 성공 - 토큰 저장
      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('username', data.username);

      // 부모 컴포넌트에 알림
      onLogin(data.access_token, data.username);
    } catch (err) {
      setError(err.message || 'Invalid username or password');
      setPassword(''); // 비밀번호 필드 초기화
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .login-overlay::-webkit-scrollbar,
        .login-container::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div style={styles.overlay} className="login-overlay">
        <div style={styles.container} className="login-container">
          <div style={styles.header}>
            <div style={styles.icon}>
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M7 10l3 3-3 3" />
                <line x1="13" y1="16" x2="17" y2="16" />
              </svg>
            </div>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('username') || 'Username'}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              placeholder={t('usernamePlaceholder') || 'Enter username'}
              disabled={isLoading}
              autoFocus
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>{t('password') || 'Password'}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder={t('passwordPlaceholder') || 'Enter password'}
              disabled={isLoading}
              required
            />
          </div>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={styles.submitBtn}
            disabled={isLoading}
          >
            {isLoading ? (t('signingIn') || 'Signing in...') : (t('signIn') || 'Sign In')}
          </button>
        </form>
      </div>
    </div>
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#282a36',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    overflow: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  container: {
    backgroundColor: '#1e1f29',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '380px',
    padding: '40px',
    border: '1px solid #44475a',
    margin: '20px auto',
    maxHeight: 'calc(100vh - 40px)',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  icon: {
    color: '#bd93f9',
    margin: '0 auto',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#f8f8f2',
  },
  input: {
    padding: '12px 16px',
    fontSize: '14px',
    backgroundColor: '#282a36',
    color: '#f8f8f2',
    border: '1px solid #44475a',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    padding: '12px 16px',
    backgroundColor: '#ff5555',
    color: '#f8f8f2',
    borderRadius: '6px',
    fontSize: '14px',
    textAlign: 'center',
  },
  submitBtn: {
    padding: '14px 24px',
    backgroundColor: '#50fa7b',
    color: '#282a36',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginTop: '8px',
  },
};

export default Login;
