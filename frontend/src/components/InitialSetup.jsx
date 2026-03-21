/**
 * InitialSetup 컴포넌트
 * 초기 관리자 계정 설정
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

    if (username.length < 3) {
      setError(t('usernameMinLength'));
      return;
    }

    if (password.length < 8) {
      setError(t('passwordMinLength'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'));
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

      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to create admin account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.icon}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M7 10l3 3-3 3" />
              <line x1="13" y1="16" x2="17" y2="16" />
            </svg>
          </div>
          <h1 style={styles.title}>{t('initialSetup')}</h1>
          <p style={styles.description}>{t('initialSetupDescription')}</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              placeholder={t('usernamePlaceholder')}
              disabled={isLoading}
              autoFocus
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder={t('passwordPlaceholder')}
              disabled={isLoading}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>{t('confirmPassword')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={styles.input}
              placeholder={t('confirmPasswordPlaceholder')}
              disabled={isLoading}
              required
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={styles.submitBtn} disabled={isLoading}>
            {isLoading ? t('creating') : t('createAccount')}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.footerText}>{t('setupFooter')}</p>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1e1e2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(10px)',
  },
  container: {
    backgroundColor: 'rgba(30, 30, 46, 0.7)',
    backdropFilter: 'blur(20px)',
    borderRadius: '24px',
    width: '90%',
    maxWidth: '400px',
    padding: '40px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  icon: {
    color: '#89b4fa',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'center',
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '22px',
    fontWeight: '800',
    color: '#cdd6f4',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  description: {
    margin: 0,
    fontSize: '14px',
    color: '#6c7086',
    lineHeight: '1.5',
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
    fontSize: '13px',
    fontWeight: '700',
    color: '#cdd6f4',
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  input: {
    padding: '14px 16px',
    fontSize: '14px',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    color: '#cdd6f4',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    outline: 'none',
    transition: 'all 0.2s ease',
    fontFamily: '"JetBrains Mono", monospace',
  },
  error: {
    padding: '12px',
    backgroundColor: 'rgba(243, 139, 168, 0.1)',
    color: '#f38ba8',
    borderRadius: '12px',
    fontSize: '13px',
    textAlign: 'center',
    border: '1px solid rgba(243, 139, 168, 0.2)',
    fontWeight: '600',
  },
  submitBtn: {
    padding: '14px 24px',
    backgroundColor: '#89b4fa',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: '800',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 15px rgba(137, 180, 250, 0.3)',
  },
  footer: {
    marginTop: '32px',
    textAlign: 'center',
  },
  footerText: {
    margin: 0,
    fontSize: '11px',
    color: '#6c7086',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
};

export default InitialSetup;
