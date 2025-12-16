/**
 * InitialSetup 컴포넌트
 * 초기 관리자 계정 설정 (Portainer 스타일)
 */
import { useState } from 'react';
import useTranslation from '../hooks/useTranslation';

const InitialSetup = ({ onComplete, language = 'en' }) => {
  const { t } = useTranslation(language);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // 유효성 검사
    if (username.length < 3) {
      setError(t('usernameMinLength') || 'Username must be at least 3 characters');
      return;
    }

    if (password.length < 8) {
      setError(t('passwordMinLength') || 'Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordMismatch') || 'Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Setup failed');
      }

      // 설정 완료
      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to create admin account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .initial-setup-overlay::-webkit-scrollbar,
        .initial-setup-container::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div style={styles.overlay} className="initial-setup-overlay">
        <div style={styles.container} className="initial-setup-container">
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
              placeholder={t('passwordPlaceholder') || 'Enter password (min 8 characters)'}
              disabled={isLoading}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>{t('confirmPassword') || 'Confirm Password'}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={styles.input}
              placeholder={t('confirmPasswordPlaceholder') || 'Re-enter password'}
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
            {isLoading ? (t('creating') || 'Creating...') : (t('createAccount') || 'Create Administrator')}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.footerText}>
            {t('setupFooter') || 'This account will have full access to all terminals and settings.'}
          </p>
        </div>
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
    // 스크롤바 숨기기
    scrollbarWidth: 'none', // Firefox
    msOverflowStyle: 'none', // IE/Edge
  },
  container: {
    backgroundColor: '#1e1f29',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '420px',
    padding: '40px',
    border: '1px solid #44475a',
    margin: '20px auto',
    maxHeight: 'calc(100vh - 40px)',
    overflowY: 'auto',
    // 스크롤바 숨기기
    scrollbarWidth: 'none', // Firefox
    msOverflowStyle: 'none', // IE/Edge
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
  footer: {
    marginTop: '24px',
    paddingTop: '24px',
    borderTop: '1px solid #44475a',
  },
  footerText: {
    margin: 0,
    fontSize: '12px',
    color: '#6272a4',
    textAlign: 'center',
    lineHeight: '1.6',
  },
};

export default InitialSetup;
