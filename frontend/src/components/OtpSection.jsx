import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldAlert, Copy, Check, RefreshCw } from 'lucide-react';
import Button from './common/Button';
import SkeletonRow from './common/SkeletonRow';
import { tokens } from '../styles/tokens';
import { authHeaders } from '../utils/auth';
import { copyToClipboard } from '../utils/clipboard';

const { color, fontSize, fontWeight, radius, space, font } = tokens;

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

const OtpSection = ({ t }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // setup flow state
  const [setupData, setSetupData] = useState(null); // { secret, provisioning_uri, ... }
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // backup codes (one-time display after enable / regenerate)
  const [backupCodes, setBackupCodes] = useState(null);

  // disable flow state
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const refreshStatus = async () => {
    try {
      const s = await authedFetch('/api/auth/otp/status');
      setStatus(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshStatus(); }, []);

  const startSetup = async () => {
    setError('');
    setSubmitting(true);
    try {
      const data = await authedFetch('/api/auth/otp/setup', { method: 'POST' });
      setSetupData(data);
      setCode('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelSetup = () => {
    setSetupData(null);
    setCode('');
    setError('');
    refreshStatus();
  };

  const confirmEnable = async () => {
    setError('');
    setSubmitting(true);
    try {
      const data = await authedFetch('/api/auth/otp/enable', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      setBackupCodes(data.backup_codes);
      setSetupData(null);
      setCode('');
      await refreshStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startDisable = () => {
    setDisabling(true);
    setDisablePassword('');
    setError('');
  };

  const cancelDisable = () => {
    setDisabling(false);
    setDisablePassword('');
  };

  const confirmDisable = async () => {
    setError('');
    setSubmitting(true);
    try {
      await authedFetch('/api/auth/otp/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword }),
      });
      setDisabling(false);
      setDisablePassword('');
      setBackupCodes(null);
      await refreshStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const regenerateBackup = async () => {
    setError('');
    setSubmitting(true);
    try {
      const data = await authedFetch('/api/auth/otp/backup-codes/regenerate', { method: 'POST' });
      setBackupCodes(data.backup_codes);
      await refreshStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space['2'], padding: space['3'] }}>
      <SkeletonRow width="40%" height="14px" />
      <SkeletonRow width="100%" height="160px" borderRadius={radius.md} />
      <SkeletonRow width="60%" height="12px" />
    </div>
  );

  // Backup codes one-time display takes priority over everything else
  if (backupCodes) {
    return <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes(null)} t={t} />;
  }

  // Setup wizard (chose to enable, awaiting verification)
  if (setupData) {
    return (
      <SetupPanel
        data={setupData}
        code={code}
        setCode={setCode}
        onCancel={cancelSetup}
        onConfirm={confirmEnable}
        submitting={submitting}
        error={error}
        t={t}
      />
    );
  }

  // Disable confirmation (asks password)
  if (disabling) {
    return (
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <ShieldAlert size={16} strokeWidth={1.8} color={color.danger} />
          <span style={styles.title}>{t('otpDisableTitle') || 'Disable two-factor authentication'}</span>
        </div>
        <div style={styles.help}>
          {t('otpDisableHint') || 'Enter your password to confirm. This will delete the secret and all backup codes.'}
        </div>
        <input
          type="password"
          value={disablePassword}
          onChange={(e) => setDisablePassword(e.target.value)}
          placeholder={t('password') || 'Password'}
          style={styles.input}
          autoFocus
        />
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.row}>
          <Button variant="secondary" onClick={cancelDisable} disabled={submitting}>
            {t('cancel') || 'Cancel'}
          </Button>
          <Button
            variant="danger"
            onClick={confirmDisable}
            disabled={submitting || !disablePassword}
          >
            {submitting ? '…' : (t('otpDisable') || 'Disable 2FA')}
          </Button>
        </div>
      </div>
    );
  }

  const enabled = status?.enabled;
  const remaining = status?.backup_codes_remaining ?? 0;

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        {enabled
          ? <ShieldCheck size={16} strokeWidth={1.8} color={color.success || color.accent} />
          : <ShieldAlert size={16} strokeWidth={1.8} color={color.muted} />}
        <span style={styles.title}>
          {enabled
            ? (t('otpEnabled') || 'Two-factor authentication is on')
            : (t('otpDisabled') || 'Two-factor authentication is off')}
        </span>
      </div>
      <div style={styles.help}>
        {enabled
          ? (t('otpEnabledHint') || 'You\'ll be asked for a 6-digit code from your authenticator app after sign-in.')
          : (t('otpDisabledHint') || 'Add an extra step at sign-in using Google Authenticator, Microsoft Authenticator, 1Password, or any TOTP app.')}
      </div>

      {enabled && (
        <div style={styles.metaRow}>
          <span style={styles.metaLabel}>{t('otpBackupCodesLeft') || 'Backup codes remaining'}</span>
          <span style={{ ...styles.metaValue, color: remaining <= 2 ? color.danger : color.text }}>
            {remaining} / 10
          </span>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.row}>
        {!enabled && (
          <Button variant="primary" onClick={startSetup} disabled={submitting}>
            {submitting ? '…' : (t('otpEnable') || 'Enable 2FA')}
          </Button>
        )}
        {enabled && (
          <>
            <Button variant="secondary" onClick={regenerateBackup} disabled={submitting} icon={RefreshCw}>
              {t('otpRegenerateBackup') || 'New backup codes'}
            </Button>
            <Button variant="danger" onClick={startDisable} disabled={submitting}>
              {t('otpDisable') || 'Disable 2FA'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

const SetupPanel = ({ data, code, setCode, onCancel, onConfirm, submitting, error, t }) => {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    if (!await copyToClipboard(text)) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const codeReady = /^\d{6}$/.test(code.trim());
  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <ShieldCheck size={16} strokeWidth={1.8} color={color.accent} />
        <span style={styles.title}>{t('otpSetupTitle') || 'Set up two-factor authentication'}</span>
      </div>
      <div style={styles.help}>
        {t('otpSetupStep1') || '1. Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, or any TOTP app.'}
      </div>

      <div style={styles.qrWrap}>
        <QRCodeSVG
          value={data.provisioning_uri}
          size={168}
          level="M"
          marginSize={2}
        />
      </div>

      <div style={styles.help}>
        {t('otpSetupManual') || 'Can\'t scan? Enter this secret manually:'}
      </div>
      <div style={styles.secretRow}>
        <code style={styles.secret}>{data.secret}</code>
        <button type="button" onClick={() => copy(data.secret)} style={styles.copyBtn} title="Copy">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      <div style={{ ...styles.help, marginTop: space['3'] }}>
        {t('otpSetupStep2') || '2. Enter the 6-digit code your app shows now:'}
      </div>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="123456"
        style={{ ...styles.input, fontFamily: font.mono, letterSpacing: '0.4em', textAlign: 'center' }}
        autoFocus
      />

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.row}>
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          {t('cancel') || 'Cancel'}
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={submitting || !codeReady}>
          {submitting ? '…' : (t('otpVerifyAndEnable') || 'Verify & enable')}
        </Button>
      </div>
    </div>
  );
};

const BackupCodesPanel = ({ codes, onDone, t }) => {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const copyAll = async () => {
    if (!await copyToClipboard(text)) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <ShieldCheck size={16} strokeWidth={1.8} color={color.accent} />
        <span style={styles.title}>{t('otpBackupTitle') || 'Save these backup codes'}</span>
      </div>
      <div style={styles.help}>
        {t('otpBackupHint') || 'Each code works once if you lose access to your authenticator. Store them somewhere safe — we won\'t show them again.'}
      </div>
      <div style={styles.backupGrid}>
        {codes.map((c) => <code key={c} style={styles.backupCode}>{c}</code>)}
      </div>
      <div style={styles.row}>
        <Button variant="secondary" onClick={copyAll} icon={copied ? Check : Copy}>
          {copied ? (t('copied') || 'Copied') : (t('copyAll') || 'Copy all')}
        </Button>
        <Button variant="primary" onClick={onDone}>
          {t('otpBackupSavedConfirm') || 'I have saved them'}
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
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space['1'],
    fontSize: fontSize['12'],
  },
  metaLabel: { color: color.subtext },
  metaValue: { color: color.text, fontWeight: fontWeight.medium },
  row: {
    display: 'flex',
    gap: space['2'],
    justifyContent: 'flex-end',
    marginTop: space['1'],
    flexWrap: 'wrap',
  },
  qrWrap: {
    alignSelf: 'center',
    background: '#fff',
    padding: space['3'],
    borderRadius: radius.sm,
  },
  secretRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
  },
  secret: {
    flex: 1,
    fontFamily: font.mono,
    fontSize: fontSize['12'],
    color: color.text,
    background: color.mantle,
    padding: `${space['2']} ${space['3']}`,
    borderRadius: radius.sm,
    border: `1px solid ${color.border}`,
    wordBreak: 'break-all',
  },
  copyBtn: {
    background: color.surface1,
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: `${space['1.5']} ${space['2']}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  error: {
    fontSize: fontSize['12'],
    color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: '1px solid rgba(243, 139, 168, 0.18)',
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
  },
  backupGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: space['1.5'],
    marginTop: space['1'],
  },
  backupCode: {
    fontFamily: font.mono,
    fontSize: fontSize['13'],
    color: color.text,
    background: color.mantle,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
    textAlign: 'center',
    letterSpacing: '0.1em',
  },
  muted: {
    fontSize: fontSize['12'],
    color: color.muted,
    padding: space['3'],
  },
};

export default OtpSection;
