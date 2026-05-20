import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Terminal as TerminalIcon, Lock, User, ClipboardPaste, Check, ArrowLeft, KeyRound, Smartphone, Eye, EyeOff, Fingerprint } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { buildThemeUI } from '../styles/themeUI';
import { clearLegacyAuthStorage } from '../utils/auth';
import { isPasskeySupported, loginWithPasskey } from '../utils/webauthn';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

const OTP_CODE_PATTERN = /^\d{6}$/;
const REMEMBER_USERNAME_KEY = 'iterm:login:remember-username';

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
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(REMEMBER_USERNAME_KEY) || ''; } catch { return ''; }
  });
  const [rememberUsername, setRememberUsername] = useState(() => {
    try { return Boolean(localStorage.getItem(REMEMBER_USERNAME_KEY)); } catch { return false; }
  });
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
  const otpSubmittingRef = useRef(false);

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
        WebkitOverflowScrolling: 'touch',
        paddingTop: keyboardUp ? '20px' : '0',
        paddingBottom: keyboardUp ? '20px' : '0',
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

  const finishLogin = useCallback((data) => {
    try {
      if (rememberUsername) localStorage.setItem(REMEMBER_USERNAME_KEY, username);
      else localStorage.removeItem(REMEMBER_USERNAME_KEY);
    } catch { /* storage unavailable */ }
    clearLegacyAuthStorage();
    onLogin(data.username, data.access_token);
  }, [onLogin, rememberUsername, username]);

  // 패스키 버튼 노출 조건: 브라우저 지원 + 서버에 등록된 자격증명 ≥ 1.
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  useEffect(() => {
    if (!isPasskeySupported()) return;
    fetch('/api/auth/status')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.passkey_available) setPasskeyAvailable(true); })
      .catch(() => { /* 네트워크 실패는 무시 — 비번 폼은 그대로 동작 */ });
  }, []);

  const handlePasskeyLogin = useCallback(async () => {
    setError('');
    setIsLoading(true);
    try {
      const data = await loginWithPasskey();
      finishLogin(data);
    } catch (err) {
      // user cancel(NotAllowedError) 은 조용히 무시. 그 외 메시지 표시.
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        // no-op
      } else {
        showError(err.message || '패스키 로그인에 실패했습니다');
      }
    } finally {
      setIsLoading(false);
    }
  }, [finishLogin]);

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

  const verifyOtp = useCallback(async () => {
    if (otpSubmittingRef.current) return;
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
    otpSubmittingRef.current = true;
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
      otpSubmittingRef.current = false;
      setIsLoading(false);
    }
  }, [finishLogin, otpCode, pendingToken, t, useBackupCode]);

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    await verifyOtp();
  };

  useEffect(() => {
    if (step !== 'otp' || useBackupCode || isLoading || !pendingToken) return;
    if (OTP_CODE_PATTERN.test(otpCode.trim())) verifyOtp();
  }, [isLoading, otpCode, pendingToken, step, useBackupCode, verifyOtp]);

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

  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 768);

  return (
    <div ref={scrollRef} className="login-scroll" style={{
      ...themed.overlay,
      ...(isMobile && vpStyle ? vpStyle : {}),
    }}>
      <div style={{
        ...themed.bgDots,
        backgroundImage: dotBg,
        backgroundSize: dotSizeBg,
      }} />
      <div style={themed.bgGlow} />
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
                <TerminalIcon size={17} strokeWidth={2} />
              </div>
            </div>
            <div style={themed.heading}>{t('appName') || 'Terminal List'}</div>
            <div style={themed.sub}>{t('loginDescription') || 'Secure workspace access'}</div>

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
              revealable
              revealLabel={t('showSecret') || 'Show'}
              concealLabel={t('hideSecret') || 'Hide'}
            />

            <div style={themed.checkRow}>
              <input
                type="checkbox"
                checked={rememberUsername}
                onChange={(e) => setRememberUsername(e.target.checked)}
                disabled={isLoading}
                aria-label={t('rememberUsernameToggle') || 'Remember username'}
                style={themed.checkbox}
              />
              <button
                type="button"
                onClick={() => setRememberUsername((v) => !v)}
                disabled={isLoading}
                style={themed.checkTextBtn}
              >
                {t('rememberUsername') || 'Remember ID'}
              </button>
            </div>

            {error && <div key={errorKey} style={{ ...themed.error, animation: 'login-shake 0.35s ease' }}>{error}</div>}

            <ThemedSubmitButton
              type="submit"
              disabled={isLoading}
              themed={themed}
            >
              {isLoading ? (t('signingIn') || 'Signing in...') : (t('signIn') || 'Sign in')}
            </ThemedSubmitButton>

            {passkeyAvailable && (
              <>
                <div style={themed.orDivider}>
                  <span style={themed.orLine} />
                  <span style={themed.orText}>{t('or') || 'or'}</span>
                  <span style={themed.orLine} />
                </div>
                <button
                  type="button"
                  onClick={handlePasskeyLogin}
                  disabled={isLoading}
                  style={themed.passkeyBtn}
                  onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.background = themed.accentSubtle; e.currentTarget.style.borderColor = themed.accent; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = themed.border; }}
                >
                  <Fingerprint size={15} strokeWidth={2} style={{ flexShrink: 0 }} />
                  {t('signInWithPasskey') || 'Sign in with passkey'}
                </button>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} style={themed.form}>
            <div style={themed.brand}>
              <div style={themed.brandIcon}>
                <KeyRound size={17} strokeWidth={2} />
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
              placeholder={useBackupCode ? 'XXXXXXXX' : '••••••'}
              disabled={isLoading}
              autoFocus
              inputMode={useBackupCode ? 'text' : 'numeric'}
              mono
              autoComplete="one-time-code"
              themed={themed}
              pasteAction
            />

            {error && <div key={errorKey} style={{ ...themed.error, animation: 'login-shake 0.35s ease' }}>{error}</div>}

            <ThemedSubmitButton
              type="submit"
              disabled={isLoading || !canSubmitOtp}
              themed={themed}
            >
              {isLoading ? (t('verifying') || 'Verifying...') : (t('signIn') || 'Sign in')}
            </ThemedSubmitButton>

            <div style={themed.linkRow}>
              <button type="button" onClick={goBack} style={themed.linkBtn} disabled={isLoading}
                onMouseEnter={(e) => { e.currentTarget.style.background = themed.accentSubtle; e.currentTarget.style.color = themed.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = themed.subtext; }}
              >
                <ArrowLeft size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
                {t('back') || 'Back'}
              </button>
              <button
                type="button"
                onClick={() => { setUseBackupCode((b) => !b); setOtpCode(''); setError(''); }}
                style={themed.linkBtn}
                disabled={isLoading}
                onMouseEnter={(e) => { e.currentTarget.style.background = themed.accentSubtle; e.currentTarget.style.color = themed.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = themed.subtext; }}
              >
                {useBackupCode
                  ? <><Smartphone size={12} strokeWidth={2} style={{ flexShrink: 0 }} />{t('otpUseAuthApp') || 'Use authenticator app'}</>
                  : <><KeyRound size={12} strokeWidth={2} style={{ flexShrink: 0 }} />{t('otpUseBackupCode') || 'Use a backup code'}</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const ThemedSubmitButton = ({ children, disabled, themed, type = 'button' }) => (
  <button
    type={type}
    disabled={disabled}
    style={{
      ...themed.submitBtn,
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = themed._submitHoverBg;
      e.currentTarget.style.borderColor = themed._submitHoverBorder;
      e.currentTarget.style.boxShadow = themed._submitHoverShadow;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = themed.submitBtn.background;
      e.currentTarget.style.borderColor = themed.submitBtn.borderColor;
      e.currentTarget.style.boxShadow = themed.submitBtn.boxShadow;
    }}
  >
    {children}
  </button>
);

const Field = ({ label, value, onChange, type = 'text', placeholder, disabled, autoFocus, inputMode, mono, autoComplete, themed, icon: Icon, pasteAction, revealable = false, revealLabel = 'Show password', concealLabel = 'Hide password' }) => {
  const [focused, setFocused] = useState(false);
  const [pasteOk, setPasteOk] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const isSecret = type === 'password' && revealable;
  const SecretIcon = secretVisible ? EyeOff : Eye;
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
          type={isSecret && secretVisible ? 'text' : type}
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
        {isSecret && (
          <button
            type="button"
            onClick={() => setSecretVisible((v) => !v)}
            disabled={disabled}
            aria-label={secretVisible ? concealLabel : revealLabel}
            title={secretVisible ? concealLabel : revealLabel}
            style={themed.iconBtn}
          >
            <SecretIcon size={14} strokeWidth={2} />
          </button>
        )}
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
      background: `linear-gradient(135deg, ${t.crust} 0%, ${t.mantle} 48%, ${t.crust} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      fontFamily: font.sans,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    },

    bgDots: {
      position: 'absolute',
      inset: 0,
      backgroundRepeat: 'repeat',
      opacity: 0.42,
      pointerEvents: 'none',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)',
    },

    bgGlow: {
      position: 'absolute',
      inset: 0,
      background: [
        `radial-gradient(circle at 18% 18%, ${alpha(t.accent, '24', 'rgba(137, 180, 250, 0.14)')} 0, transparent 28%)`,
        `radial-gradient(circle at 78% 12%, ${alpha(t.borderStrong, '22', 'rgba(255,255,255,0.10)')} 0, transparent 24%)`,
        `radial-gradient(circle at 62% 88%, ${alpha(t.accent, '16', 'rgba(137, 180, 250, 0.08)')} 0, transparent 30%)`,
      ].join(', '),
      opacity: 0.95,
      pointerEvents: 'none',
    },

    bgVignette: {
      position: 'absolute',
      inset: 0,
      background: `radial-gradient(ellipse at center, transparent 34%, ${alpha(t.crust, '66', 'rgba(17,17,27,0.40)')} 68%, ${t.crust} 100%), linear-gradient(180deg, transparent 0%, ${alpha(t.crust, '88', 'rgba(17,17,27,0.52)')} 100%)`,
      pointerEvents: 'none',
    },

    card: {
      position: 'relative',
      width: 'calc(100% - 40px)',
      maxWidth: '380px',
      background: alpha(t.mantle, 'ee', 'rgba(24,24,37,0.93)'),
      border: `1px solid ${alpha(t.border, '18', 'rgba(255,255,255,0.035)')}`,
      borderRadius: radius.xl,
      boxShadow: '0 28px 90px rgba(0, 0, 0, 0.28)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      overflow: 'hidden',
      margin: `${space['5']} 0`,
      flexShrink: 0,
    },

    accentBar: {
      height: '1px',
      background: `linear-gradient(90deg, transparent, ${alpha(t.border, '18', 'rgba(255,255,255,0.035)')}, transparent)`,
    },

    form: {
      padding: '32px 28px 28px',
      display: 'flex',
      flexDirection: 'column',
      gap: space['5'],
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
      background: alpha(t.surface0, '8c', 'rgba(49,50,68,0.55)'),
      border: `1px solid ${alpha(t.border, '18', 'rgba(255,255,255,0.035)')}`,
      borderRadius: radius.md,
      color: t.subtext,
    },

    heading: {
      fontSize: fontSize['18'],
      fontFamily: font.brand,
      fontWeight: 400,
      color: t.text,
      textAlign: 'center',
      lineHeight: 1.3,
      letterSpacing: 0,
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
    iconBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      border: 'none',
      background: 'transparent',
      borderRadius: radius.xs,
      color: t.muted,
      cursor: 'pointer',
      flexShrink: 0,
      padding: 0,
      transition: `background ${motion.fast}, color ${motion.fast}`,
    },
    checkRow: {
      display: 'inline-flex',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: space['2'],
      color: t.subtext,
      fontSize: fontSize['12'],
      cursor: 'pointer',
      marginTop: `-${space['2']}`,
      userSelect: 'none',
    },
    checkTextBtn: {
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
    },
    checkbox: {
      width: '14px',
      height: '14px',
      accentColor: t.accent,
      cursor: 'pointer',
      flexShrink: 0,
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
    submitBtn: {
      width: '100%',
      height: '38px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      border: `1px solid ${alpha(t.accent, '88', 'rgba(137, 180, 250, 0.54)')}`,
      background: t.accent,
      color: t.crust,
      fontFamily: 'inherit',
      fontSize: fontSize['13'],
      fontWeight: fontWeight.semibold,
      letterSpacing: 'normal',
      userSelect: 'none',
      outline: 'none',
      boxShadow: `0 10px 26px ${alpha(t.accent, '2e', 'rgba(137, 180, 250, 0.18)')}`,
      transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}, opacity ${motion.fast}, box-shadow ${motion.fast}`,
    },

    linkRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: space['2'],
      marginTop: space['1'],
    },
    linkBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: space['1.5'],
      background: 'transparent',
      border: 'none',
      color: t.subtext,
      fontSize: fontSize['12'],
      cursor: 'pointer',
      padding: `${space['1.5']} ${space['2.5']}`,
      fontFamily: 'inherit',
      borderRadius: radius.sm,
      transition: `background ${motion.fast}, color ${motion.fast}, opacity ${motion.fast}`,
    },
    orDivider: {
      display: 'flex',
      alignItems: 'center',
      gap: space['2'],
      marginTop: space['3'],
      marginBottom: space['2'],
    },
    orLine: {
      flex: 1,
      height: '1px',
      background: t.border,
      opacity: 0.6,
    },
    orText: {
      fontSize: fontSize['11'],
      color: t.muted,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: fontWeight.medium,
    },
    passkeyBtn: {
      width: '100%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space['2'],
      padding: `${space['2.5']} ${space['4']}`,
      background: 'transparent',
      color: t.text,
      border: `1px solid ${t.border}`,
      borderRadius: radius.sm,
      fontSize: fontSize['13'],
      fontWeight: fontWeight.medium,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
    },

    _inputBg: t.surface0,
    _inputFocusBg: t.crust,
    _inputBorder: t.border,
    _inputFocusBorder: t.accentBorder,
    _inputFocusShadow: `0 0 0 1px ${alpha(t.accentBorder, '88', 'rgba(137, 180, 250, 0.54)')}`,
    _iconMuted: t.muted,
    _submitHoverBg: t.accent,
    _submitHoverBorder: t.accent,
    _submitHoverShadow: `0 12px 30px ${alpha(t.accent, '45', 'rgba(137, 180, 250, 0.27)')}`,
  };
};

export default Login;
