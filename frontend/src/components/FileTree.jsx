import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, FolderOpen, File, FileText, FileCode, FileImage, FileJson, FileType,
  RefreshCw, Terminal, ChevronRight, ChevronDown, Plus, Pencil, Trash2,
} from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const ROW_HEIGHT = 24;

// 파일 확장자 → 아이콘
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

const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, language = 'en', initialPath = '' }) => {
  const { t } = useTranslation(language);
  // 노드별 캐시: path → { items: [{name,path,type,git_status}], loading, error }
  const [nodes, setNodes] = useState({});
  const [expanded, setExpanded] = useState(new Set(['']));
  const [selectedPath, setSelectedPath] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // {x,y,target:{path,type}}
  const [renameTarget, setRenameTarget] = useState(null); // {path, draftName}
  const [creating, setCreating] = useState(null); // {parentPath, type:'file'|'directory', draftName}
  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);

  const fetchChildren = useCallback(async (path) => {
    setNodes((prev) => ({ ...prev, [path]: { ...(prev[path] || {}), loading: true } }));
    try {
      const ts = Date.now();
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}&_t=${ts}`, { headers: authHeader() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes((prev) => ({ ...prev, [path]: { items: data.items || [], loading: false, error: null } }));
    } catch (e) {
      setNodes((prev) => ({ ...prev, [path]: { items: [], loading: false, error: e.message } }));
    }
  }, []);

  // 첫 마운트: 루트 + initialPath 까지 expand
  useEffect(() => {
    fetchChildren('');
    if (initialPath) {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 컨텍스트 메뉴 외부 클릭 시 닫기
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

  useEffect(() => {
    if (renameTarget && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameTarget]);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [creating]);

  const toggleFolder = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!nodes[path]) fetchChildren(path);
      }
      return next;
    });
    onFolderSelect?.(path);
  }, [nodes, fetchChildren, onFolderSelect]);

  const refreshPath = useCallback(async (path) => {
    await fetchChildren(path);
  }, [fetchChildren]);

  const refreshAll = useCallback(async () => {
    const paths = Array.from(expanded);
    await Promise.all(paths.map(fetchChildren));
  }, [expanded, fetchChildren]);

  // ---------- 작업: 생성 / 이름변경 / 삭제 ----------
  const apiCreate = async (path, type) => {
    const res = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ path, type }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'create failed');
  };

  const apiMove = async (source, destination) => {
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ source, destination }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'move failed');
  };

  const apiDelete = async (path) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE', headers: authHeader() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'delete failed');
  };

  const startCreate = (parentPath, type) => {
    setExpanded((prev) => new Set([...prev, parentPath]));
    if (!nodes[parentPath]) fetchChildren(parentPath);
    setCreating({ parentPath, type, draftName: '' });
  };

  const commitCreate = async () => {
    if (!creating) return;
    const { parentPath, type, draftName } = creating;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setCreating(null);
      return;
    }
    const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    try {
      await apiCreate(newPath, type);
      setCreating(null);
      await refreshPath(parentPath);
    } catch (e) {
      alert(e.message);
    }
  };

  const startRename = (path) => {
    const name = path.split('/').pop();
    setRenameTarget({ path, draftName: name });
  };

  const commitRename = async () => {
    if (!renameTarget) return;
    const { path, draftName } = renameTarget;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === path.split('/').pop()) {
      setRenameTarget(null);
      return;
    }
    const parts = path.split('/');
    parts[parts.length - 1] = trimmed;
    const dest = parts.join('/');
    try {
      await apiMove(path, dest);
      setRenameTarget(null);
      const parent = path.split('/').slice(0, -1).join('/');
      await refreshPath(parent);
    } catch (e) {
      alert(e.message);
    }
  };

  const removeNode = async (path, type) => {
    if (!confirm(t('confirmDeleteFile')?.replace('{name}', path.split('/').pop()) || `Delete ${path}?`)) return;
    try {
      await apiDelete(path);
      const parent = path.split('/').slice(0, -1).join('/');
      await refreshPath(parent);
    } catch (e) {
      alert(e.message);
    }
  };

  // ---------- 트리 평면화 (depth 포함) ----------
  const visibleRows = useMemo(() => {
    const rows = [];
    const walk = (parentPath, depth) => {
      const node = nodes[parentPath];
      if (!node || !node.items) return;
      for (const item of node.items) {
        rows.push({ ...item, depth });
        if (item.type === 'directory' && expanded.has(item.path)) {
          walk(item.path, depth + 1);
        }
      }
    };
    walk('', 0);
    return rows;
  }, [nodes, expanded]);

  const rootError = nodes['']?.error;
  const rootLoading = nodes['']?.loading && !nodes['']?.items;

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <span style={styles.headLabel}>{t('explorer') || 'Explorer'}</span>
        <div style={styles.headActions}>
          <HeadAction icon={Plus} title={t('newFile') || 'New file'} onClick={() => startCreate('', 'file')} />
          <HeadAction icon={Folder} title={t('newFolder') || 'New folder'} onClick={() => startCreate('', 'directory')} />
          <HeadAction icon={Terminal} title={t('focusTerminal') || 'Open terminal here'} onClick={() => onOpenTerminalAtFolder?.('')} />
          <HeadAction icon={RefreshCw} title={t('refresh') || 'Refresh'} onClick={refreshAll} />
        </div>
      </div>

      <div
        style={styles.list}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, target: { path: '', type: 'directory' } });
        }}
      >
        {rootError && (
          <div style={styles.errorBox}>
            <div>Error: {rootError}</div>
            <button onClick={() => fetchChildren('')} style={styles.retryBtn}>{t('retry') || 'Retry'}</button>
          </div>
        )}

        {rootLoading && !rootError && (
          <div style={styles.muted}>{t('loading') || 'Loading…'}</div>
        )}

        {/* 루트에 새 항목 입력중 */}
        {creating && creating.parentPath === '' && (
          <CreateRow
            depth={0}
            type={creating.type}
            value={creating.draftName}
            inputRef={createInputRef}
            onChange={(v) => setCreating({ ...creating, draftName: v })}
            onCommit={commitCreate}
            onCancel={() => setCreating(null)}
          />
        )}

        {visibleRows.map((row) => {
          const isFolder = row.type === 'directory';
          const isOpen = isFolder && expanded.has(row.path);
          const isSelected = selectedPath === row.path;
          const tone = row.git_status ? gitTone(row.git_status) : (isSelected ? color.text : color.subtext);
          return (
            <div key={row.path}>
              {/* 본 행 또는 인라인 rename */}
              {renameTarget?.path === row.path ? (
                <RenameRow
                  depth={row.depth}
                  isFolder={isFolder}
                  value={renameTarget.draftName}
                  inputRef={renameInputRef}
                  onChange={(v) => setRenameTarget({ ...renameTarget, draftName: v })}
                  onCommit={commitRename}
                  onCancel={() => setRenameTarget(null)}
                />
              ) : (
                <Row
                  depth={row.depth}
                  isOpen={isOpen}
                  isFolder={isFolder}
                  isSelected={isSelected}
                  name={row.name}
                  tone={tone}
                  gitStatus={row.git_status}
                  onClick={() => {
                    setSelectedPath(row.path);
                    if (isFolder) {
                      toggleFolder(row.path);
                    } else {
                      onFileSelect?.(row.path);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedPath(row.path);
                    setContextMenu({ x: e.clientX, y: e.clientY, target: { path: row.path, type: row.type } });
                  }}
                />
              )}

              {/* 이 폴더 안에 새 항목 입력중 */}
              {creating && creating.parentPath === row.path && isOpen && (
                <CreateRow
                  depth={row.depth + 1}
                  type={creating.type}
                  value={creating.draftName}
                  inputRef={createInputRef}
                  onChange={(v) => setCreating({ ...creating, draftName: v })}
                  onCommit={commitCreate}
                  onCancel={() => setCreating(null)}
                />
              )}
            </div>
          );
        })}

        {!rootLoading && !rootError && visibleRows.length === 0 && !creating && (
          <div style={styles.muted}>{t('folderEmpty') || 'Empty folder'}</div>
        )}
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          t={t}
          onClose={() => setContextMenu(null)}
          onNewFile={() => {
            startCreate(contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'), 'file');
            setContextMenu(null);
          }}
          onNewFolder={() => {
            startCreate(contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'), 'directory');
            setContextMenu(null);
          }}
          onRename={() => {
            if (contextMenu.target.path) startRename(contextMenu.target.path);
            setContextMenu(null);
          }}
          onDelete={() => {
            if (contextMenu.target.path) removeNode(contextMenu.target.path, contextMenu.target.type);
            setContextMenu(null);
          }}
          onOpenTerminal={() => {
            const p = contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/');
            onOpenTerminalAtFolder?.(p);
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
};

// ---------- 보조 컴포넌트 ----------

const Row = ({ depth, isOpen, isFolder, isSelected, name, tone, gitStatus, onClick, onContextMenu }) => {
  const FileIcon = isFolder ? (isOpen ? FolderOpen : Folder) : iconForFile(name);
  const iconHue = isFolder ? color.accent : fileIconColor(name);
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
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
      <span style={{ ...styles.name, color: tone, fontWeight: isSelected ? fontWeight.medium : fontWeight.regular }}>
        {name}
      </span>
      {gitStatus && (
        <span style={{ ...styles.gitTag, color: gitTone(gitStatus) }}>
          {gitStatus === '??' ? 'U' : gitStatus}
        </span>
      )}
    </div>
  );
};

const RenameRow = ({ depth, isFolder, value, onChange, onCommit, onCancel, inputRef }) => (
  <div style={{ ...styles.row, paddingLeft: 4 + depth * 14, background: color.crust }}>
    <span style={styles.chevron} />
    {isFolder ? <Folder size={13} strokeWidth={2} style={{ color: color.accent }} /> : <File size={13} strokeWidth={2} style={{ color: color.muted }} />}
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCommit}
      style={styles.editInput}
    />
  </div>
);

const CreateRow = ({ depth, type, value, onChange, onCommit, onCancel, inputRef }) => (
  <div style={{ ...styles.row, paddingLeft: 4 + depth * 14, background: color.crust }}>
    <span style={styles.chevron} />
    {type === 'directory' ? <Folder size={13} strokeWidth={2} style={{ color: color.accent }} /> : <File size={13} strokeWidth={2} style={{ color: color.muted }} />}
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCommit}
      placeholder={type === 'directory' ? 'folder name' : 'file name'}
      style={styles.editInput}
    />
  </div>
);

const HeadAction = ({ icon: Icon, title, onClick }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    title={title}
    style={styles.headActionBtn}
    onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
  >
    <Icon size={12} strokeWidth={2} />
  </button>
);

const ContextMenu = ({ x, y, target, t, onClose, onNewFile, onNewFolder, onRename, onDelete, onOpenTerminal }) => {
  const isFile = target.type === 'file';
  return (
    <div
      style={{
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 240),
        left: Math.min(x, window.innerWidth - 200),
        zIndex: 200000,
        ...styles.menu,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={Plus} label={t('newFile') || 'New file'} onClick={onNewFile} />
      <MenuItem icon={Folder} label={t('newFolder') || 'New folder'} onClick={onNewFolder} />
      <MenuItem icon={Terminal} label={t('focusTerminal') || 'Open terminal here'} onClick={onOpenTerminal} />
      {target.path && (
        <>
          <MenuDivider />
          <MenuItem icon={Pencil} label={t('rename') || 'Rename'} onClick={onRename} />
          <MenuItem icon={Trash2} label={t('delete') || 'Delete'} onClick={onDelete} tone="danger" />
        </>
      )}
    </div>
  );
};

const MenuItem = ({ icon: Icon, label, onClick, tone }) => (
  <button
    onClick={onClick}
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

const MenuDivider = () => <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />;

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
  },
  headLabel: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.muted,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  headActions: { display: 'flex', gap: '2px' },
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
  muted: {
    padding: `${space['4']} ${space['3']}`,
    textAlign: 'center',
    color: color.muted,
    fontSize: fontSize['12'],
  },
  menu: {
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    boxShadow: tokens.shadow.lg,
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
};

export default FileTree;
