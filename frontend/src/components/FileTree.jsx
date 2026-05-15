import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, FolderOpen, File, FileText, FileCode, FileImage, FileJson, FileType,
  RefreshCw, Terminal, ChevronRight, ChevronDown, Plus, Pencil, Trash2, GitBranch, Filter,
  ArrowUp, ArrowDown, Home, Search, X
} from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';

const { color, font, fontSize, fontWeight, radius, space, motion, shadow: designShadow } = tokens;

const ROW_HEIGHT = 24;
const VIRTUALIZE_AFTER = 250;
const VIRTUAL_OVERSCAN = 8;

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'transparent',
    color: color.text,
    fontFamily: font.sans,
    overflow: 'hidden',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['1.5']} ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    minHeight: '36px',
    gap: space['2'],
  },
  virtualSpacer: {
    flexShrink: 0,
    pointerEvents: 'none',
  },
  headBranch: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
  },
  branchName: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    color: color.subtext,
    lineHeight: '22px',
    whiteSpace: 'nowrap',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
    maxWidth: '100%',
    width: '100%',
  },
  countBadge: {
    fontSize: fontSize['11'],
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `0 ${space['1.5']}`,
    fontFamily: font.mono,
    flexShrink: 0,
  },
  headActions: {
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    flexShrink: 0,
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    minHeight: 0,
    padding: `0 ${space['2']}`,
    boxSizing: 'border-box',
    borderBottom: '1px solid transparent',
    background: 'transparent',
    overflow: 'hidden',
    maxHeight: 0,
    opacity: 0,
    pointerEvents: 'none',
    transition: `max-height ${motion.normal}, opacity ${motion.fast}, padding ${motion.normal}, border-color ${motion.normal}`,
  },
  searchBarOpen: {
    maxHeight: '42px',
    opacity: 1,
    padding: `${space['1.5']} ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    pointerEvents: 'auto',
  },
  searchInput: {
    flex: 1,
    height: '26px',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    padding: '0 6px',
    fontSize: fontSize['12'],
    fontFamily: font.sans,
    outline: 'none',
  },
  searchClearBtn: {
    background: 'transparent',
    border: 'none',
    color: color.muted,
    cursor: 'pointer',
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headActionBtn: {
    width: '22px',
    height: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.muted,
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    transition: `color ${motion.fast}`,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    minHeight: '200px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 4px',
    height: `${ROW_HEIGHT}px`,
    minHeight: `${ROW_HEIGHT}px`,
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontSize: fontSize['13'],
    userSelect: 'none',
    transition: `background ${motion.fast}`,
  },
  chevron: {
    width: '12px',
    height: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: color.muted,
    flexShrink: 0,
  },
  name: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  gitTag: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    fontWeight: fontWeight.medium,
    flexShrink: 0,
    minWidth: '14px',
    textAlign: 'right',
    paddingRight: '2px',
  },
  editInput: {
    flex: 1,
    height: '20px',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.xs,
    padding: '0 4px',
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    outline: 'none',
  },
  statusBox: {
    padding: `${space['8']} ${space['4']}`,
    textAlign: 'center',
    color: color.muted,
    fontSize: fontSize['12'],
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  menu: {
    // 컨텍스트 메뉴 — 현재 포커스 pane 의 테마 따라가도록 var(--ui-*) 사용.
    // (포커스 pane 의 테마가 :root 에 자동 적용 → 포털로 document.body 에 렌더돼도 동작.)
    background: 'var(--ui-base)',
    color: 'var(--ui-text)',
    border: `1px solid var(--ui-border)`,
    borderRadius: radius.md,
    boxShadow: designShadow.lg,
    padding: `${space['1']} 0`,
    minWidth: '180px',
    fontFamily: font.sans,
  },
  menuItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['1.5']} ${space['3']}`,
    background: 'transparent',
    color: 'var(--ui-text)',
    border: 'none',
    cursor: 'pointer',
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: `background ${motion.fast}`,
  },
  errorBox: {
    color: color.danger,
    padding: space['3'],
    fontSize: fontSize['12'],
    display: 'flex',
    flexDirection: 'column',
    gap: space['2'],
    alignItems: 'flex-start',
  },
  retryBtn: {
    background: 'transparent',
    color: color.danger,
    border: `1px solid ${color.danger}55`,
    padding: `${space['1']} ${space['2']}`,
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontSize: fontSize['12'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const iconForFile = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext)) return FileImage;
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return FileJson;
  if (['md', 'mdx', 'rst', 'txt'].includes(ext)) return FileText;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'h', 'sh', 'lua'].includes(ext)) return FileCode;
  return File;
};

const fileIconColor = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  if (['md', 'mdx'].includes(ext)) return color.success;
  if (['json', 'yaml', 'yml'].includes(ext)) return color.warning;
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return color.info;
  if (['py'].includes(ext)) return color.success;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return color.dotPalette[5];
  return color.muted;
};

const gitTone = (status) => {
  if (status === 'M') return color.warning;
  if (status === '??' || status === 'A') return color.success;
  if (status === 'D') return color.danger;
  return color.muted;
};

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const computeParent = (p) => {
  if (!p) return null;
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  return trimmed.substring(0, idx);
};

const stripHostPathPrefix = (path) => {
  if (!path || typeof path !== 'string') return path || '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('~/') || trimmed === '~' || trimmed.startsWith('./')) return trimmed;
  const match = trimmed.match(/^[^\s/:]+(?:@[^\s/:]+)?:([/~].*)$/);
  return match ? match[1] : trimmed;
};

// ─── Components ──────────────────────────────────────────────────────────────
const Row = memo(({ depth, isOpen, isFolder, isSelected, name, tone, gitStatus, isChanged, onClick, onDoubleClick, onContextMenu }) => {
  const FileIcon = isFolder ? (isOpen ? FolderOpen : Folder) : iconForFile(name);
  const iconHue = isFolder ? color.accent : fileIconColor(name);
  const nameColor = isChanged && !isFolder ? gitTone(gitStatus || 'M') : tone;
  
  const touchTimerRef = useRef(null);
  const touchPosRef = useRef({ x: 0, y: 0 });

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchPosRef.current = { x: touch.clientX, y: touch.clientY };
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    
    touchTimerRef.current = setTimeout(() => {
      onContextMenu({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: touchPosRef.current.x,
        clientY: touchPosRef.current.y
      });
      touchTimerRef.current = null;
    }, 600); // 600ms long press
  };

  const handleTouchMove = (e) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchPosRef.current.y);
    if ((dx > 10 || dy > 10) && touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        ...styles.row,
        background: isSelected ? color.accentSubtle : 'transparent',
        paddingLeft: 4 + depth * 14,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = color.surface0; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={styles.chevron}>
        {isFolder ? (
          isOpen ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />
        ) : null}
      </span>
      <FileIcon size={13} strokeWidth={2} style={{ color: iconHue, flexShrink: 0 }} />
      <span style={{
        ...styles.name,
        color: nameColor,
        fontWeight: isSelected ? fontWeight.medium : fontWeight.regular,
      }}>
        {name}
      </span>
      {gitStatus && (
        <span style={{ ...styles.gitTag, color: gitTone(gitStatus) }}>
          {gitStatus === '??' ? 'U' : gitStatus}
        </span>
      )}
    </div>
  );
});

const MenuItem = ({ icon: Icon, label, onClick, tone }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    style={{
      ...styles.menuItem,
      color: tone === 'danger' ? 'var(--ui-danger)' : 'var(--ui-text)',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ui-surface1)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon size={12} strokeWidth={2} style={{ color: tone === 'danger' ? 'var(--ui-danger)' : 'var(--ui-subtext)' }} />
    <span>{label}</span>
  </button>
);

const ContextMenu = ({ x, y, target, t, onClose, onNewFile, onNewFolder, onRename, onDelete, onOpenTerminal }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = x;
      let nextY = y;

      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextX < margin) nextX = margin;

      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;

      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200000,
        ...styles.menu,
        opacity: measured ? 1 : 0,
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={Plus} label={t('newFile') || 'New file'} onClick={onNewFile} />
      <MenuItem icon={Folder} label={t('newFolder') || 'New folder'} onClick={onNewFolder} />
      <MenuItem icon={Terminal} label={t('openTerminalHere') || 'Open terminal here'} onClick={onOpenTerminal} />
      {target.path && (
        <>
          <div style={{ height: '1px', background: 'var(--ui-border)', margin: '4px 0' }} />
          <MenuItem icon={Pencil} label={t('rename') || 'Rename'} onClick={onRename} />
          <MenuItem icon={Trash2} label={t('delete') || 'Delete'} onClick={onDelete} tone="danger" />
        </>
      )}
    </div>
  );
};

const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onRefreshCwd = null, gitContextPath = '', sharedGitChanges = null, language = 'en', initialPath = '', hostId = null }) => {
  const isHostMode = !!hostId;
  const apiBase = isHostMode ? `/api/hosts/${hostId}/files` : '/api/files';
  const { t } = useTranslation(language);

  const [nodes, setNodes] = useState({});
  const [expanded, setExpanded] = useState(new Set(['']));
  const [selectedPath, setSelectedPath] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [creating, setCreating] = useState(null);
  const [filterChangedOnly, setFilterChangedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [rootPath, setRootPath] = useState(isHostMode ? stripHostPathPrefix(initialPath || '') : (initialPath || ''));
  const [rootPathForwardStack, setRootPathForwardStack] = useState([]);
  const [resolvedRoot, setResolvedRoot] = useState(null);
  const [uploadState, setUploadState] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const scrollRafRef = useRef(null);
  const didInitialCwdRefreshRef = useRef(false);
  const creatingCommitRef = useRef(false);
  const renameCommitRef = useRef(false);
  const [listViewport, setListViewport] = useState({ scrollTop: 0, height: 0 });
  const [treeFocus, setTreeFocus] = useState(initialPath || '');
  const effectiveGitPath = gitContextPath || treeFocus;

  const canUseSharedGitChanges = !!sharedGitChanges && !!gitContextPath && effectiveGitPath === gitContextPath;
  const localGitChanges = useGitChanges({
    enabled: !isHostMode && !canUseSharedGitChanges,
    path: effectiveGitPath,
    intervalMs: effectiveGitPath ? 1500 : 8000,
  });
  const { items: gitItems, branch: gitBranch, repo: gitRepo, repos: gitRepos } = canUseSharedGitChanges
    ? sharedGitChanges
    : localGitChanges;
  const changedSet = useMemo(() => new Set((gitItems || []).map((g) => g.path)), [gitItems]);

  const fetchChildren = useCallback(async (cacheKey) => {
    const backendPath = cacheKey === '' ? rootPath : cacheKey;
    setNodes((prev) => ({ ...prev, [cacheKey]: { ...(prev[cacheKey] || {}), loading: true } }));
    try {
      const ts = Date.now();
      const res = await fetch(`${apiBase}?path=${encodeURIComponent(backendPath)}&_t=${ts}`, { headers: authHeader() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes((prev) => ({ ...prev, [cacheKey]: { items: data.items || [], loading: false, error: null } }));
      if (cacheKey === '' && isHostMode && (data.resolved || data.path)) {
        setResolvedRoot(stripHostPathPrefix(data.resolved || data.path));
      }
    } catch (e) {
      setNodes((prev) => ({ ...prev, [cacheKey]: { items: [], loading: false, error: e.message } }));
    }
  }, [apiBase, rootPath, isHostMode]);

  useEffect(() => {
    setNodes({});
    setExpanded(new Set(['']));
    setResolvedRoot(null);
    fetchChildren('');
    if (!isHostMode && initialPath) {
      const parts = initialPath.split('/').filter(Boolean);
      let acc = '';
      const set = new Set(['']);
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        set.add(acc);
        fetchChildren(acc);
      }
      setExpanded(set);
    }
  }, [rootPath, initialPath, isHostMode, fetchChildren]);

  // Outside click to close context menu.
  // contextmenu 는 capture:false 로 — 메뉴 내부에서 stopPropagation 으로 막아 자기 닫힘 방지.
  // (이전엔 capture:true 라 어디서 우클릭하든 무조건 닫혀, 메뉴 내부 텍스트 우클릭 시도 종료.)
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  useEffect(() => { if (renameTarget && renameInputRef.current) { renameInputRef.current.focus(); renameInputRef.current.select(); } }, [renameTarget]);
  useEffect(() => { if (creating && createInputRef.current) createInputRef.current.focus(); }, [creating]);
  useEffect(() => {
    if (!searchOpen) return undefined;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  const toggleFolder = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else { next.add(path); if (!nodes[path]) fetchChildren(path); }
      return next;
    });
    setTreeFocus(path);
    onFolderSelect?.(path);
  }, [nodes, fetchChildren, onFolderSelect]);

  const refreshPath = useCallback(async (path) => await fetchChildren(path), [fetchChildren]);
  const refreshAll = useCallback(async () => {
    const cwdData = onRefreshCwd ? await onRefreshCwd() : null;
    const nextRootPath = isHostMode
      ? (cwdData?.cwd ? stripHostPathPrefix(cwdData.cwd) : null)
      : (cwdData?.in_workspace ? (cwdData.workspace_relative || '') : null);
    if (nextRootPath !== null && nextRootPath !== rootPath) {
      setRootPath(nextRootPath);
      setRootPathForwardStack([]);
      return;
    }
    const paths = Array.from(expanded);
    await Promise.all(paths.map(p => fetchChildren(p)));
  }, [expanded, fetchChildren, isHostMode, onRefreshCwd, rootPath]);

  useEffect(() => {
    if (!onRefreshCwd || didInitialCwdRefreshRef.current) return;
    didInitialCwdRefreshRef.current = true;
    refreshAll();
  }, [onRefreshCwd, refreshAll]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const update = () => setListViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Actions
  const apiCall = async (method, path, body = null) => {
    const url = isHostMode ? `${apiBase}/${method}` : `/api/files/${method}`;
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() } };
    if (method === 'delete') {
      opts.method = 'DELETE';
      const deleteUrl = isHostMode ? `${apiBase}?path=${encodeURIComponent(path)}` : `/api/files?path=${encodeURIComponent(path)}`;
      const res = await fetch(deleteUrl, { headers: authHeader(), method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      return;
    }
    opts.body = JSON.stringify(body || { path });
    const res = await fetch(isHostMode ? `${apiBase}/${method}` : `/api/files/${method}`, opts);
    if (!res.ok) {
      let detail = '';
      try {
        const data = await res.json();
        detail = data?.detail ? `: ${data.detail}` : '';
      } catch { /* ignore non-json error bodies */ }
      throw new Error(`${method} failed${detail}`);
    }
  };

  const uploadFiles = async (files, destPath) => {
    if (!files || files.length === 0) return;
    const total = files.length;
    setUploadState({ current: 0, total, fileName: files[0].name, done: false });
    const uploadBase = isHostMode ? `/api/hosts/${hostId}/files/upload` : '/api/files/upload';
    for (let i = 0; i < total; i++) {
      const fd = new FormData();
      fd.append('dest', destPath || resolvedRoot || rootPath || '');
      fd.append('files', files[i]);
      setUploadState({ current: i, total, fileName: files[i].name, done: false });
      try {
        const res = await fetch(uploadBase, { method: 'POST', headers: authHeader(), body: fd });
        if (!res.ok) throw new Error('upload failed');
      } catch (e) {
        console.error('Upload error:', e);
      }
      if (nodes[destPath]) fetchChildren(destPath);
      else { fetchChildren(''); }
    }
    setUploadState({ current: total, total, fileName: '', done: true });
    setTimeout(() => setUploadState(null), 1500);
  };

  const startCreate = (parentPath, type) => {
    setExpanded((prev) => new Set([...prev, parentPath]));
    if (!nodes[parentPath]) fetchChildren(parentPath);
    setCreating({ parentPath, type, draftName: '' });
  };

  const commitCreate = async () => {
    if (creatingCommitRef.current) return;
    if (!creating) return;
    const { parentPath, type, draftName } = creating;
    if (!draftName.trim()) { setCreating(null); return; }
    const newPath = parentPath ? `${parentPath}/${draftName.trim()}` : draftName.trim();
    creatingCommitRef.current = true;
    setCreating(null);
    try {
      await apiCall('create', newPath, { path: newPath, type });
      await refreshPath(parentPath);
    } catch (e) { alert(e.message); }
    finally { creatingCommitRef.current = false; }
  };

  const commitRename = async () => {
    if (renameCommitRef.current) return;
    if (!renameTarget) return;
    const { path, draftName } = renameTarget;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === path.split('/').pop()) { setRenameTarget(null); return; }
    const dest = path.split('/').slice(0, -1).concat(trimmed).join('/');
    renameCommitRef.current = true;
    setRenameTarget(null);
    try {
      await apiCall('move', path, { source: path, destination: dest });
      await refreshPath(path.split('/').slice(0, -1).join('/'));
    } catch (e) { alert(e.message); }
    finally { renameCommitRef.current = false; }
  };

  const removeNode = async (path) => {
    if (!confirm(t('confirmDeleteFile')?.replace('{name}', path.split('/').pop()) || `Delete ${path}?`)) return;
    try {
      await apiCall('delete', path);
      await refreshPath(path.split('/').slice(0, -1).join('/'));
    } catch (e) { alert(e.message); }
  };

  const hasChangedDescendant = useCallback((folderPath) => {
    if (!folderPath) return changedSet.size > 0;
    const prefix = folderPath + '/';
    for (const p of changedSet) if (p.startsWith(prefix)) return true;
    return false;
  }, [changedSet]);

  const visibleRows = useMemo(() => {
    const rows = [];
    const needle = searchQuery.trim().toLowerCase();
    const walk = (parentPath, depth) => {
      const node = nodes[parentPath];
      if (!node || !node.items) return;
      for (const item of node.items) {
        if (filterChangedOnly) {
          const isChanged = changedSet.has(item.path);
          const folderHasChanges = item.type === 'directory' && hasChangedDescendant(item.path);
          if (!isChanged && !folderHasChanges) continue;
        }
        const matchesSearch = !needle || item.name.toLowerCase().includes(needle);
        const rowIndex = rows.length;
        rows.push({ ...item, depth });
        if (item.type === 'directory') {
          const shouldWalk = needle || expanded.has(item.path);
          if (shouldWalk) {
            const beforeCount = rows.length;
            walk(item.path, depth + 1);
            if (needle && !matchesSearch && rows.length === beforeCount) rows.splice(rowIndex, 1);
          } else if (needle && !matchesSearch) rows.splice(rowIndex, 1);
        } else if (needle && !matchesSearch) rows.pop();
      }
    };
    walk('', 0);
    return rows;
  }, [nodes, expanded, filterChangedOnly, changedSet, hasChangedDescendant, searchQuery]);

  const virtualRows = useMemo(() => {
    const enabled = !creating && visibleRows.length > VIRTUALIZE_AFTER;
    if (!enabled) return { enabled: false, rows: visibleRows, before: 0, after: 0 };
    const viewportHeight = listViewport.height || 1;
    const start = Math.max(0, Math.floor(listViewport.scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const count = Math.ceil(viewportHeight / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const end = Math.min(visibleRows.length, start + count);
    return {
      enabled: true,
      rows: visibleRows.slice(start, end),
      before: start * ROW_HEIGHT,
      after: Math.max(0, (visibleRows.length - end) * ROW_HEIGHT),
    };
  }, [creating, listViewport.height, listViewport.scrollTop, visibleRows]);

  const handleListScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setListViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    });
  }, []);

  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const terminalTargetPath = useMemo(() => {
    if (selectedPath) {
      const type = (Object.values(nodes).flatMap(n => n.items || []).find(it => it.path === selectedPath))?.type;
      if (type === 'directory') return selectedPath;
      if (type === 'file') return selectedPath.split('/').slice(0, -1).join('/');
    }
    return effectiveGitPath || '';
  }, [selectedPath, nodes, effectiveGitPath]);

  const terminalTargetDisplay = useMemo(() => {
    const p = terminalTargetPath;
    if (!p) return isHostMode ? '/' : '~/';
    return isHostMode ? p : `~/${p}`;
  }, [terminalTargetPath, isHostMode]);

  const rootError = nodes['']?.error;
  const rootLoading = nodes['']?.loading && !nodes['']?.items;
  const normalizedInitialPath = isHostMode ? stripHostPathPrefix(initialPath || '') : (initialPath || '');
  const normalizedRootPath = isHostMode ? stripHostPathPrefix(rootPath || '') : rootPath;
  const normalizedResolvedRoot = isHostMode ? stripHostPathPrefix(resolvedRoot || '') : resolvedRoot;
  const parentOfRoot = isHostMode ? computeParent(normalizedResolvedRoot || normalizedRootPath) : computeParent(rootPath);
  const canGoUp = parentOfRoot !== null;
  const rootDisplay = isHostMode ? (normalizedResolvedRoot || (normalizedRootPath || '~')) : (rootPath || '/');
  const searchVisible = searchOpen || !!searchQuery;
  const canGoDown = rootPathForwardStack.length > 0;
  const goUpRoot = () => {
    if (!canGoUp) return;
    const currentRoot = normalizedResolvedRoot || normalizedRootPath || rootPath || '';
    setRootPath(parentOfRoot);
    setRootPathForwardStack((prev) => currentRoot ? [currentRoot, ...prev.filter((p) => p !== currentRoot)].slice(0, 8) : prev);
  };
  const goDownRoot = () => {
    const [nextRoot, ...rest] = rootPathForwardStack;
    if (!nextRoot) return;
    setRootPath(nextRoot);
    setRootPathForwardStack(rest);
  };
  const goHomeRoot = () => {
    setRootPath(normalizedInitialPath);
    setRootPathForwardStack([]);
  };

  return (
    <div
      style={{ ...styles.wrap, ...(dragOver ? { outline: `2px dashed ${color.accent}`, outlineOffset: '-2px', background: `${color.accent}08` } : {}) }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) uploadFiles(files, '');
      }}
    >
      <div style={styles.head}>
        <div style={styles.headBranch} title={rootDisplay}>
          <span style={styles.branchName}>{rootDisplay}</span>
        </div>
        <div style={styles.headActions}>
          <HeadAction icon={ArrowUp} title={t('goUp')} onClick={goUpRoot} disabled={!canGoUp} />
          <HeadAction icon={ArrowDown} title={t('goDown') || 'Go down'} onClick={goDownRoot} disabled={!canGoDown} />
          {isHostMode && normalizedRootPath !== normalizedInitialPath && (
            <HeadAction icon={Home} title={t('home') || 'Home'} onClick={goHomeRoot} />
          )}
          <HeadAction icon={Search} title={t('searchFiles')} onClick={() => setSearchOpen((open) => !open)} active={searchVisible} />
          <HeadAction icon={Filter} title={t('filterChangedOnly')} onClick={() => setFilterChangedOnly(!filterChangedOnly)} active={filterChangedOnly} />
          <HeadAction icon={Plus} title={t('newFile')} onClick={() => startCreate('', 'file')} />
          <HeadAction icon={Folder} title={t('newFolder')} onClick={() => startCreate('', 'directory')} />
          <HeadAction icon={Terminal} title={t('openTerminalHere')} onClick={() => onOpenTerminalAtFolder?.(terminalTargetPath)} />
          <HeadAction icon={RefreshCw} title={t('refresh')} onClick={refreshAll} />
        </div>
      </div>

      <div style={{ ...styles.searchBar, ...(searchVisible ? styles.searchBarOpen : {}) }} aria-hidden={!searchVisible}>
        <Search size={12} style={{ color: color.muted }} />
        <input ref={searchInputRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('searchFiles')} style={styles.searchInput} tabIndex={searchVisible ? 0 : -1} />
        {searchVisible && <button onClick={() => { setSearchQuery(''); setSearchOpen(false); }} style={styles.searchClearBtn}><X size={12} /></button>}
      </div>

      {uploadState && (
        <div style={{ padding: '6px 8px', background: `${color.accent}12`, borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ flex: 1, height: '4px', background: color.surface0, borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${(uploadState.current / Math.max(uploadState.total, 1)) * 100}%`, height: '100%', background: color.accent, borderRadius: '2px', transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ fontSize: '10px', color: color.subtext, whiteSpace: 'nowrap', fontFamily: font.sans }}>
            {uploadState.done ? (t('done') || 'Done') : `${uploadState.current + 1}/${uploadState.total} ${uploadState.fileName}`}
          </span>
        </div>
      )}

      <div ref={listRef} style={styles.list} onScroll={handleListScroll} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: '', type: 'directory' } }); }}>
        {rootError && (
          <div style={styles.errorBox}>
            <div style={{ fontSize: fontSize['13'], color: color.subtext, fontWeight: fontWeight.medium }}>
              {t('couldNotLoadFiles') || 'Could not load files'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: color.muted, fontFamily: font.mono, wordBreak: 'break-all' }}>
              {rootError}
            </div>
            <button onClick={() => fetchChildren('')} style={styles.retryBtn}>
              {t('retry') || 'Retry'}
            </button>
          </div>
        )}
        {rootLoading && !rootError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 4px' }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: `${ROW_HEIGHT}px`, paddingLeft: `${4 + (i > 3 ? 14 : 0)}px` }}>
                {(i === 0 || i > 3) && <SkeletonRow width="13px" height="13px" borderRadius="2px" />}
                <SkeletonRow width={`${55 + ((i * 7) % 30)}%`} height="13px" />
              </div>
            ))}
          </div>
        )}
        
        {creating && creating.parentPath === '' && (
          <div style={{ ...styles.row, background: color.crust }}>
            <span style={styles.chevron} />
            {creating.type === 'directory' ? <Folder size={13} style={{ color: color.accent }} /> : <File size={13} />}
            <input ref={createInputRef} value={creating.draftName} onChange={(e) => setCreating({ ...creating, draftName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(); else if (e.key === 'Escape') setCreating(null); }} onBlur={commitCreate} style={styles.editInput} />
          </div>
        )}

        {virtualRows.enabled && <div style={{ ...styles.virtualSpacer, height: virtualRows.before }} />}
        {virtualRows.rows.map((row) => (
          <div key={row.path}>
            {renameTarget?.path === row.path ? (
              <div style={{ ...styles.row, background: color.crust, paddingLeft: 4 + row.depth * 14 }}>
                <span style={styles.chevron} />
                {row.type === 'directory' ? <Folder size={13} style={{ color: color.accent }} /> : <File size={13} />}
                <input ref={renameInputRef} value={renameTarget.draftName} onChange={(e) => setRenameTarget({ ...renameTarget, draftName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenameTarget(null); }} onBlur={commitRename} style={styles.editInput} />
              </div>
            ) : (
              <Row
                depth={row.depth} isOpen={row.type === 'directory' && expanded.has(row.path)} isFolder={row.type === 'directory'} isSelected={selectedPath === row.path} name={row.name} tone={row.git_status ? gitTone(row.git_status) : (selectedPath === row.path ? color.text : color.subtext)} gitStatus={row.git_status} isChanged={changedSet.has(row.path)}
                onClick={() => { setSelectedPath(row.path); if (row.type === 'directory') toggleFolder(row.path); else onFileSelect?.(row.path, hostId); }}
                onDoubleClick={() => { if (row.type !== 'directory') onFileSelect?.(row.path, hostId); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedPath(row.path); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: row.path, type: row.type } }); }}
              />
            )}
            {creating && creating.parentPath === row.path && (expanded.has(row.path) || searchQuery) && (
               <div style={{ ...styles.row, background: color.crust, paddingLeft: 4 + (row.depth + 1) * 14 }}>
                <span style={styles.chevron} />
                {creating.type === 'directory' ? <Folder size={13} style={{ color: color.accent }} /> : <File size={13} />}
                <input ref={createInputRef} value={creating.draftName} onChange={(e) => setCreating({ ...creating, draftName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(); else if (e.key === 'Escape') setCreating(null); }} onBlur={commitCreate} style={styles.editInput} />
              </div>
            )}
          </div>
        ))}
        {virtualRows.enabled && <div style={{ ...styles.virtualSpacer, height: virtualRows.after }} />}

        {!rootLoading && !rootError && visibleRows.length === 0 && !creating && (
          <div style={styles.statusBox}><Search size={16} /><span style={{ marginTop: '4px' }}>{searchQuery ? t('noResults') : t('folderEmpty')}</span></div>
        )}
      </div>

      {contextMenu && createPortal(
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} target={contextMenu.target} t={t} onClose={() => setContextMenu(null)}
          onNewFile={() => { startCreate(contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'), 'file'); setContextMenu(null); }}
          onNewFolder={() => { startCreate(contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'), 'directory'); setContextMenu(null); }}
          onRename={() => { if (contextMenu.target.path) setRenameTarget({ path: contextMenu.target.path, draftName: contextMenu.target.path.split('/').pop() }); setContextMenu(null); }}
          onDelete={() => { if (contextMenu.target.path) removeNode(contextMenu.target.path); setContextMenu(null); }}
          onOpenTerminal={() => { const p = contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'); onOpenTerminalAtFolder?.(p); setContextMenu(null); }}
        />,
        document.body
      )}
    </div>
  );
};

const HeadAction = ({ icon: Icon, title, onClick, active, disabled = false }) => (
  <button onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(); }} onContextMenu={(e) => e.stopPropagation()} title={title} disabled={disabled} style={{ ...styles.headActionBtn, color: active ? color.accent : color.muted, background: active ? color.accentSubtle : 'transparent', opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
    <Icon size={12} strokeWidth={2} />
  </button>
);

export default FileTree;
