import { useState } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

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
      setError(t('fillAllFields'));
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Login failed');
      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('username', data.username);
      onLogin(data.access_token, data.username);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.brandIcon}>
            <TerminalIcon size={16} strokeWidth={2} />
          </div>
          <div style={styles.brandText}>iTerminaLlist</div>
        </div>

        <div style={styles.heading}>{t('login') || 'Sign in'}</div>
        <div style={styles.sub}>{t('loginDescription') || 'Access your terminal sessions'}</div>

        <Field
          label={t('username') || 'Username'}
          value={username}
          onChange={setUsername}
          placeholder={t('usernamePlaceholder')}
          disabled={isLoading}
          autoFocus
        />
        <Field
          label={t('password') || 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t('passwordPlaceholder')}
          disabled={isLoading}
        />

        {error && <div style={styles.error}>{error}</div>}

        <Button variant="primary" size="large" fullWidth type="submit" disabled={isLoading}>
          {isLoading ? (t('signingIn') || 'Signing in…') : (t('signIn') || 'Sign in')}
        </Button>
      </form>
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', placeholder, disabled, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...styles.input,
          borderColor: focused ? color.accentBorder : color.border,
          background: focused ? color.crust : color.mantle,
        }}
      />
    </label>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: color.crust,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    fontFamily: font.sans,
  },
  card: {
    width: '100%',
    maxWidth: '380px',
    padding: `${space['8']} ${space['8']} ${space['6']}`,
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.pop,
    display: 'flex',
    flexDirection: 'column',
    gap: space['4'],
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    color: color.subtext,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    letterSpacing: '0.02em',
    marginBottom: space['1'],
  },
  brandIcon: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    color: color.accent,
  },
  brandText: {
    color: color.text,
  },
  heading: {
    fontSize: fontSize['20'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    margin: 0,
    lineHeight: 1.2,
  },
  sub: {
    fontSize: fontSize['13'],
    color: color.muted,
    margin: 0,
    marginBottom: space['1'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
  },
  label: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    color: color.subtext,
  },
  input: {
    height: '34px',
    padding: `0 ${space['3']}`,
    fontSize: fontSize['13'],
    fontFamily: font.sans,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    outline: 'none',
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
  error: {
    fontSize: fontSize['12'],
    color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: `1px solid rgba(243, 139, 168, 0.18)`,
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
  },
};

export default Login;
