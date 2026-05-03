import { useState } from 'react';
import { Terminal as TerminalIcon, Sparkles } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

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
    if (username.length < 3) return setError(t('usernameMinLength'));
    if (password.length < 8) return setError(t('passwordMinLength'));
    if (password !== confirmPassword) return setError(t('passwordMismatch'));

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Setup failed');
      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to create admin account');
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
          <div style={styles.brandText}>Terminal List</div>
          <div style={styles.brandTag}>
            <Sparkles size={11} strokeWidth={2} />
            {t('initialSetup') || 'First-time setup'}
          </div>
        </div>

        <div style={styles.heading}>{t('createAdminAccount') || 'Create your admin account'}</div>
        <div style={styles.sub}>
          {t('initialSetupDescription') || 'This account is the only way in. Pick something you’ll remember.'}
        </div>

        <Field
          label={t('username') || 'Username'}
          value={username}
          onChange={setUsername}
          placeholder={t('usernamePlaceholder')}
          hint={t('usernameMinLength')}
          disabled={isLoading}
          autoFocus
        />
        <Field
          label={t('password') || 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t('passwordPlaceholder')}
          hint={t('passwordMinLength')}
          disabled={isLoading}
        />
        <Field
          label={t('confirmPassword') || 'Confirm password'}
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder={t('confirmPasswordPlaceholder')}
          disabled={isLoading}
        />

        {error && <div style={styles.error}>{error}</div>}

        <Button variant="primary" size="large" fullWidth type="submit" disabled={isLoading}>
          {isLoading ? (t('creating') || 'Creating…') : (t('createAccount') || 'Create account')}
        </Button>

        <div style={styles.footer}>
          {t('setupFooter') || 'You can change credentials later in settings.'}
        </div>
      </form>
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', placeholder, hint, disabled, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <label style={styles.field}>
      <div style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
        {hint && <span style={styles.hint}>{hint}</span>}
      </div>
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
    maxWidth: '420px',
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
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    letterSpacing: '0.02em',
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
  brandTag: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['1'],
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `2px ${space['2']}`,
    fontSize: fontSize['11'],
  },
  heading: {
    fontSize: fontSize['20'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    lineHeight: 1.2,
    marginTop: space['1'],
  },
  sub: {
    fontSize: fontSize['13'],
    color: color.muted,
    lineHeight: 1.5,
    marginBottom: space['1'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
  },
  labelRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['2'],
  },
  label: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    color: color.subtext,
  },
  hint: {
    fontSize: fontSize['11'],
    color: color.muted,
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
  footer: {
    marginTop: space['2'],
    fontSize: fontSize['11'],
    color: color.muted,
    textAlign: 'center',
  },
};

export default InitialSetup;
