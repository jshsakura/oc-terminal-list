import { useEffect, useState, useCallback } from 'react';
import { X, Folder, ArrowUp, ArrowLeft, ChevronRight, Home } from 'lucide-react';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/* 인라인 호버 버튼 — LocalFolderPicker 와 같은 패턴. base 위에 hover 시 추가 스타일. */
const HoverBtn = ({ baseStyle, hoverStyle, disabled = false, children, ...rest }) => {
  const [hover, setHover] = useState(false);
  const merged = {
    ...baseStyle,
    transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}, opacity ${motion.fast}`,
    ...(hover && !disabled ? hoverStyle : null),
  };
  return (
    <button
      {...rest}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={merged}
    >
      {children}
    </button>
  );
};

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
 *
 * inline=true 면 모달 대신 부모 컨테이너 전체를 덮는 오버레이 (분할 pane 안에서 사용).
 *   - 부모는 position:relative 여야 함.
 */
const RemoteFolderPicker = ({ isOpen, host, onPick, onClose, t, confirmLabel = null, title = null, inline = false }) => {
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

  const overlayStyle = inline ? styles.inlineOverlay : styles.overlay;
  const surfaceStyle = inline ? styles.inlineSurface : styles.modal;

  return (
    <div style={overlayStyle} onClick={inline ? undefined : onClose}>
      <div style={surfaceStyle} onClick={inline ? undefined : (e) => e.stopPropagation()}>
        <header style={styles.header}>
          {inline && (
            <HoverBtn type="button" onClick={onClose} baseStyle={styles.backBtn} hoverStyle={styles.iconBtnHover} title={t?.('back') || 'Back'}>
              <ArrowLeft size={14} strokeWidth={2} />
            </HoverBtn>
          )}
          <div style={styles.title}>
            {title || t?.('pickFolder') || 'Pick a folder'} — <span style={{ color: color.muted }}>{host.name}</span>
          </div>
          <HoverBtn type="button" onClick={onClose} baseStyle={styles.closeBtn} hoverStyle={styles.iconBtnHover} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </HoverBtn>
        </header>

        <div style={styles.toolbar}>
          <HoverBtn type="button" onClick={goHome} baseStyle={styles.toolBtn} hoverStyle={styles.toolBtnHover} title={t?.('home') || 'Home'}>
            <Home size={13} strokeWidth={1.8} />
          </HoverBtn>
          <HoverBtn type="button" onClick={goUp} disabled={!path || path === '/'} baseStyle={{ ...styles.toolBtn, opacity: !path || path === '/' ? 0.4 : 1 }} hoverStyle={styles.toolBtnHover} title={t?.('folderUp') || 'Up'}>
            <ArrowUp size={13} strokeWidth={1.8} />
          </HoverBtn>
          <div style={styles.crumb} title={path || '~'}>
            {path || '~'}
          </div>
        </div>

        <div style={styles.body}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: `${space['2']} ${space['3']}` }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px' }}>
                  <SkeletonRow width="14px" height="14px" borderRadius="3px" />
                  <SkeletonRow width={`${55 + ((i * 9) % 25)}%`} height="13px" />
                  <SkeletonRow width="12px" height="12px" borderRadius="2px" style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          )}
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
          <HoverBtn type="button" onClick={onClose} baseStyle={styles.cancelBtn} hoverStyle={styles.cancelBtnHover}>
            {t?.('cancel') || 'Cancel'}
          </HoverBtn>
          <HoverBtn
            type="button"
            onClick={confirm}
            disabled={!path}
            baseStyle={{ ...styles.openBtn, opacity: path ? 1 : 0.5, cursor: path ? 'pointer' : 'not-allowed' }}
            hoverStyle={styles.openBtnHover}
          >
            {confirmLabel || t?.('openHere') || 'Open terminal here'}
          </HoverBtn>
        </footer>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'absolute', inset: 0,
    background: color.scrim,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10001,
    fontFamily: font.sans,
    backdropFilter: 'blur(2px)',
  },
  inlineOverlay: {
    position: 'absolute', inset: 0,
    background: color.base,
    display: 'flex',
    zIndex: 30,
    fontFamily: font.sans,
  },
  inlineSurface: {
    width: '100%', height: '100%',
    background: color.base,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
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
  backBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: '4px',
    cursor: 'pointer', color: color.subtext,
    padding: 0,
    marginRight: '4px',
  },
  iconBtnHover: {
    background: color.surface0,
    color: color.text,
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
  toolBtnHover: {
    background: color.surface1,
    borderColor: color.borderStrong,
    color: color.text,
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
    minHeight: '160px',
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
  cancelBtnHover: {
    background: color.surface0,
    borderColor: color.borderStrong,
    color: color.text,
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
  openBtnHover: {
    opacity: 0.9,
  },
};

export default RemoteFolderPicker;
