import { useEffect, useState, useCallback } from 'react';
import { X, Folder, ArrowUp, ChevronRight, Home } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const parentOf = (abs) => {
  if (!abs || abs === '/') return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx);
};

/**
 * 원격 호스트의 폴더를 SFTP 로 탐색하면서 시작 경로를 고르는 모달.
 * onPick(absolutePath) 콜백으로 선택 완료 후 경로 전달, onClose 로 취소.
 */
const RemoteFolderPicker = ({ isOpen, host, onPick, onClose, t, confirmLabel = null, title = null }) => {
  const [path, setPath] = useState('');         // 현재 보고 있는 절대 경로
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (target) => {
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : '';
      const res = await fetch(`/api/hosts/${host.id}/files${qs}`, { headers: authHeader() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPath(data.path || target || '');
      setItems((data.items || []).filter((i) => i.type === 'directory'));
    } catch (e) {
      setError(e.message || 'failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    if (!isOpen || !host) return;
    setPath('');
    setItems([]);
    setError(null);
    load('');
  }, [isOpen, host?.id, load]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  if (!isOpen || !host) return null;

  const goUp = () => load(parentOf(path));
  const goHome = () => load('');
  const enter = (folder) => load(folder.path);
  const confirm = () => {
    if (!path) return;
    onPick?.(path);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.title}>
            {title || t?.('pickFolder') || 'Pick a folder'} — <span style={{ color: color.muted }}>{host.name}</span>
          </div>
          <button type="button" onClick={onClose} style={styles.closeBtn} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.toolbar}>
          <button type="button" onClick={goHome} style={styles.toolBtn} title={t?.('home') || 'Home'}>
            <Home size={13} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={goUp} disabled={!path || path === '/'} style={{ ...styles.toolBtn, opacity: !path || path === '/' ? 0.4 : 1 }} title={t?.('folderUp') || 'Up'}>
            <ArrowUp size={13} strokeWidth={1.8} />
          </button>
          <div style={styles.crumb} title={path || '~'}>
            {path || '~'}
          </div>
        </div>

        <div style={styles.body}>
          {loading && <div style={styles.notice}>{t?.('loading') || 'Loading…'}</div>}
          {error && !loading && <div style={{ ...styles.notice, color: color.danger }}>{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={styles.notice}>{t?.('emptyFolder') || 'No subfolders here.'}</div>
          )}
          {!loading && !error && items.map((it) => (
            <button
              key={it.path}
              type="button"
              onClick={() => enter(it)}
              style={styles.row}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Folder size={14} strokeWidth={1.8} style={{ color: color.accent, flexShrink: 0 }} />
              <span style={styles.rowName}>{it.name}</span>
              <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
            </button>
          ))}
        </div>

        <footer style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.cancelBtn}>
            {t?.('cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!path}
            style={{ ...styles.openBtn, opacity: path ? 1 : 0.5, cursor: path ? 'pointer' : 'not-allowed' }}
          >
            {confirmLabel || t?.('openHere') || 'Open terminal here'}
          </button>
        </footer>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: color.scrim,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10001,
    fontFamily: font.sans,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    width: '92%',
    maxWidth: '460px',
    maxHeight: '78vh',
    background: color.base,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.lg,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `12px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  title: {
    fontSize: fontSize['13'],
    fontWeight: fontWeight.semibold,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: '4px',
    cursor: 'pointer', color: color.subtext,
    padding: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: `8px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.mantle,
  },
  toolBtn: {
    width: '26px', height: '26px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    padding: 0,
  },
  crumb: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.mono,
    fontSize: '11.5px',
    color: color.subtext,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: `4px ${space['2']}`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: `4px 0`,
  },
  notice: {
    padding: `${space['4']} ${space['4']}`,
    fontSize: fontSize['12'],
    color: color.muted,
    textAlign: 'center',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: `8px ${space['4']}`,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: font.sans,
    color: color.text,
    textAlign: 'left',
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize['12'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: space['1.5'],
    padding: `10px ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
    flexShrink: 0,
  },
  cancelBtn: {
    padding: `6px 12px`,
    background: 'transparent',
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
  },
  openBtn: {
    padding: `6px 14px`,
    background: color.accent,
    border: `1px solid ${color.accent}`,
    borderRadius: radius.sm,
    color: color.crust,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    fontFamily: 'inherit',
  },
};

export default RemoteFolderPicker;
