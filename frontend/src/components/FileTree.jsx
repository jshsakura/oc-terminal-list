import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, File, RefreshCw, Terminal, Plus, Filter,
  ArrowUp, ArrowDown, Home, Search, X, Upload,
} from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import useGitChanges from '../hooks/useGitChanges';
import useFileDownload from '../hooks/useFileDownload';
import useFileUpload from '../hooks/useFileUpload';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';
import { authHeaders } from '../utils/auth';
import { ROW_HEIGHT, VIRTUALIZE_AFTER, VIRTUAL_OVERSCAN } from './filetree/fileTreeConstants';
import { styles } from './filetree/fileTreeStyles';
import { gitTone, computeParent, stripHostPathPrefix } from './filetree/fileTreeHelpers';
import { Row, ContextMenu, HeadAction } from './filetree/FileTreeParts';

const { color, font, fontSize, fontWeight } = tokens;


const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onRefreshCwd = null, gitContextPath = '', sharedGitChanges = null, language = 'en', initialPath = '', hostId = null }) => {
  const isHostMode = !!hostId;
  const apiBase = isHostMode ? `/api/hosts/${hostId}/files` : '/api/files';
  const { t } = useTranslation(language);

  const [nodes, setNodes] = useState({});
  const [expanded, setExpanded] = useState(new Set(['']));
  const [selectedPath, setSelectedPath] = useState(null);
  // 다중선택: ctrl/cmd 클릭 토글 + shift 범위. selectedPath 는 "주(primary)" 선택(컨텍스트/리네임 대상).
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const selectionAnchorRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [creating, setCreating] = useState(null);
  const [filterChangedOnly, setFilterChangedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [rootPath, setRootPath] = useState(isHostMode ? stripHostPathPrefix(initialPath || '') : (initialPath || ''));
  const [rootPathForwardStack, setRootPathForwardStack] = useState([]);
  const [resolvedRoot, setResolvedRoot] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const renameInputRef = useRef(null);
  const createInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadDestRef = useRef('');
  const listRef = useRef(null);
  const scrollRafRef = useRef(null);
  const didInitialCwdRefreshRef = useRef(false);
  const creatingCommitRef = useRef(false);
  const renameCommitRef = useRef(false);
  const contextMenuOpenRef = useRef(false);
  const closeContextMenuRef = useRef(() => {});
  // root('') fetch 실패 시 자동 백오프 재시도 — 호스트 일시 unreachable / 첫 마운트 타이밍 등에서
  // 빈 트리로 박혀버리는 걸 막는다. 성공하면 attempt 리셋, rootPath 바뀌면 타이머 취소.
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const [retryNotice, setRetryNotice] = useState(null); // 다음 재시도까지 남은 초 (UX 안내용)
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
      const res = await fetch(`${apiBase}?path=${encodeURIComponent(backendPath)}&_t=${ts}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes((prev) => ({ ...prev, [cacheKey]: { items: data.items || [], loading: false, error: null } }));
      if (cacheKey === '' && isHostMode && (data.resolved || data.path)) {
        setResolvedRoot(stripHostPathPrefix(data.resolved || data.path));
      }
      // 루트 성공 → 백오프 상태 리셋
      if (cacheKey === '') {
        retryAttemptRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setRetryNotice(null);
      }
    } catch (e) {
      setNodes((prev) => ({ ...prev, [cacheKey]: { items: [], loading: false, error: e.message } }));
      // 루트 실패 → 백오프(2/4/8/16/30s) 자동 재시도. 사용자가 다른 일 하는 동안 호스트 회복 시
      // 자동으로 트리가 채워지도록 한다. children 단위는 사용자가 펼칠 때 재시도되므로 제외.
      if (cacheKey === '') {
        const attempt = retryAttemptRef.current;
        const delayMs = Math.min(2000 * Math.pow(2, attempt), 30000);
        retryAttemptRef.current = attempt + 1;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        setRetryNotice(Math.round(delayMs / 1000));
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setRetryNotice(null);
          fetchChildren('');
        }, delayMs);
      }
    }
  }, [apiBase, rootPath, isHostMode]);

  useEffect(() => {
    setNodes({});
    setExpanded(new Set(['']));
    setResolvedRoot(null);
    // rootPath 가 바뀌면 이전 백오프 타이머/카운트는 무효 — 새 컨텍스트로 시작.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
    setRetryNotice(null);
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

  // unmount 시 백오프 타이머 정리 — 사라진 컴포넌트가 fetch 를 다시 트리거하면 안 됨.
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  closeContextMenuRef.current = () => setContextMenu(null);
  contextMenuOpenRef.current = !!contextMenu;

  useEffect(() => {
    const close = () => {
      if (contextMenuOpenRef.current) closeContextMenuRef.current();
    };
    const id = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, []);

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
    const opts = { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) };
    if (method === 'delete') {
      opts.method = 'DELETE';
      const deleteUrl = isHostMode ? `${apiBase}?path=${encodeURIComponent(path)}` : `/api/files?path=${encodeURIComponent(path)}`;
      const res = await fetch(deleteUrl, { headers: authHeaders(), method: 'DELETE' });
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

  const uploadUrl = isHostMode ? `/api/hosts/${hostId}/files/upload` : '/api/files/upload';
  const { uploadState, uploadFiles: _uploadFilesRaw } = useFileUpload({
    uploadUrl,
    t,
    onUploadComplete: (destPath) => {
      if (destPath && nodes[destPath]) fetchChildren(destPath);
      else fetchChildren('');
    },
  });
  const uploadFiles = (files, destPath = null) => {
    const targetDest = destPath ?? (isHostMode
      ? (normalizedResolvedRoot || normalizedRootPath || rootPath || '')
      : (rootPath || ''));
    return _uploadFilesRaw(files, targetDest);
  };

  const openUploadPicker = (destPath = null) => {
    uploadDestRef.current = destPath ?? (isHostMode
      ? (normalizedResolvedRoot || normalizedRootPath || rootPath || '')
      : (rootPath || ''));
    fileInputRef.current?.click();
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

  // 다중 삭제 — 한 번만 확인하고 전부 지운 뒤 영향 받은 부모 폴더만 새로고침.
  const removeNodes = async (paths) => {
    const list = [...new Set(paths)].filter(Boolean);
    if (!list.length) return;
    if (list.length === 1) return removeNode(list[0]);
    const msg = t('confirmDeleteMultiple')?.replace('{count}', String(list.length))
      || `Delete ${list.length} items?`;
    if (!confirm(msg)) return;
    const parents = new Set();
    for (const p of list) {
      try {
        await apiCall('delete', p);
        parents.add(p.split('/').slice(0, -1).join('/'));
      } catch (e) { alert(e.message); }
    }
    for (const parent of parents) await refreshPath(parent);
    setSelectedPaths(new Set());
  };

  const { downloadState, downloadNode, downloadZip } = useFileDownload({ apiBase, t });

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

  // 행 클릭 — 일반(단일선택+열기/펼치기), ctrl/cmd(토글), shift(범위).
  const handleRowClick = (e, row) => {
    listRef.current?.focus({ preventScroll: true }); // 키보드(Ctrl+A/Esc/Delete) 활성화
    const additive = e.ctrlKey || e.metaKey;
    const ranged = e.shiftKey && selectionAnchorRef.current;
    if (additive) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(row.path)) next.delete(row.path); else next.add(row.path);
        return next;
      });
      setSelectedPath(row.path);
      selectionAnchorRef.current = row.path;
      return;
    }
    if (ranged) {
      const order = visibleRows.map((r) => r.path);
      const a = order.indexOf(selectionAnchorRef.current);
      const b = order.indexOf(row.path);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedPaths(new Set(order.slice(lo, hi + 1)));
        setSelectedPath(row.path);
        return;
      }
    }
    // 일반 클릭: 단일선택. 폴더는 펼치기, 파일은 "선택만"(열기는 더블클릭).
    setSelectedPath(row.path);
    setSelectedPaths(new Set([row.path]));
    selectionAnchorRef.current = row.path;
    if (row.type === 'directory') toggleFolder(row.path);
  };

  // 우클릭 — 다중선택 안에서 누르면 선택 유지, 아니면 그 행으로 단일화.
  const handleRowContextMenu = (e, row) => {
    e.preventDefault();
    e.stopPropagation();
    if (!(selectedPaths.size > 1 && selectedPaths.has(row.path))) {
      setSelectedPath(row.path);
      setSelectedPaths(new Set([row.path]));
      selectionAnchorRef.current = row.path;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, target: { path: row.path, type: row.type } });
  };

  // 컨텍스트 메뉴 액션 대상 경로들 — 우클릭 행이 다중선택에 포함되면 선택 전체, 아니면 단건.
  const contextTargets = () => {
    const path = contextMenu?.target?.path;
    if (!path) return [];
    return selectedPaths.size > 1 && selectedPaths.has(path) ? [...selectedPaths] : [path];
  };

  // 트리 키보드 — Ctrl/Cmd+A 전체선택, Esc 해제, Delete/Backspace 일괄삭제.
  const handleTreeKeyDown = (e) => {
    if (e.target.tagName === 'INPUT') return; // 검색/리네임/생성 입력 중엔 무시
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      setSelectedPaths(new Set(visibleRows.map((r) => r.path)));
      return;
    }
    if (e.key === 'Escape') {
      if (selectedPaths.size) setSelectedPaths(new Set());
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const targets = selectedPaths.size ? [...selectedPaths] : (selectedPath ? [selectedPath] : []);
      if (targets.length) { e.preventDefault(); removeNodes(targets); }
    }
  };

  // 폴더 이동 시 이전 선택 잔상 제거.
  useEffect(() => {
    setSelectedPaths(new Set());
    setSelectedPath(null);
  }, [rootPath]);

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
  const renderTransferBar = (state, key) => {
    if (!state) return null;
    const tone = state.error ? color.danger : (state.done ? color.success : color.accent);
    const progress = state.done || state.error
      ? 100
      : state.total
        ? Math.max(8, Math.min(100, ((state.current + 1) / Math.max(state.total, 1)) * 100))
        : 35;
    const label = state.message || `${state.current + 1}/${state.total} ${state.fileName}`;
    return (
      <div key={key} style={{ ...styles.transferBar, background: `${tone}12` }}>
        <div style={styles.transferTrack}>
          <div style={{ ...styles.transferFill, width: `${progress}%`, background: tone }} />
        </div>
        <span style={{ ...styles.transferLabel, color: state.error ? color.danger : color.subtext }} title={label}>
          {label}
        </span>
      </div>
    );
  };
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
        if (files.length > 0) uploadFiles(files);
      }}
    >
      <div style={styles.head}>
        <div style={styles.headTopRow}>
          <span style={styles.headTitle}>{t('files') || 'Files'}</span>
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
            <HeadAction icon={Upload} title={t('upload') || 'Upload'} onClick={() => openUploadPicker()} />
            <HeadAction icon={Terminal} title={t('openTerminalHere')} onClick={() => onOpenTerminalAtFolder?.(terminalTargetPath)} />
            <HeadAction icon={RefreshCw} title={t('refresh')} onClick={refreshAll} />
          </div>
        </div>
        <div style={styles.pathRow} title={rootDisplay}>
          <span style={styles.branchName}>{rootDisplay}</span>
        </div>
      </div>

      <div style={{ ...styles.searchBar, ...(searchVisible ? styles.searchBarOpen : {}) }} aria-hidden={!searchVisible}>
        <Search size={12} style={{ color: color.muted }} />
        <input ref={searchInputRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('searchFiles')} style={styles.searchInput} tabIndex={searchVisible ? 0 : -1} />
        {searchVisible && (
          <button
            onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
            style={styles.searchClearBtn}
            title={t('clearSearch') || 'Clear search'}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.muted; }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          uploadFiles(files, uploadDestRef.current);
        }}
      />

      {renderTransferBar(uploadState, 'upload')}
      {renderTransferBar(downloadState, 'download')}

      <div ref={listRef} style={{ ...styles.list, outline: 'none' }} tabIndex={-1} onKeyDown={handleTreeKeyDown} onScroll={handleListScroll} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: '', type: 'directory' } }); }}>
        {rootError && (
          <div style={styles.errorBox}>
            <div style={{ fontSize: fontSize['13'], color: color.subtext, fontWeight: fontWeight.medium }}>
              {t('couldNotLoadFiles') || 'Could not load files'}
            </div>
            <div style={{ fontSize: fontSize['11'], color: color.muted, fontFamily: font.mono, wordBreak: 'break-all' }}>
              {rootError}
            </div>
            {retryNotice != null && (
              <div style={{ fontSize: fontSize['11'], color: color.muted }}>
                {(t('retryingIn') || 'Retrying in') + ' ' + retryNotice + 's…'}
              </div>
            )}
            <button
              onClick={() => {
                if (retryTimerRef.current) {
                  clearTimeout(retryTimerRef.current);
                  retryTimerRef.current = null;
                }
                retryAttemptRef.current = 0;
                setRetryNotice(null);
                fetchChildren('');
              }}
              style={styles.retryBtn}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.accent; e.currentTarget.style.color = color.crust; e.currentTarget.style.borderColor = color.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.accent; e.currentTarget.style.borderColor = color.accent; }}
            >
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
                depth={row.depth} isOpen={row.type === 'directory' && expanded.has(row.path)} isFolder={row.type === 'directory'} isSelected={selectedPaths.has(row.path) || selectedPath === row.path} name={row.name} tone={row.git_status ? gitTone(row.git_status) : ((selectedPaths.has(row.path) || selectedPath === row.path) ? color.text : color.subtext)} gitStatus={row.git_status} isChanged={changedSet.has(row.path)}
                onClick={(e) => handleRowClick(e, row)}
                onDoubleClick={() => { if (row.type !== 'directory') onFileSelect?.(row.path, hostId); }}
                onContextMenu={(e) => handleRowContextMenu(e, row)}
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
          onDelete={() => { const ts = contextTargets(); if (ts.length) removeNodes(ts); setContextMenu(null); }}
          onOpenTerminal={() => { const p = contextMenu.target.type === 'directory' ? contextMenu.target.path : contextMenu.target.path.split('/').slice(0, -1).join('/'); onOpenTerminalAtFolder?.(p); setContextMenu(null); }}
          onDownload={() => {
            const ts = contextTargets();
            if (ts.length > 1 && !isHostMode) {
              downloadZip(ts); // 로컬 다중선택 → 단일 zip
            } else {
              ts.forEach((p) => { const node = visibleRows.find((r) => r.path === p); downloadNode(p, node?.type || 'file'); });
            }
            setContextMenu(null);
          }}
          onUpload={() => { openUploadPicker(contextMenu.target.path || null); setContextMenu(null); }}
        />,
        document.body
      )}
    </div>
  );
};


export default FileTree;
