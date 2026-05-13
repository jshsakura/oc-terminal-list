import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Terminal as TerminalIcon, ShieldCheck, Lock, User, ChevronRight, ClipboardPaste, Check } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import { buildThemeUI } from '../styles/themeUI';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

const OTP_CODE_PATTERN = /^\d{6}$/;

const readAuthResponse = async (response, fallbackMessage) => {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.detail || fallbackMessage);
  return data;
};

const themeValue = (ui, key, fallback) => ui?.[key] || fallback;
const alpha = (value, suffix, fallback) => (/^#[0-9a-f]{6}$/i.test(value || '') ? `${value}${suffix}` : fallback);

const ANIMATION_CSS = `@keyframes login-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes login-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}
@keyframes login-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.login-scroll::-webkit-scrollbar { display: none; }
.login-scroll { -ms-overflow-style: none; scrollbar-width: none; }`;

let loginStyleInjected = false;
const ensureLoginStyle = () => {
  if (typeof document === 'undefined' || loginStyleInjected) return;
  if (!document.getElementById('login-anim-style')) {
    const el = document.createElement('style');
    el.id = 'login-anim-style';
    el.textContent = ANIMATION_CSS;
    document.head.appendChild(el);
    loginStyleInjected = true;
  }
};

const Login = ({ onLogin, language = 'en', theme = null }) => {
  const { t } = useTranslation(language);
  const themeUi = useMemo(() => (theme ? buildThemeUI(theme) : {}), [theme]);
  const themed = useMemo(() => buildThemed(themeUi), [themeUi]);
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [vpStyle, setVpStyle] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { ensureLoginStyle(); requestAnimationFrame(() => setVisible(true)); }, []);

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
        overflowY: 'auto',
        paddingTop: keyboardUp ? '16px' : '0',
        paddingBottom: keyboardUp ? '16px' : '0',
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

  const showError = (msg) => { setError(msg); setErrorKey((k) => k + 1); };

  const finishLogin = (data) => {
    localStorage.setItem('auth_token', data.access_token);
    localStorage.setItem('username', data.username);
    onLogin(data.access_token, data.username);
  };

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username || !password) {
      showError(t('fillAllFields'));
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await readAuthResponse(response, 'Login failed');
      if (data.otp_required) {
        setPendingToken(data.pending_token);
        setStep('otp');
        setPassword('');
        setOtpCode('');
        setUseBackupCode(false);
      } else {
        finishLogin(data);
      }
    } catch (err) {
      showError(err.message);
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
      showError(t('otpEnterCode') || 'Enter the code from your authenticator app');
      return;
    }
    if (!useBackupCode && !OTP_CODE_PATTERN.test(trimmed)) {
      showError(t('otpEnterSixDigitCode') || 'Enter the 6-digit code from your authenticator app');
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
      const data = await readAuthResponse(response, 'OTP verification failed');
      finishLogin(data);
    } catch (err) {
      showError(err.message);
      setOtpCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const goBack = () => {
    setStep('credentials');
    setPendingToken('');
    setOtpCode('');
    setPassword('');
    setError('');
  };

  const canSubmitOtp = useBackupCode ? Boolean(otpCode.trim()) : OTP_CODE_PATTERN.test(otpCode.trim());

  const dotSize = '1px';
  const dotGap = '24px';
  const dotBg = `radial-gradient(circle, ${themed.dot} ${dotSize}, transparent ${dotSize})`;
  const dotSizeBg = `${dotGap} ${dotGap}`;

  return (
    <div ref={scrollRef} className="login-scroll" style={{ ...themed.overlay, ...vpStyle }}>
      <div style={{
        ...themed.bgDots,
        backgroundImage: dotBg,
        backgroundSize: dotSizeBg,
      }} />
      <div style={themed.bgVignette} />

      <div style={{
        ...themed.card,
        opacity: visible ? 1 : 0,
        animation: visible ? 'login-card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none',
      }}>
        <div style={themed.accentBar} />

        {step === 'credentials' ? (
          <form onSubmit={handleCredentialsSubmit} style={themed.form}>
            <div style={themed.brand}>
              <div style={themed.brandIcon}>
                <TerminalIcon size={18} strokeWidth={2} />
              </div>
            </div>
            <div style={themed.heading}>{t('login') || 'Sign in'}</div>
            <div style={themed.sub}>{t('loginDescription') || 'Access your terminal sessions'}</div>

            <div style={themed.divider} />

            <Field
              label={t('username') || 'Username'}
              value={username}
              onChange={setUsername}
              placeholder={t('usernamePlaceholder')}
              disabled={isLoading}
              autoFocus
              themed={themed}
              icon={User}
            />
            <Field
              label={t('password') || 'Password'}
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={t('passwordPlaceholder')}
              disabled={isLoading}
              themed={themed}
              icon={Lock}
            />

            {error && <div key={errorKey} style={{ ...themed.error, animation: 'login-shake 0.35s ease' }}>{error}</div>}

            <Button
              variant="primary"
              size="large"
              fullWidth
              type="submit"
              disabled={isLoading}
              icon={ChevronRight}
            >
              {isLoading ? (t('signingIn') || 'Signing in...') : (t('signIn') || 'Sign in')}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} style={themed.form}>
            <div style={themed.brand}>
              <div style={themed.brandIcon}>
                <ShieldCheck size={18} strokeWidth={2} />
              </div>
            </div>
            <div style={themed.heading}>
              {useBackupCode
                ? (t('otpBackupCodeTitle') || 'Use a backup code')
                : (t('otpStepTitle') || 'Two-factor authentication')}
            </div>
            <div style={themed.sub}>
              {useBackupCode
                ? (t('otpBackupCodeHint') || 'Enter one of the backup codes you saved.')
                : (t('otpStepHint') || 'Enter the 6-digit code from your authenticator app.')}
            </div>

            <div style={themed.divider} />

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
              themed={themed}
              pasteAction
            />

            {error && <div key={errorKey} style={{ ...themed.error, animation: 'login-shake 0.35s ease' }}>{error}</div>}

            <Button
              variant="primary"
              size="large"
              fullWidth
              type="submit"
              disabled={isLoading || !canSubmitOtp}
              icon={ChevronRight}
            >
              {isLoading ? (t('verifying') || 'Verifying...') : (t('signIn') || 'Sign in')}
            </Button>

            <div style={themed.linkRow}>
              <button type="button" onClick={goBack} style={themed.linkBtn} disabled={isLoading}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.accentSubtle; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {t('back') || 'Back'}
              </button>
              <button
                type="button"
                onClick={() => { setUseBackupCode((b) => !b); setOtpCode(''); setError(''); }}
                style={themed.linkBtn}
                disabled={isLoading}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.accentSubtle; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {useBackupCode
                  ? (t('otpUseAuthApp') || 'Use authenticator app')
                  : (t('otpUseBackupCode') || 'Use a backup code')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', placeholder, disabled, autoFocus, inputMode, mono, autoComplete, themed, icon: Icon, pasteAction }) => {
  const [focused, setFocused] = useState(false);
  const [pasteOk, setPasteOk] = useState(false);
  const handlePasteClick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text);
        setPasteOk(true);
        setTimeout(() => setPasteOk(false), 1200);
      }
    } catch { /* clipboard denied */ }
  };
  return (
    <label style={themed.field}>
      <span style={themed.label}>{label}</span>
      <div style={{
        ...themed.inputWrap,
        borderColor: focused ? themed._inputFocusBorder : themed._inputBorder,
        boxShadow: focused ? themed._inputFocusShadow : 'none',
        background: focused ? themed._inputFocusBg : themed._inputBg,
      }}>
        {Icon && <Icon size={14} strokeWidth={2} style={{ color: focused ? themed._inputFocusBorder : themed._iconMuted, flexShrink: 0 }} />}
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
            ...themed.input,
            fontFamily: mono ? font.mono : font.sans,
            letterSpacing: mono ? '0.25em' : 'normal',
            textAlign: mono ? 'center' : 'left',
          }}
        />
        {pasteAction && (
          <button
            type="button"
            onClick={handlePasteClick}
            disabled={disabled}
            aria-label="Paste from clipboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              border: 'none',
              background: pasteOk ? themed._inputFocusBorder : 'transparent',
              borderRadius: radius.xs,
              color: pasteOk ? themed.crust : themed._iconMuted,
              cursor: 'pointer',
              flexShrink: 0,
              transition: `background ${motion.fast}, color ${motion.fast}`,
            }}
          >
            {pasteOk ? <Check size={13} strokeWidth={2.5} /> : <ClipboardPaste size={13} strokeWidth={2} />}
          </button>
        )}
      </div>
    </label>
  );
};

const buildThemed = (ui) => {
  const t = {
    crust: themeValue(ui, 'crust', color.crust),
    mantle: themeValue(ui, 'mantle', color.mantle),
    base: themeValue(ui, 'base', color.base),
    surface0: themeValue(ui, 'surface0', color.surface0),
    surface1: themeValue(ui, 'surface1', color.surface1),
    surface2: themeValue(ui, 'surface2', color.surface2),
    text: themeValue(ui, 'text', color.text),
    subtext: themeValue(ui, 'subtext', color.subtext),
    muted: themeValue(ui, 'muted', color.muted),
    accent: themeValue(ui, 'accent', color.accent),
    accentSubtle: themeValue(ui, 'accent-subtle', color.accentSubtle),
    accentBorder: themeValue(ui, 'accent-border', color.accentBorder),
    danger: themeValue(ui, 'danger', color.danger),
    border: themeValue(ui, 'border', color.border),
    borderStrong: themeValue(ui, 'border-strong', color.borderStrong),
    scrim: themeValue(ui, 'scrim', color.scrim),
  };

  return {
    ...t,
    dot: alpha(t.border, 'cc', 'rgba(255,255,255,0.06)'),

    overlay: {
      position: 'fixed',
      inset: 0,
      background: t.crust,
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
      backgroundRepeat: 'repeat',
      opacity: 0.7,
      pointerEvents: 'none',
    },

    bgVignette: {
      position: 'absolute',
      inset: 0,
      background: `radial-gradient(ellipse at center, transparent 40%, ${t.crust} 100%)`,
      pointerEvents: 'none',
    },

    card: {
      position: 'relative',
      width: 'calc(100% - 40px)',
      maxWidth: '380px',
      background: t.mantle,
      border: `1px solid ${t.border}`,
      borderRadius: radius.lg,
      boxShadow: shadow.lg,
      overflow: 'hidden',
      margin: `${space['5']} ${space['5']}`,
    },

    accentBar: {
      height: '1px',
      background: `linear-gradient(90deg, transparent, ${t.accent}66, transparent)`,
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
      background: t.surface0,
      border: `1px solid ${t.border}`,
      borderRadius: radius.md,
      color: t.muted,
    },

    heading: {
      fontSize: fontSize['18'],
      fontWeight: fontWeight.semibold,
      color: t.text,
      textAlign: 'center',
      lineHeight: 1.3,
    },

    sub: {
      fontSize: fontSize['13'],
      color: t.muted,
      textAlign: 'center',
      lineHeight: 1.5,
      margin: 0,
    },

    divider: {
      height: '1px',
      background: t.border,
      margin: `${space['1']} 0`,
    },

    field: {
      display: 'flex',
      flexDirection: 'column',
      gap: space['1.5'],
    },
    label: {
      fontSize: fontSize['12'],
      fontWeight: fontWeight.medium,
      color: t.subtext,
    },
    inputWrap: {
      display: 'flex',
      alignItems: 'center',
      gap: space['2'],
      height: '38px',
      padding: `0 ${space['3']}`,
      border: `1px solid ${t.border}`,
      borderRadius: radius.sm,
      transition: `border-color ${motion.fast}, box-shadow ${motion.fast}, background ${motion.fast}`,
    },
    input: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: fontSize['13'],
      color: t.text,
      height: '100%',
      padding: 0,
    },

    error: {
      fontSize: fontSize['12'],
      color: t.danger,
      background: alpha(t.danger, '14', 'rgba(243, 139, 168, 0.08)'),
      border: `1px solid ${alpha(t.danger, '2e', 'rgba(243, 139, 168, 0.18)')}`,
      borderRadius: radius.sm,
      padding: `${space['2']} ${space['3']}`,
      textAlign: 'center',
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
      color: t.accent,
      fontSize: fontSize['12'],
      cursor: 'pointer',
      padding: `${space['1']} ${space['2']}`,
      fontFamily: 'inherit',
      borderRadius: radius.xs,
      transition: `background ${motion.fast}, color ${motion.fast}`,
    },

    _inputBg: t.surface0,
    _inputFocusBg: t.crust,
    _inputBorder: t.border,
    _inputFocusBorder: t.accentBorder,
    _inputFocusShadow: `0 0 0 2px ${alpha(t.accent, '18', 'rgba(137, 180, 250, 0.10)')}`,
    _iconMuted: t.muted,
  };
};

export default Login;
