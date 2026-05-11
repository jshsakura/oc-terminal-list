import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, FolderOpen, File, FileText, FileCode, FileImage, FileJson, FileType,
  RefreshCw, Terminal, ChevronRight, ChevronDown, Plus, Pencil, Trash2, GitBranch, Filter,
  ArrowUp, Home, Search, X
} from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion, shadow: designShadow } = tokens;

const ROW_HEIGHT = 24;

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
    minHeight: '32px',
    gap: space['2'],
  },
  crumb: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1']} ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.crust,
    minHeight: '28px',
    overflow: 'hidden',
  },
  crumbBtn: {
    width: '22px',
    height: '22px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    color: color.subtext,
    transition: `background ${motion.fast}`,
    padding: 0,
  },
  crumbPath: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.mono,
    fontSize: fontSize['11'],
    color: color.subtext,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'rtl',
    textAlign: 'left',
  },
  headBranch: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
  },
  branchName: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.subtext,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
  headActions: { display: 'flex', gap: '2px' },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `0 ${space['2']} ${space['1.5']}`,
    borderBottom: `1px solid ${color.border}`,
    background: 'transparent',
  },
  searchInput: {
    flex: 1,
    height: '24px',
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
  footerBar: {
    padding: `${space['1.5']} ${space['1.5']} ${space['2']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.crust,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  footerCaption: {
    fontSize: '10.5px',
    fontWeight: fontWeight.semibold,
    color: color.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    paddingLeft: '2px',
  },
  footerRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: space['1.5'],
    width: '100%',
    minWidth: 0,
  },
  footerPathBox: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    height: '30px',
    padding: `0 ${space['2']}`,
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  footerPath: {
    display: 'block',
    flex: 1,
    minWidth: 0,
    fontFamily: font.mono,
    fontSize: '11.5px',
    color: color.text,
    opacity: 0.92,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    unicodeBidi: 'plaintext',
  },
  footerActionBtn: {
    flexShrink: 0,
    width: '34px',
    height: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.accent,
    color: color.crust,
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
    transition: 'opacity 120ms ease',
    padding: 0,
  },
  menu: {
    background: color.base,
    border: `1px solid ${color.border}`,
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
      color: tone === 'danger' ? color.danger : color.text,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon size={12} strokeWidth={2} style={{ color: tone === 'danger' ? color.danger : color.muted }} />
    <span>{label}</span>
  </button>
);

const ContextMenu = ({ x, y, target, t, onClose, onNewFile, onNewFolder, onRename, onDelete, onOpenTerminal }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

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
        opacity: pos.x === x && pos.y === y && ref.current ? 0 : 1,
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={Plus} label={t('newFile') || 'New file'} onClick={onNewFile} />
      <MenuItem icon={Folder} label={t('newFolder') || 'New folder'} onClick={onNewFolder} />
      <MenuItem icon={Terminal} label={t('openTerminalHere') || 'Open terminal here'} onClick={onOpenTerminal} />
      {target.path && (
        <>
          <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />
          <MenuItem icon={Pencil} label={t('rename') || 'Rename'} onClick={onRename} />
          <MenuItem icon={Trash2} label={t('delete') || 'Delete'} onClick={onDelete} tone="danger" />
        </>
      )}
    </div>
  );
};

const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, gitContextPath = '', language = 'en', initialPath = '', hostId = null }) => {
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
  const [rootPath, setRootPath] = useState(initialPath || '');
  const [resolvedRoot, setResolvedRoot] = useState(null);
  
  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);
  const [treeFocus, setTreeFocus] = useState(initialPath || '');
  const effectiveGitPath = gitContextPath || treeFocus;

  // Git changes hook
  const { items: gitItems, branch: gitBranch, repo: gitRepo, repos: gitRepos } = useGitChanges({
    enabled: !isHostMode,
    path: effectiveGitPath,
    intervalMs: effectiveGitPath ? 1500 : 8000,
  });
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
        setResolvedRoot(data.resolved || data.path);
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

  // Outside click to close context menu
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close, { capture: true });
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close, { capture: true });
    };
  }, [contextMenu]);

  useEffect(() => { if (renameTarget && renameInputRef.current) { renameInputRef.current.focus(); renameInputRef.current.select(); } }, [renameTarget]);
  useEffect(() => { if (creating && createInputRef.current) createInputRef.current.focus(); }, [creating]);

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
    const paths = Array.from(expanded);
    await Promise.all(paths.map(p => fetchChildren(p)));
  }, [expanded, fetchChildren]);

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
    if (!res.ok) throw new Error('action failed');
  };

  const startCreate = (parentPath, type) => {
    setExpanded((prev) => new Set([...prev, parentPath]));
    if (!nodes[parentPath]) fetchChildren(parentPath);
    setCreating({ parentPath, type, draftName: '' });
  };

  const commitCreate = async () => {
    if (!creating) return;
    const { parentPath, type, draftName } = creating;
    if (!draftName.trim()) { setCreating(null); return; }
    const newPath = parentPath ? `${parentPath}/${draftName.trim()}` : draftName.trim();
    try {
      await apiCall('create', newPath, { path: newPath, type });
      setCreating(null);
      await refreshPath(parentPath);
    } catch (e) { alert(e.message); }
  };

  const commitRename = async () => {
    if (!renameTarget) return;
    const { path, draftName } = renameTarget;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === path.split('/').pop()) { setRenameTarget(null); return; }
    const dest = path.split('/').slice(0, -1).concat(trimmed).join('/');
    try {
      await apiCall('move', path, { source: path, destination: dest });
      setRenameTarget(null);
      await refreshPath(path.split('/').slice(0, -1).join('/'));
    } catch (e) { alert(e.message); }
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
  const parentOfRoot = isHostMode ? computeParent(resolvedRoot) : computeParent(rootPath);
  const canGoUp = parentOfRoot !== null;
  const rootDisplay = isHostMode ? (resolvedRoot || (rootPath || '~')) : (rootPath || '/');

  return (
    <div style={styles.wrap}>
      {isHostMode && (
        <div style={styles.crumb} title={rootDisplay}>
          <button onClick={() => canGoUp && setRootPath(parentOfRoot)} disabled={!canGoUp} style={{ ...styles.crumbBtn, opacity: canGoUp ? 1 : 0.35, cursor: canGoUp ? 'pointer' : 'not-allowed' }}>
            <ArrowUp size={12} strokeWidth={2} />
          </button>
          {rootPath !== (initialPath || '') && (
            <button onClick={() => setRootPath(initialPath || '')} style={{ ...styles.crumbBtn, cursor: 'pointer' }}>
              <Home size={12} strokeWidth={2} />
            </button>
          )}
          <span style={styles.crumbPath}>{rootDisplay}</span>
        </div>
      )}

      <div style={styles.head}>
        <div style={styles.headBranch}>
          <GitBranch size={11} strokeWidth={2} style={{ color: (gitRepo || gitRepos?.length) ? color.muted : color.faint }} />
          <span style={styles.branchName}>{gitBranch || (gitRepos?.length ? `${gitRepos.length} repos` : 'no git')}</span>
        </div>
        <div style={styles.headActions}>
          <HeadAction icon={ArrowUp} title={t('goUp')} onClick={() => canGoUp && setRootPath(parentOfRoot)} disabled={!canGoUp} />
          <HeadAction icon={Filter} title={t('filterChangedOnly')} onClick={() => setFilterChangedOnly(!filterChangedOnly)} active={filterChangedOnly} />
          <HeadAction icon={Plus} title={t('newFile')} onClick={() => startCreate('', 'file')} />
          <HeadAction icon={Folder} title={t('newFolder')} onClick={() => startCreate('', 'directory')} />
          <HeadAction icon={Terminal} title={t('openTerminalHere')} onClick={() => onOpenTerminalAtFolder?.(terminalTargetPath)} />
          <HeadAction icon={RefreshCw} title={t('refresh')} onClick={refreshAll} />
        </div>
      </div>

      <div style={styles.searchBar}>
        <Search size={12} style={{ color: color.muted }} />
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('searchFiles')} style={styles.searchInput} />
        {searchQuery && <button onClick={() => setSearchQuery('')} style={styles.searchClearBtn}><X size={12} /></button>}
      </div>

      <div style={styles.list} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: '', type: 'directory' } }); }}>
        {rootError && <div style={styles.errorBox}><div>Error: {rootError}</div><button onClick={() => fetchChildren('')} style={styles.retryBtn}>{t('retry')}</button></div>}
        {rootLoading && !rootError && <div style={styles.statusBox}><RefreshCw size={14} className="spin" /><span>{t('loading')}</span></div>}
        
        {creating && creating.parentPath === '' && (
          <div style={{ ...styles.row, background: color.crust }}>
            <span style={styles.chevron} />
            {creating.type === 'directory' ? <Folder size={13} style={{ color: color.accent }} /> : <File size={13} />}
            <input ref={createInputRef} value={creating.draftName} onChange={(e) => setCreating({ ...creating, draftName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(); else if (e.key === 'Escape') setCreating(null); }} onBlur={commitCreate} style={styles.editInput} />
          </div>
        )}

        {visibleRows.map((row) => (
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
                onClick={() => { setSelectedPath(row.path); if (row.type === 'directory') toggleFolder(row.path); else onFileSelect?.(row.path); }}
                onDoubleClick={() => { if (row.type !== 'directory') onFileSelect?.(row.path); }}
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

        {!rootLoading && !rootError && visibleRows.length === 0 && !creating && (
          <div style={styles.statusBox}><Search size={16} /><span style={{ marginTop: '4px' }}>{searchQuery ? t('noResults') : t('folderEmpty')}</span></div>
        )}
      </div>

      <div style={styles.footerBar}>
        <div style={styles.footerCaption}>{t('openTerminalHere')}</div>
        <div style={styles.footerRow}>
          <div style={styles.footerPathBox} title={terminalTargetDisplay}><span style={styles.footerPath}>{terminalTargetDisplay}</span></div>
          <button onClick={() => onOpenTerminalAtFolder?.(terminalTargetPath)} style={styles.footerActionBtn}><Terminal size={14} strokeWidth={2.2} /></button>
        </div>
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
