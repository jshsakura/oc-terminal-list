import { useState } from 'react';
import { Terminal as TerminalIcon, ShieldCheck } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

const Login = ({ onLogin, language = 'en' }) => {
  const { t } = useTranslation(language);
  const [step, setStep] = useState('credentials'); // 'credentials' | 'otp'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const finishLogin = (data) => {
    localStorage.setItem('auth_token', data.access_token);
    localStorage.setItem('username', data.username);
    onLogin(data.access_token, data.username);
  };

  const handleCredentialsSubmit = async (e) => {
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
      if (data.otp_required) {
        setPendingToken(data.pending_token);
        setStep('otp');
        setOtpCode('');
        setUseBackupCode(false);
      } else {
        finishLogin(data);
      }
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = otpCode.trim();
    if (!trimmed) {
      setError(t('otpEnterCode') || 'Enter the code from your authenticator app');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pending_token: pendingToken,
          code: trimmed,
          is_backup_code: useBackupCode,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'OTP verification failed');
      finishLogin(data);
    } catch (err) {
      setError(err.message);
      setOtpCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const goBack = () => {
    setStep('credentials');
    setPendingToken('');
    setOtpCode('');
    setError('');
  };

  return (
    <div style={styles.overlay}>
      {step === 'credentials' ? (
        <form onSubmit={handleCredentialsSubmit} style={styles.card}>
          <div style={styles.brand}>
            <div style={styles.brandIcon}>
              <TerminalIcon size={16} strokeWidth={2} />
            </div>
            <div style={styles.brandText}>Terminal List</div>
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
      ) : (
        <form onSubmit={handleOtpSubmit} style={styles.card}>
          <div style={styles.brand}>
            <div style={styles.brandIcon}>
              <ShieldCheck size={16} strokeWidth={2} />
            </div>
            <div style={styles.brandText}>Terminal List</div>
          </div>

          <div style={styles.heading}>
            {useBackupCode
              ? (t('otpBackupCodeTitle') || 'Use a backup code')
              : (t('otpStepTitle') || 'Two-factor authentication')}
          </div>
          <div style={styles.sub}>
            {useBackupCode
              ? (t('otpBackupCodeHint') || 'Enter one of the backup codes you saved.')
              : (t('otpStepHint') || 'Enter the 6-digit code from your authenticator app.')}
          </div>

          <Field
            label={useBackupCode
              ? (t('otpBackupCodeLabel') || 'Backup code')
              : (t('otpCodeLabel') || 'Verification code')}
            value={otpCode}
            onChange={(v) => {
              if (useBackupCode) setOtpCode(v.toUpperCase());
              else setOtpCode(v.replace(/\D/g, '').slice(0, 6));
            }}
            placeholder={useBackupCode ? 'XXXXXXXX' : '123456'}
            disabled={isLoading}
            autoFocus
            inputMode={useBackupCode ? 'text' : 'numeric'}
            mono
            autoComplete="one-time-code"
          />

          {error && <div style={styles.error}>{error}</div>}

          <Button variant="primary" size="large" fullWidth type="submit" disabled={isLoading}>
            {isLoading ? (t('verifying') || 'Verifying…') : (t('signIn') || 'Sign in')}
          </Button>

          <div style={styles.linkRow}>
            <button type="button" onClick={goBack} style={styles.linkBtn} disabled={isLoading}>
              {t('back') || 'Back'}
            </button>
            <button
              type="button"
              onClick={() => { setUseBackupCode((b) => !b); setOtpCode(''); setError(''); }}
              style={styles.linkBtn}
              disabled={isLoading}
            >
              {useBackupCode
                ? (t('otpUseAuthApp') || 'Use authenticator app')
                : (t('otpUseBackupCode') || 'Use a backup code')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', placeholder, disabled, autoFocus, inputMode, mono, autoComplete }) => {
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
        inputMode={inputMode}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...styles.input,
          borderColor: focused ? color.accentBorder : color.border,
          background: focused ? color.crust : color.mantle,
          fontFamily: mono ? font.mono : font.sans,
          letterSpacing: mono ? '0.25em' : 'normal',
          textAlign: mono ? 'center' : 'left',
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
  linkRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space['2'],
    marginTop: space['1'],
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: color.accent,
    fontSize: fontSize['12'],
    cursor: 'pointer',
    padding: `${space['1']} ${space['2']}`,
  },
};

export default Login;
