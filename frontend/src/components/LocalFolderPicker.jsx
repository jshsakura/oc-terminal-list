import { useEffect, useState, useCallback } from 'react';
import { X, Folder, ArrowUp, ArrowLeft, ChevronRight, Home, Eye, EyeOff } from 'lucide-react';
import { tokens } from '../styles/tokens';
import TerminalLaunchOptions from './common/TerminalLaunchOptions';
import NewFolderRow from './common/NewFolderRow';
import { INHERIT } from '../utils/launchOptions';
import SkeletonRow from './common/SkeletonRow';
import { authHeaders } from '../utils/auth';
import { apiFetch } from '../utils/apiFetch';
import { splitHiddenEntries, readShowHidden, writeShowHidden } from '../utils/hiddenEntries';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/* 인라인 호버 버튼 — base 스타일 위에 hover 시 추가 스타일 덧붙임.
   disabled 일 때는 호버 효과 없음. focus/blur 도 keyboard 사용자 대비로 같이 처리. */
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

const parentOf = (rel) => {
  if (!rel || rel === '' || rel === '/') return '';
  const trimmed = rel.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '';
  return trimmed.slice(0, idx);
};

/**
 * 워크스페이스 내부의 폴더만 탐색하는 픽커. 절대경로가 아닌 워크스페이스 상대 경로 반환.
 * 빈 경로 = 워크스페이스 루트.
 *
 * inline=true 면 모달 대신 부모 컨테이너 전체를 덮는 오버레이로 렌더 (분할 pane 안에서 사용).
 *   - scrim 없음, 그림자/border-radius 없음
 *   - 헤더에 ← 백 버튼 추가 (= onClose)
 *   - 부모는 position:relative 여야 함 (Pane 컨테이너가 이미 그러함)
 */
const LocalFolderPicker = ({
  isOpen, initialPath = '', title, onPick, onClose, t, inline = false,
  /* 고른 폴더로 **터미널을 여는** 자리에서만 켠다. 시작 경로 설정처럼 경로만 받아 가는
     쓰임에서는 켜지 않는다 — 아무 데도 안 쓰이는 칸을 내밀면 안 된다. */
  launchOptions = false, defaultMultiplexer, defaultShell,
}) => {
  const [launch, setLaunch] = useState({ multiplexer: INHERIT, shell: INHERIT });
  const [path, setPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  /* 점 폴더는 기본으로 감춘다 — 워크스페이스 루트만 해도 .git/.cache/.local… 이 진짜
     폴더를 화면 밖으로 밀어낸다. 선택은 localStorage 에 남아 다음에 열 때도 유지된다. */
  const [showHidden, setShowHidden] = useState(readShowHidden);
  const toggleHidden = useCallback(() => {
    setShowHidden((prev) => { writeShowHidden(!prev); return !prev; });
  }, []);

  const load = useCallback(async (target) => {
    setLoading(true);
    setError(null);
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : '';
      const res = await fetch(`/api/files${qs}`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPath(target || '');
      setItems((data.items || []).filter((i) => i.type === 'directory'));
    } catch (e) {
      setError(e.message || 'failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setPath(initialPath || '');
    setItems([]);
    setError(null);
    /* ⚠️ **열 때마다 잊는다.** 이 컴포넌트는 닫혀도 언마운트되지 않아(`return null` 이라
       상태가 그대로 산다) 지난번에 고른 값이 다음 열기에 그대로 남아 있었다 — 한 번
       herdr 를 고르면 그 뒤로 계속 herdr 로 열렸다. 한 번짜리 선택은 한 번만 산다. */
    setLaunch({ multiplexer: INHERIT, shell: INHERIT });
    load(initialPath || '');
  }, [isOpen, initialPath, load]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const { shown, hiddenCount } = splitHiddenEntries(items, showHidden);
  const goUp = () => load(parentOf(path));
  const goHome = () => load('');
  const enter = (folder) => load(folder.path);

  /* 지금 보고 있는 폴더 **안에** 만들고 곧장 들어간다. 경로 합치기는 여기서만 한다 —
     이름 검사는 NewFolderRow 가 이미 했다(`/` 금지). */
  const createFolder = useCallback(async (name) => {
    const target = path ? `${path}/${name}` : name;
    const res = await apiFetch('/api/files/create', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: target, type: 'directory' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    await load(target);
  }, [path, load]);
  const confirm = () => onPick?.(path, launch);

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
            {title || t?.('pickFolder') || 'Pick a folder'}
          </div>
          <HoverBtn type="button" onClick={onClose} baseStyle={styles.closeBtn} hoverStyle={styles.iconBtnHover} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </HoverBtn>
        </header>

        <div style={styles.toolbar}>
          <HoverBtn type="button" onClick={goHome} baseStyle={styles.toolBtn} hoverStyle={styles.toolBtnHover} title={t?.('home') || 'Workspace root'}>
            <Home size={13} strokeWidth={1.8} />
          </HoverBtn>
          <HoverBtn
            type="button"
            onClick={goUp}
            disabled={!path}
            baseStyle={{ ...styles.toolBtn, opacity: !path ? 0.4 : 1 }}
            hoverStyle={styles.toolBtnHover}
            title={t?.('folderUp') || 'Up'}
          >
            <ArrowUp size={13} strokeWidth={1.8} />
          </HoverBtn>
          <HoverBtn
            type="button"
            onClick={toggleHidden}
            aria-pressed={showHidden}
            baseStyle={{
              ...styles.toolBtn,
              ...(showHidden ? styles.toolBtnOn : null),
              /* 숨길 게 없어도 버튼은 자리를 지킨다 — 목록이 바뀔 때마다 툴바가 들썩이면
                 그게 더 정신없다. 흐리게만 둔다. */
              ...(hiddenCount === 0 && !showHidden ? { opacity: 0.45 } : null),
            }}
            hoverStyle={styles.toolBtnHover}
            title={showHidden
              ? (t?.('hideHidden') || 'Hide dot folders')
              : `${t?.('showHidden') || 'Show hidden folders'}${hiddenCount ? ` (${hiddenCount})` : ''}`}
          >
            {showHidden ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
          </HoverBtn>
          <NewFolderRow onCreate={createFolder} disabled={loading} t={t} />
          <div style={styles.crumb} title={path || '/'}>
            {path ? `/${path}` : '/'}
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
          {/* "폴더가 없다" 와 "전부 숨김이라 안 보인다" 는 다른 상황이다 — 후자는 뭘 하면
              되는지 같이 알려준다. 안 그러면 빈 화면 앞에서 토글을 못 찾는다. */}
          {!loading && !error && shown.length === 0 && (
            <div style={styles.notice}>
              {hiddenCount > 0
                ? (t?.('onlyHiddenHere') || 'Only hidden folders here.')
                : (t?.('emptyFolder') || 'No subfolders here.')}
            </div>
          )}
          {!loading && !error && shown.map((it) => (
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

        {launchOptions && (
          <TerminalLaunchOptions
            multiplexer={launch.multiplexer}
            shell={launch.shell}
            onChange={setLaunch}
            defaultMultiplexer={defaultMultiplexer}
            defaultShell={defaultShell}
            t={t}
          />
        )}
        <footer style={styles.footer}>
          <HoverBtn type="button" onClick={onClose} baseStyle={styles.cancelBtn} hoverStyle={styles.cancelBtnHover}>
            {t?.('cancel') || 'Cancel'}
          </HoverBtn>
          <HoverBtn type="button" onClick={confirm} baseStyle={styles.openBtn} hoverStyle={styles.openBtnHover}>
            {t?.('selectThisFolder') || (path ? 'Select this folder' : 'Use workspace root')}
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
  /* inline 모드 — Pane 안에서 컨테이너 전체를 덮는다. scrim 없음 (배경 보일 필요 X). */
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
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `12px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  title: { fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text },
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
  /* 켜진 토글 — 지금 목록이 "전부 보기" 상태라는 걸 버튼 하나로 말한다. */
  toolBtnOn: {
    background: color.surface1,
    borderColor: color.accent,
    color: color.accent,
  },
  toolBtnHover: {
    background: color.surface1,
    borderColor: color.borderStrong,
    color: color.text,
  },
  crumb: {
    flex: 1, minWidth: 0,
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
    flex: 1, minWidth: 0,
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
    cursor: 'pointer',
  },
  openBtnHover: {
    opacity: 0.9,
  },
};

export default LocalFolderPicker;
