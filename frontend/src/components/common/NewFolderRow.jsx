import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, Check, X } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, radius, space } = tokens;

/**
 * 폴더 픽커 안에서 **없는 폴더를 만들어 그리로 들어간다.**
 *
 * 고를 수 있는 것이 이미 있는 것뿐이면, 새 작업을 시작할 때마다 터미널을 먼저 열어
 * `mkdir` 을 치고 픽커를 다시 열어야 한다. 그 왕복을 없애는 것이 전부다.
 *
 * ⚠️ **이름 검사는 만들기 전에 한다.** `/` 나 `..` 이 섞이면 지금 보고 있는 폴더가 아닌
 * 다른 자리에 만들어진다. 서버도 `validate_path` 로 막지만(로컬), 여기서 걸러야
 * 사용자가 "왜 여기 없지" 를 겪지 않는다.
 *
 * ⚠️ **만든 뒤에는 그 안으로 들어간다.** 만들어 놓고 그 자리에 서 있으면 사용자가 한 번
 * 더 눌러야 하는데, 방금 만든 폴더로 가려는 것 말고 다른 이유로 만들 일이 없다.
 */
const INVALID = /[/\\]/;

const NewFolderRow = ({ onCreate, disabled = false, t }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const close = useCallback(() => { setOpen(false); setName(''); setError(null); }, []);

  const submit = useCallback(async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    if (INVALID.test(clean) || clean === '.' || clean === '..') {
      setError(t?.('newFolderBadName') || '폴더 이름에는 / 를 쓸 수 없습니다');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(clean);
      close();
    } catch (e) {
      // 조용히 실패하지 않는다 — 이미 있는 이름(409)과 권한 없음이 가장 흔하다.
      setError(e?.message || (t?.('newFolderFailed') || '폴더를 만들지 못했습니다'));
    } finally {
      setBusy(false);
    }
  }, [name, busy, onCreate, close, t]);

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={t?.('newFolder') || '새 폴더'}
        style={{ ...styles.toolBtn, opacity: disabled ? 0.4 : 1 }}
      >
        <FolderPlus size={13} strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <div style={styles.row}>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        /* ⚠️ Escape 는 여기서 멈춘다. 안 그러면 픽커의 문서 레벨 핸들러가 창을 통째로
           닫아, 이름을 잘못 친 사람이 처음부터 다시 열어야 한다. */
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}
        placeholder={t?.('newFolderName') || '새 폴더 이름'}
        aria-label={t?.('newFolder') || '새 폴더'}
        style={styles.input}
      />
      <button type="button" onClick={submit} disabled={busy || !name.trim()}
        title={t?.('create') || '만들기'} style={styles.toolBtn}>
        <Check size={13} strokeWidth={2} />
      </button>
      <button type="button" onClick={close} title={t?.('cancel') || '취소'} style={styles.toolBtn}>
        <X size={13} strokeWidth={2} />
      </button>
      {error && <span style={styles.error}>{error}</span>}
    </div>
  );
};

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    minWidth: 0,
    flex: 1,
  },
  input: {
    flex: 1,
    minWidth: '80px',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['11'],
    fontFamily: font.sans,
    padding: '4px 6px',
    outline: 'none',
  },
  toolBtn: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    color: color.subtext,
    cursor: 'pointer',
    padding: 0,
  },
  error: {
    fontSize: fontSize['10'],
    color: color.danger,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

export default NewFolderRow;
