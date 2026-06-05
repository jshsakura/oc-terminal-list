import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Terminal as TerminalIcon, Lock, User, ArrowLeft, KeyRound, Smartphone, Fingerprint } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { buildThemeUI } from '../styles/themeUI';
import { clearLegacyAuthStorage } from '../utils/auth';
import { isPasskeySupported, loginWithPasskey } from '../utils/webauthn';
import { OTP_CODE_PATTERN, REMEMBER_USERNAME_KEY, readAuthResponse, ensureLoginStyle } from './login/loginHelpers';
import { buildThemed } from './login/buildThemed';
import { ThemedSubmitButton, Field } from './login/LoginFields';

const { color } = tokens;


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




export default Login;
