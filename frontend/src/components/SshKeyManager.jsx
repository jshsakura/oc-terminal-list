import { useState } from 'react';
import { X, KeyRound, Plus, Trash2, Pencil } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

/**
 * 저장된 SSH 키 관리 모달.
 * - 추가: name + private_key (+ optional passphrase)
 * - 삭제: 호스트가 참조 중이면 백엔드는 SET NULL 이므로 호스트는 살아있되 인증 실패
 *
 * 보안 메모:
 * private_key 는 입력 시점에서 한 번 백엔드 vault 로 암호화 후 저장.
 * UI 에는 평문으로 다시 보여주지 않는다 (write-once).
 */
const SshKeyManager = ({ isOpen, keys, onAdd, onUpdate, onDelete, onClose, t }) => {
  const [mode, setMode] = useState('list'); // 'list' | 'add' | 'edit'
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', privateKey: '', passphrase: '', publicKey: '' });
  const [clearPassphrase, setClearPassphrase] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const reset = () => {
    setDraft({ name: '', privateKey: '', passphrase: '', publicKey: '' });
    setClearPassphrase(false);
    setEditingId(null);
    setError('');
    setMode('list');
  };

  const startEdit = (k) => {
    // 보안: private key 평문은 노출하지 않음. name/public_key 만 채우고 비밀 필드는 빈값(미변경 의도).
    setDraft({ name: k.name || '', privateKey: '', passphrase: '', publicKey: k.public_key || '' });
    setClearPassphrase(false);
    setEditingId(k.id);
    setError('');
    setMode('edit');
  };

  const submit = async () => {
    setError('');
    if (!draft.name.trim()) return setError(t('errorNameRequired') || 'Name required');
    if (mode === 'add' && !draft.privateKey.trim()) return setError(t('errorKeyRequired') || 'Private key required');
    setBusy(true);
    try {
      if (mode === 'edit') {
        await onUpdate(editingId, {
          name: draft.name,
          publicKey: draft.publicKey,
          privateKey: draft.privateKey || undefined,
          passphrase: draft.passphrase || undefined,
          clearPassphrase: clearPassphrase,
        });
      } else {
        await onAdd(draft);
      }
      reset();
    } catch (err) {
      setError(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <header style={styles.header}>
          <div style={styles.title}>
            {mode === 'edit' ? (t('editKey') || 'Edit SSH key')
              : mode === 'add' ? (t('addKey') || 'Add SSH key')
              : (t('sshKeys') || 'SSH Keys')}
          </div>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} strokeWidth={2} /></button>
        </header>

        <div style={styles.body}>
          {mode === 'list' && (
            <>
              {keys.length === 0 ? (
                <div style={styles.empty}>
                  <div style={styles.emptyTitle}>{t('noKeys') || 'No SSH keys yet'}</div>
                  <div style={styles.emptyHint}>{t('addKeyHint') || 'Add a private key to authenticate hosts.'}</div>
                </div>
              ) : (
                <div style={styles.list}>
                  {keys.map((k) => (
                    <div key={k.id} style={styles.row}>
                      <div style={styles.rowIcon}>
                        <KeyRound size={13} strokeWidth={2} />
                      </div>
                      <div style={styles.rowBody}>
                        <div style={styles.rowName}>{k.name}</div>
                        <div style={styles.rowSub}>
                          {k.public_key ? k.public_key.substring(0, 60) + '…' : (t('noPublicKey') || 'private only')}
                        </div>
                      </div>
                      <button
                        onClick={() => startEdit(k)}
                        title={t('edit') || 'Edit'}
                        style={styles.rowActionBtn}
                        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.muted; }}
                      >
                        <Pencil size={12} strokeWidth={2} />
                      </button>
                      <button
                        onClick={() => onDelete(k.id)}
                        title={t('delete') || 'Delete'}
                        style={styles.rowActionBtn}
                        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.danger; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.muted; }}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: space['3'] }}>
                <Button variant="primary" size="medium" icon={Plus} onClick={() => setMode('add')}>
                  {t('addKey') || 'Add SSH key'}
                </Button>
              </div>
            </>
          )}

          {(mode === 'add' || mode === 'edit') && (
            <div style={styles.form}>
              <Field label={t('hostName') || 'Display name'}>
                <Input value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="my-laptop-ed25519" autoFocus />
              </Field>
              <Field
                label={t('privateKey') || 'Private key (PEM)'}
                hint={mode === 'edit'
                  ? (t('privateKeyEditHint') || 'Leave empty to keep the existing key. Paste a new key only to replace it.')
                  : (t('privateKeyHint') || 'Paste the full PEM content. Encrypted at rest.')}
              >
                <textarea
                  value={draft.privateKey}
                  onChange={(e) => setDraft({ ...draft, privateKey: e.target.value })}
                  placeholder={mode === 'edit'
                    ? (t('privateKeyKeepPlaceholder') || '(unchanged — paste new key to replace)')
                    : '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                  spellCheck={false}
                  rows={8}
                  style={styles.textarea}
                />
              </Field>
              <Field
                label={t('passphraseOptional') || 'Passphrase (if any)'}
                hint={mode === 'edit' ? (t('passphraseEditHint') || 'Leave empty to keep current. Check the box to clear it.') : undefined}
              >
                <Input
                  type="password"
                  value={draft.passphrase}
                  onChange={(v) => setDraft({ ...draft, passphrase: v })}
                  placeholder={mode === 'edit' ? (t('passphraseKeepPlaceholder') || '(unchanged)') : '••••'}
                />
                {mode === 'edit' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: space['1.5'], marginTop: space['1'], fontSize: fontSize['11'], color: color.muted, cursor: 'pointer' }}>
                    <input type="checkbox" checked={clearPassphrase} onChange={(e) => setClearPassphrase(e.target.checked)} />
                    {t('clearPassphrase') || 'Clear passphrase'}
                  </label>
                )}
              </Field>
              <Field label={t('publicKeyOptional') || 'Public key (optional, helps identify)'}>
                <textarea
                  value={draft.publicKey}
                  onChange={(e) => setDraft({ ...draft, publicKey: e.target.value })}
                  placeholder="ssh-ed25519 AAAA… user@host"
                  spellCheck={false}
                  rows={3}
                  style={styles.textarea}
                />
              </Field>
              {error && <div style={styles.error}>{error}</div>}
              <div style={{ display: 'flex', gap: space['1.5'], justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={reset} disabled={busy}>{t('cancel')}</Button>
                <Button variant="primary" onClick={submit} disabled={busy}>
                  {busy ? (t('saving') || 'Saving…') : (mode === 'edit' ? (t('save') || 'Save') : (t('add') || 'Add'))}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div style={styles.field}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

const Input = ({ value, onChange, type = 'text', placeholder, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...styles.input,
        borderColor: focused ? color.accentBorder : color.border,
        background: focused ? color.crust : color.mantle,
      }}
    />
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '92%',
    maxWidth: '520px',
    maxHeight: '88vh',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: { fontSize: fontSize['14'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: color.muted, border: 'none',
    borderRadius: radius.xs, cursor: 'pointer',
  },
  body: { padding: `${space['3']} ${space['4']}`, overflowY: 'auto' },
  empty: { textAlign: 'center', padding: `${space['8']} ${space['4']}`, color: color.muted },
  emptyTitle: { fontSize: fontSize['13'], color: color.subtext, marginBottom: space['1'] },
  emptyHint: { fontSize: fontSize['11'], color: color.muted },
  list: { display: 'flex', flexDirection: 'column', gap: '1px' },
  row: {
    display: 'flex', alignItems: 'center', gap: space['2'],
    padding: `${space['1.5']} ${space['2']}`,
    borderRadius: radius.sm,
    background: color.mantle,
    minHeight: '40px',
  },
  rowIcon: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: color.surface0, color: color.accent,
    border: `1px solid ${color.border}`, borderRadius: radius.xs,
    flexShrink: 0,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: fontSize['13'], color: color.text, fontWeight: fontWeight.medium },
  rowSub: { fontSize: fontSize['11'], color: color.muted, fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowActionBtn: {
    width: '22px', height: '22px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: color.muted, border: 'none',
    borderRadius: radius.xs, cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}`,
  },
  form: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  field: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  label: { fontSize: fontSize['12'], color: color.subtext, fontWeight: fontWeight.medium },
  input: {
    width: '100%', height: '32px', padding: `0 ${space['3']}`,
    background: color.mantle, color: color.text,
    border: `1px solid ${color.border}`, borderRadius: radius.sm,
    fontSize: fontSize['13'], fontFamily: 'inherit', outline: 'none',
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
  textarea: {
    width: '100%', minHeight: '80px',
    padding: `${space['2']} ${space['3']}`,
    background: color.mantle, color: color.text,
    border: `1px solid ${color.border}`, borderRadius: radius.sm,
    fontSize: fontSize['12'], fontFamily: font.mono, outline: 'none',
    resize: 'vertical',
  },
  hint: { fontSize: fontSize['11'], color: color.muted, marginTop: space['0.5'] },
  error: {
    fontSize: fontSize['12'], color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: `1px solid rgba(243, 139, 168, 0.18)`,
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
  },
};

export default SshKeyManager;
