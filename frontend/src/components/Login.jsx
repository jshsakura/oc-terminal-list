import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Terminal as TerminalIcon, Lock, User, ArrowLeft, KeyRound, Smartphone, Fingerprint, BookOpen } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { buildThemeUI } from '../styles/themeUI';
import { clearLegacyAuthStorage } from '../utils/auth';
import { isPasskeySupported, loginWithPasskey } from '../utils/webauthn';
import { OTP_CODE_PATTERN, REMEMBER_USERNAME_KEY, readAuthResponse, ensureLoginStyle } from './login/loginHelpers';
import { buildThemed } from './login/buildThemed';
import { ThemedSubmitButton, Field } from './login/LoginFields';

const { color } = tokens;


/* 이북(전자잉크) 모드 스위치가 **로그인 화면에도** 있는 이유: 전자잉크 기기로 처음 오는
   사람이 가장 먼저 보는 화면이 이 화면이다. 설정은 로그인 뒤에만 열리므로, 그때까지는
   애니메이션 카드와 유리 위에서 아이디를 쳐야 한다. 여기 스위치는 저장 버튼이 없으니
   **즉시** 반영된다(설정 모달은 다른 항목과 같이 저장 버튼을 거친다). */
const Login = ({ onLogin, language = 'en', theme = null, einkMode = false, onToggleEink = null }) => {
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
      /* ⚠️ **높이를 줄이지 않는다.** 이 오버레이는 `inset: 0` 이라 레이아웃 뷰포트를
         채우는데, 여기서 `height` 를 주면 `bottom` 이 무시되고(over-constrained) 그
         차이만큼 아무도 안 칠한 띠가 남는다 — body 의 `#0f0f17` 이 드러나는 그 검은
         띠다. 면은 그대로 두고 **내용만** 보이는 영역 안으로 민다. */
      setVpStyle({
        paddingBottom: `calc(var(--vvb, 0px) + ${keyboardUp ? 20 : 0}px)`,
        width: `${vv.width}px`,
        left: `${vv.offsetLeft}px`,
        alignItems: keyboardUp ? 'flex-start' : 'center',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingTop: keyboardUp ? '20px' : '0',
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
      /* 이북 모드에서는 배경을 **평평하게** 둔다. 점 패턴·글로우·비네트는 전부 그라디언트라
         전자잉크에서 디더링 노이즈가 되고, 그 노이즈가 화면 전체 갱신을 한 번 더 부른다. */
      ...(einkMode ? { background: 'var(--ui-crust, #ffffff)' } : {}),
      ...(isMobile && vpStyle ? vpStyle : {}),
    }}>
      {!einkMode && (
        <>
          <div style={{
            ...themed.bgDots,
            backgroundImage: dotBg,
            backgroundSize: dotSizeBg,
          }} />
          <div style={themed.bgGlow} />
          <div style={themed.bgVignette} />
        </>
      )}

      {/* 카드 + 아래의 이북 스위치를 한 세로 묶음으로. overlay 는 row flex 이고, 모바일에서
          키보드가 올라오면 alignItems 를 flex-start 로 바꾸므로 overlay 자체를 column 으로
          돌리면 카드가 왼쪽에 붙는다 — 그래서 묶음을 하나 더 둔다. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 'calc(100% - 40px)',
        maxWidth: '380px',
        flexShrink: 0,
      }}>
      <div style={{
        ...themed.card,
        width: '100%',
        /* 그림자가 사라진 자리를 테두리가 받는다 — 안 그러면 카드가 바탕에 녹아
           어디부터가 입력칸인지 안 보인다. buildThemed 의 테두리는 라이트 테마에서
           거의 투명이라 여기서 명시한다. */
        ...(einkMode ? { border: '1px solid var(--ui-border-strong, #000000)' } : {}),
        opacity: visible ? 1 : 0,
        animation: (visible && !einkMode) ? 'login-card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none',
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

      {onToggleEink && (
        /* 카드의 보조 버튼(패스키)과 **같은 치수**를 쓴다. linkBtn(12px·좁은 패딩)으로
           두었더니 테두리가 붙는 순간 글자가 낀 태그처럼 보였다 — 로그인 화면에서 이건
           링크가 아니라 화면 종류를 고르는 **컨트롤**이다. */
        <button
          type="button"
          onClick={onToggleEink}
          aria-pressed={einkMode}
          style={{
            ...themed.passkeyBtn,
            marginTop: '10px',
            borderColor: einkMode ? themed.accent : themed.border,
            color: einkMode ? themed.text : themed.subtext,
            background: einkMode ? themed.accentSubtle : 'transparent',
          }}
        >
          <BookOpen size={15} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span>{t('einkMode') || 'E-ink mode'}</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              opacity: einkMode ? 1 : 0.65,
            }}
          >
            {einkMode ? (t('on') || 'ON') : (t('off') || 'OFF')}
          </span>
        </button>
      )}
      </div>
    </div>
  );
};




export default Login;
