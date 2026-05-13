import { useState, useEffect, useMemo } from 'react';
import { Terminal as TerminalIcon, Sparkles, User, Lock, KeyRound, ChevronRight } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

const Field = ({ label, value, onChange, type = 'text', placeholder, hint, disabled, autoFocus, icon: Icon }) => {
  const [focused, setFocused] = useState(false);
  return (
    <label style={styles.field}>
      <div style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
        {hint && <span style={styles.hint}>{hint}</span>}
      </div>
      <div style={{
        ...styles.inputWrap,
        borderColor: focused ? color.accentBorder : color.border,
        boxShadow: focused ? `0 0 0 2px ${color.accent}18` : 'none',
        background: focused ? color.crust : color.surface0,
      }}>
        {Icon && <Icon size={14} strokeWidth={2} style={{ color: focused ? color.accentBorder : color.muted, flexShrink: 0 }} />}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
      </div>
    </label>
  );
};

const InitialSetup = ({ onComplete, language = 'en' }) => {
  const { t } = useTranslation(language);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [vpStyle, setVpStyle] = useState(null);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const keyboardUp = vv.height < window.innerHeight - 60;
      setVpStyle({
        height: `${vv.height}px`,
        width: `${vv.width}px`,
        top: `${vv.offsetTop}px`,
        left: `${vv.offsetLeft}px`,
        alignItems: keyboardUp ? 'flex-start' : 'center',
        overflowY: keyboardUp ? 'auto' : 'hidden',
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

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
    <div style={{ ...styles.overlay, ...vpStyle }}>
      <div style={styles.bgDots} />
      <div style={styles.bgVignette} />

      <div style={{
        ...styles.card,
        opacity: visible ? 1 : 0,
        animation: visible ? 'login-card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none',
      }}>
        <div style={styles.accentBar} />

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.brand}>
            <div style={styles.brandIcon}>
              <TerminalIcon size={18} strokeWidth={2} />
            </div>
          </div>

          <div style={styles.tag}>
            <Sparkles size={11} strokeWidth={2} />
            {t('initialSetup') || 'First-time setup'}
          </div>

          <div style={styles.heading}>{t('createAdminAccount') || 'Create your admin account'}</div>
          <div style={styles.sub}>
            {t('initialSetupDescription') || 'This account is the only way in. Pick something you\'ll remember.'}
          </div>

          <div style={styles.divider} />

          <Field
            label={t('username') || 'Username'}
            value={username}
            onChange={setUsername}
            placeholder={t('usernamePlaceholder')}
            hint={t('usernameMinLength')}
            disabled={isLoading}
            autoFocus
            icon={User}
          />
          <Field
            label={t('password') || 'Password'}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={t('passwordPlaceholder')}
            hint={t('passwordMinLength')}
            disabled={isLoading}
            icon={Lock}
          />
          <Field
            label={t('confirmPassword') || 'Confirm password'}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder={t('confirmPasswordPlaceholder')}
            disabled={isLoading}
            icon={KeyRound}
          />

          {error && <div style={styles.error}>{error}</div>}

          <Button variant="primary" size="large" fullWidth type="submit" disabled={isLoading} icon={ChevronRight}>
            {isLoading ? (t('creating') || 'Creating...') : (t('createAccount') || 'Create account')}
          </Button>

          <div style={styles.footer}>
            {t('setupFooter') || 'Restricted access: Authorized personnel only.'}
          </div>
        </form>
      </div>
    </div>
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
    overflow: 'hidden',
    transition: 'height 0.15s, top 0.15s',
  },
  bgDots: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `radial-gradient(circle, ${color.border} 1px, transparent 1px)`,
    backgroundSize: '24px 24px',
    backgroundRepeat: 'repeat',
    opacity: 0.7,
    pointerEvents: 'none',
  },
  bgVignette: {
    position: 'absolute',
    inset: 0,
    background: `radial-gradient(ellipse at center, transparent 40%, ${color.crust} 100%)`,
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    width: 'calc(100% - 40px)',
    maxWidth: '400px',
    background: color.mantle,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    overflow: 'hidden',
    margin: `${space['5']} ${space['5']}`,
  },
  accentBar: {
    height: '1px',
    background: `linear-gradient(90deg, transparent, ${color.accent}66, transparent)`,
  },
  form: {
    padding: `${space['7']} ${space['6']} ${space['6']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['4'],
  },
  brand: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: space['1'],
  },
  brandIcon: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    color: color.muted,
  },
  tag: {
    alignSelf: 'center',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['1'],
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `2px ${space['3']}`,
    fontSize: fontSize['11'],
  },
  heading: {
    fontSize: fontSize['18'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    textAlign: 'center',
    lineHeight: 1.3,
    marginTop: space['1'],
  },
  sub: {
    fontSize: fontSize['13'],
    color: color.muted,
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: 0,
  },
  divider: {
    height: '1px',
    background: color.border,
    margin: `${space['1']} 0`,
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
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    height: '38px',
    padding: `0 ${space['3']}`,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    transition: `border-color ${motion.fast}, box-shadow ${motion.fast}, background ${motion.fast}`,
  },
  input: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: fontSize['13'],
    fontFamily: font.sans,
    color: color.text,
    height: '100%',
    padding: 0,
  },
  error: {
    fontSize: fontSize['12'],
    color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: '1px solid rgba(243, 139, 168, 0.18)',
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
    textAlign: 'center',
  },
  footer: {
    marginTop: space['2'],
    fontSize: fontSize['11'],
    color: color.muted,
    textAlign: 'center',
  },
};

export default InitialSetup;
