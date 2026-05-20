import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Plus, Trash2, Pencil, Check, X as XIcon } from 'lucide-react';
import { tokens } from '../styles/tokens';
import {
  deletePasskey,
  isPasskeySupported,
  listPasskeys,
  registerPasskey,
  renamePasskey,
} from '../utils/webauthn';

const { color, fontSize, fontWeight, radius, space, motion, font } = tokens;

// 설정 페이지에 들어가는 패스키 관리 섹션.
// - 등록: 현재 토큰으로 인증된 사용자가 새 패스키 추가.
// - 목록: 라벨, 생성/마지막 사용 시각, 삭제/이름변경.
const formatTs = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
};

const PasskeySection = ({ t }) => {
  const supported = isPasskeySupported();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await listPasskeys()); }
    catch (e) { setError(e?.message || 'load failed'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (supported) refresh(); }, [supported, refresh]);

  const handleRegister = async () => {
    setError('');
    setRegistering(true);
    try {
      const defaultLabel = (typeof navigator !== 'undefined' && navigator.userAgentData?.brands?.[0]?.brand)
        || (typeof navigator !== 'undefined' && navigator.platform)
        || 'New device';
      const label = (typeof window !== 'undefined'
        ? window.prompt(t?.('passkeyLabelPrompt') || '이 패스키에 붙일 이름 (예: MacBook)', defaultLabel)
        : null);
      if (label === null) { setRegistering(false); return; } // 사용자가 cancel
      await registerPasskey((label || '').trim() || defaultLabel);
      await refresh();
    } catch (e) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'AbortError') { /* user cancel */ }
      else setError(e?.message || 'register failed');
    } finally { setRegistering(false); }
  };

  const handleDelete = async (item) => {
    if (typeof window !== 'undefined' && !window.confirm(
      (t?.('confirmDeletePasskey') || '이 패스키를 삭제할까요?') + `\n— ${item.label || item.credential_id_b64.slice(0, 8)}`
    )) return;
    try { await deletePasskey(item.id); await refresh(); }
    catch (e) { setError(e?.message || 'delete failed'); }
  };

  const startRename = (item) => {
    setEditingId(item.id);
    setEditLabel(item.label || '');
  };
  const cancelRename = () => { setEditingId(null); setEditLabel(''); };
  const commitRename = async () => {
    const label = editLabel.trim();
    if (!label) { cancelRename(); return; }
    try { await renamePasskey(editingId, label); cancelRename(); await refresh(); }
    catch (e) { setError(e?.message || 'rename failed'); }
  };

  if (!supported) {
    return (
      <div style={styles.notSupported}>
        {t?.('passkeyNotSupported') || '이 브라우저는 패스키를 지원하지 않습니다.'}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes passkey-row-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        .passkey-row { animation: passkey-row-in 220ms ease both; }
      `}</style>

      <div style={styles.hint}>
        {t?.('passkeyHint') || '비밀번호 없이 디바이스 인증으로 로그인합니다. 디바이스마다 하나씩 등록하세요.'}
      </div>

      <button
        type="button"
        onClick={handleRegister}
        disabled={registering}
        style={{ ...styles.addBtn, opacity: registering ? 0.6 : 1, cursor: registering ? 'wait' : 'pointer' }}
      >
        <Plus size={14} strokeWidth={2.2} />
        {registering
          ? (t?.('passkeyRegistering') || '등록 중…')
          : (t?.('passkeyAdd') || '패스키 등록')}
      </button>

      {error && <div style={styles.error}>{error}</div>}

      {loading && items.length === 0 ? (
        <div style={styles.placeholder}>{t?.('loading') || 'Loading…'}</div>
      ) : items.length === 0 ? (
        <div style={styles.placeholder}>{t?.('passkeyEmpty') || '아직 등록된 패스키가 없습니다.'}</div>
      ) : (
        <div style={styles.list}>
          {items.map((item, idx) => (
            <div key={item.id} className="passkey-row" style={{ ...styles.row, animationDelay: `${idx * 24}ms` }}>
              <div style={styles.rowIcon}>
                <Fingerprint size={15} strokeWidth={2} />
              </div>
              <div style={styles.rowBody}>
                {editingId === item.id ? (
                  <div style={styles.editRow}>
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      style={styles.editInput}
                    />
                    <button type="button" onClick={commitRename} style={styles.iconBtn} title={t?.('save') || 'Save'}>
                      <Check size={13} strokeWidth={2.4} />
                    </button>
                    <button type="button" onClick={cancelRename} style={styles.iconBtn} title={t?.('cancel') || 'Cancel'}>
                      <XIcon size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={styles.rowLabel}>{item.label || (t?.('passkeyUnnamed') || '이름 없음')}</div>
                    <div style={styles.rowMeta}>
                      <span>{t?.('passkeyCreated') || '등록'}: {formatTs(item.created_at)}</span>
                      <span style={styles.metaSep}>·</span>
                      <span>{t?.('passkeyLastUsed') || '최근 사용'}: {formatTs(item.last_used_at)}</span>
                    </div>
                  </>
                )}
              </div>
              {editingId !== item.id && (
                <div style={styles.rowActions}>
                  <button type="button" onClick={() => startRename(item)} style={styles.iconBtn} title={t?.('rename') || 'Rename'}>
                    <Pencil size={12} strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    style={styles.iconBtn}
                    title={t?.('remove') || 'Remove'}
                    onMouseEnter={(e) => { e.currentTarget.style.color = `var(--ui-danger, ${color.danger})`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = `var(--ui-subtext, ${color.subtext})`; }}
                  >
                    <Trash2 size={12} strokeWidth={2.2} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  hint: {
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    lineHeight: 1.5,
  },
  addBtn: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['2']} ${space['4']}`,
    background: `var(--ui-accent, ${color.accent})`,
    color: `var(--ui-crust, ${color.crust})`,
    border: '1px solid transparent',
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    fontFamily: 'inherit',
    transition: `opacity ${motion.fast}`,
  },
  error: {
    fontSize: fontSize['12'],
    color: `var(--ui-danger, ${color.danger})`,
    padding: `${space['2']} ${space['3']}`,
    background: `color-mix(in srgb, var(--ui-danger, ${color.danger}) 10%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--ui-danger, ${color.danger}) 30%, transparent)`,
    borderRadius: radius.sm,
  },
  notSupported: {
    fontSize: fontSize['12'],
    color: `var(--ui-subtext, ${color.subtext})`,
    padding: `${space['2']} ${space['3']}`,
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 50%, transparent)`,
    borderRadius: radius.sm,
  },
  placeholder: {
    fontSize: fontSize['12'],
    color: `var(--ui-muted, ${color.muted})`,
    padding: `${space['3']} 0`,
    textAlign: 'center',
    opacity: 0.7,
  },
  list: { display: 'flex', flexDirection: 'column', gap: space['1.5'] },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['2']} ${space['3']}`,
    background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 70%, transparent)`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: radius.sm,
  },
  rowIcon: {
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `color-mix(in srgb, var(--ui-accent, ${color.accent}) 18%, transparent)`,
    color: `var(--ui-accent, ${color.accent})`,
    borderRadius: '50%',
    flexShrink: 0,
  },
  rowBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  rowLabel: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: `var(--ui-text, ${color.text})`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10.5px',
    color: `var(--ui-subtext, ${color.subtext})`,
    fontFamily: font.mono,
    flexWrap: 'wrap',
  },
  metaSep: { opacity: 0.5 },
  rowActions: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  iconBtn: {
    width: '22px', height: '22px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent',
    color: `var(--ui-subtext, ${color.subtext})`,
    border: 'none', cursor: 'pointer', padding: 0,
    borderRadius: '4px',
    transition: `background ${motion.fast}, color ${motion.fast}`,
  },
  editRow: { display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 },
  editInput: {
    flex: 1, minWidth: 0,
    background: `var(--ui-base, ${color.base})`,
    color: `var(--ui-text, ${color.text})`,
    border: `1px solid var(--ui-border, ${color.border})`,
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    outline: 'none',
  },
};

export default PasskeySection;
