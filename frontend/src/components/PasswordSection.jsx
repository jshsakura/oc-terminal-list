import { useState } from 'react';
import { KeyRound, Check } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import { authHeaders } from '../utils/auth';

const { color, fontSize, fontWeight, radius, space } = tokens;

const MIN_PASSWORD_LENGTH = 8;

const authedFetch = async (url, opts = {}) => {
  const headers = authHeaders({ 'Content-Type': 'application/json', ...(opts.headers || {}) });
  const res = await fetch(url, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const msg = data?.detail || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
};

const PasswordSection = ({ onLogout, t }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    next !== current &&
    !submitting;

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await authedFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
      // 서버가 세션 쿠키를 무효화했으므로 재로그인 유도
      setTimeout(() => { onLogout?.(); }, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <Check size={16} strokeWidth={1.8} color={color.success || color.accent} />
          <span style={styles.title}>
            {t('passwordChanged') || 'Password changed'}
          </span>
        </div>
        <div style={styles.help}>
          {t('passwordChangedHint') || 'Signing you out — please log in again with your new password.'}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <KeyRound size={16} strokeWidth={1.8} color={color.muted} />
        <span style={styles.title}>{t('changePassword') || 'Change password'}</span>
      </div>
      <div style={styles.help}>
        {t('changePasswordHint') || 'After changing your password you\'ll be signed out and need to log in again.'}
      </div>

      <input
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder={t('currentPassword') || 'Current password'}
        style={styles.input}
      />
      <input
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={t('newPassword') || 'New password'}
        style={styles.input}
      />
      <input
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t('confirmNewPassword') || 'Confirm new password'}
        style={styles.input}
      />

      {tooShort && (
        <div style={styles.hint}>
          {t('passwordTooShort') || 'Password must be at least 8 characters.'}
        </div>
      )}
      {mismatch && (
        <div style={styles.hint}>
          {t('passwordMismatch') || 'Passwords do not match.'}
        </div>
      )}
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.row}>
        <Button variant="primary" onClick={submit} disabled={!canSubmit}>
          {submitting ? '…' : (t('changePassword') || 'Change password')}
        </Button>
      </div>
    </div>
  );
};

const styles = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    padding: space['3'],
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
  },
  title: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.medium,
    color: color.text,
  },
  help: {
    fontSize: fontSize['12'],
    color: color.muted,
    lineHeight: 1.45,
  },
  input: {
    height: '34px',
    padding: `0 ${space['3']}`,
    fontSize: fontSize['13'],
    color: color.text,
    background: color.mantle,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    outline: 'none',
  },
  hint: {
    fontSize: fontSize['12'],
    color: color.subtext,
  },
  error: {
    fontSize: fontSize['12'],
    color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: '1px solid rgba(243, 139, 168, 0.18)',
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
  },
  row: {
    display: 'flex',
    gap: space['2'],
    justifyContent: 'flex-end',
    marginTop: space['1'],
    flexWrap: 'wrap',
  },
};

export default PasswordSection;
