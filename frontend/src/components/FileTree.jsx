import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, File, RefreshCw, Terminal, Plus, Filter,
  ArrowUp, ArrowDown, Home, Search, X, Upload, ArrowDownUp, TextSearch,
} from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import useGitChanges from '../hooks/useGitChanges';
import useFileDownload from '../hooks/useFileDownload';
import useFileUpload from '../hooks/useFileUpload';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';
import { authHeaders } from '../utils/auth';
import { isFileDrag, setTreeDragPayload, TREE_PATH_MIME } from '../utils/fileDrag';
import { ROW_HEIGHT, VIRTUALIZE_AFTER, VIRTUAL_OVERSCAN } from './filetree/fileTreeConstants';
import { styles } from './filetree/fileTreeStyles';
import { gitTone, computeParent, dropFolderForRow, isRowInDropTarget, planMove, stripHostPathPrefix } from './filetree/fileTreeHelpers';
import { Row, ContextMenu, HeadAction } from './filetree/FileTreeParts';
import ContentSearch from './filetree/ContentSearch';
import { copyToClipboard } from '../utils/clipboard';

const { color, font, fontSize, fontWeight } = tokens;

// 트리 내부 드래그 식별용 MIME. 외부 파일 드롭(=업로드, 'Files' 타입)과 구분한다.
// 터미널도 이 값을 보고 "탐색기에서 끌어온 경로" 를 받으므로 상수를 공유한다.
const DND_MIME = TREE_PATH_MIME;


// 파일 크기/수정일 표시용 포맷터.
const formatFileSize = (bytes) => {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)}${units[i]}`;
};
const formatMtime = (sec) => {
  if (!sec) return '';
  try { return new Date(sec * 1000).toLocaleString(); } catch { return ''; }
};

// 정렬 모드 순환: 이름 → 수정일 → 크기 → (이름). 폴더는 항상 먼저.
const SORT_MODES = ['name', 'modified', 'size'];


const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onRefreshCwd = null, gitContextPath = '', sharedGitChanges = null, language = 'en', initialPath = '', hostId = null, activeFilePath = null }) => {
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
  // 드롭이 들어갈 폴더 경로. null=대상 없음, ''=루트(칠할 행이 없어 외곽선이 대신한다).
  // 내부 이동 드래그와 외부 파일 드롭이 같이 쓴다.
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'modified' | 'size' — 폴더 우선 고정
  const [renameTarget, setRenameTarget] = useState(null);
  const [creating, setCreating] = useState(null);
  const [filterChangedOnly, setFilterChangedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState('name'); // 'name'(트리 필터) | 'content'(내용 grep)
  const [rootPath, setRootPath] = useState(isHostMode ? stripHostPathPrefix(initialPath || '') : (initialPath || ''));
  const [rootPathForwardStack, setRootPathForwardStack] = useState([]);
  const [resolvedRoot, setResolvedRoot] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  /* The path row doubles as an address bar: click it, type a path, press Enter. Reading a
     path and typing one are the same act here — a separate "go to folder" dialog would be
     one more thing to find. */
  const [pathDraft, setPathDraft] = useState(null);   // null = display mode

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

  // 업로드 목적지 우선순위:
  //   1) 고른 폴더 → 그 폴더 / 고른 파일 → 그 부모
  //   2) 트리에서 하위 폴더로 들어가 있으면 그 폴더(rootPath)
  //   3) 아무것도 안 골랐고 루트에 있으면 지금 에디터에 열려 있는 파일의 폴더
  //   4) 그래도 없으면 루트
  // 헤더 업로드가 늘 루트로만 가던 혼란을 없앤다. (우클릭 업로드는 대상 노드 경로를 직접 넘김.)
  // 에디터 파일 경로는 워크스페이스 기준이라 호스트 모드에선 쓰지 않는다.
  const uploadTargetPath = useMemo(() => {
    if (selectedPath) {
      const type = (Object.values(nodes).flatMap((n) => n.items || []).find((it) => it.path === selectedPath))?.type;
      if (type === 'directory') return selectedPath;
      if (type === 'file') return selectedPath.split('/').slice(0, -1).join('/');
    }
    const root = rootPath || '';
    if (isHostMode) return stripHostPathPrefix(resolvedRoot || '') || stripHostPathPrefix(root);
    if (root) return root;
    if (activeFilePath) return activeFilePath.split('/').slice(0, -1).join('/');
    return '';
  }, [selectedPath, nodes, isHostMode, resolvedRoot, rootPath, activeFilePath]);
  const uploadTargetDisplay = uploadTargetPath
    ? (isHostMode ? uploadTargetPath : `~/${uploadTargetPath}`)
    : (isHostMode ? '/' : '~/');

  const uploadUrl = isHostMode ? `/api/hosts/${hostId}/files/upload` : '/api/files/upload';
  const { uploadState, uploadFiles: _uploadFilesRaw } = useFileUpload({
    uploadUrl,
    t,
    onUploadComplete: (destPath) => {
      // 폴더에 떨궜으면 그 폴더를 펼쳐서 결과를 보여준다 — 접힌 폴더에 올리고 아무 일도
      // 안 일어난 것처럼 보이던 문제(한 번도 안 연 폴더는 갱신 대상에서 빠졌다).
      if (destPath) setExpanded((prev) => new Set([...prev, destPath]));
      fetchChildren(destPath || '');
    },
  });
  const uploadFiles = (files, destPath = null) => _uploadFilesRaw(files, destPath ?? uploadTargetPath);


  const openUploadPicker = (destPath = null) => {
    uploadDestRef.current = destPath ?? uploadTargetPath;
    fileInputRef.current?.click();
  };

  // ── 드래그 이동 — 트리 내부 파일/폴더를 다른 폴더로 끌어 이동 (백엔드 /files/move) ──
  const moveItem = async (sourcePath, destFolder) => {
    const plan = planMove(sourcePath, destFolder);
    if (!plan.ok) {
      if (plan.reason === 'intoSelf') alert(t('moveIntoSelf') || "Can't move a folder into itself.");
      return;
    }
    const { destination } = plan;
    try {
      const url = isHostMode ? `/api/hosts/${hostId}/files/move` : '/api/files/move';
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ source: sourcePath, destination }),
      });
      if (res.status === 409) { alert(t('destExists') || 'A file with that name already exists there.'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const srcParent = sourcePath.split('/').slice(0, -1).join('/');
      await Promise.all([refreshPath(srcParent), refreshPath(destFolder)]);
      setSelectedPath(null);
      setSelectedPaths(new Set());
    } catch (e) {
      alert(e.message || 'move failed');
    }
  };
  const handleRowDragStart = (e, row) => {
    if (!row.path) return;
    // 경로 + 출처 호스트를 한 번에. 호스트는 터미널 드롭이 "저쪽 기계 경로인지" 판정할
    // 근거이고, 트리 내부 이동은 경로만 읽는다.
    setTreeDragPayload(e.dataTransfer, { path: row.path, hostId });
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleRowDragOver = (e, row) => {
    // 내부 드래그(이동)는 폴더 행만 대상. 외부 파일(업로드)은 파일 행이어도 그 부모 폴더로.
    const isInternal = e.dataTransfer.types.includes(DND_MIME);
    if (!isInternal && !isFileDrag(e.dataTransfer)) return;
    const target = isInternal
      ? (row.type === 'directory' ? row.path : null)
      : dropFolderForRow(row);
    if (target === null) return; // 파일 행 위의 내부 드래그 — 대상 아님(루트로 흘려보낸다)
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
    // 행 위에서도 dragOver 를 세워둔다 — 대상이 루트('')일 때 외곽선으로 보여줘야 하므로.
    if (!isInternal) setDragOver(true);
    if (dropTargetPath !== target) setDropTargetPath(target);
  };
  /* 행에는 dragleave 를 걸지 않는다. 하위 행으로 옮겨갈 때 dragleave(폴더) 가 dragover(자식)
     보다 먼저 와서 하이라이트가 한 프레임 꺼졌다 켜진다(깜빡임). 지우는 건 wrap 이 맡는다 —
     여백으로 나가면 wrap 의 dragover 가, 트리를 벗어나면 wrap 의 dragleave 가 지운다. */
  const handleRowDrop = (e, row) => {
    const isInternal = e.dataTransfer.types.includes(DND_MIME);
    if (!isInternal && !isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetPath(null);
    setDragOver(false);
    if (isInternal) {
      const source = e.dataTransfer.getData(DND_MIME);
      if (source && row.type === 'directory') moveItem(source, row.path);
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files, dropFolderForRow(row));
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
    const sortItems = (items) => {
      if (sortMode === 'name') return items; // 백엔드가 이미 폴더우선+이름순 제공
      const arr = [...items];
      arr.sort((a, b) => {
        const aDir = a.type === 'directory';
        const bDir = b.type === 'directory';
        if (aDir !== bDir) return aDir ? -1 : 1; // 폴더 먼저
        if (sortMode === 'modified') return (b.modified || 0) - (a.modified || 0); // 최신 먼저
        if (sortMode === 'size') return (b.size || 0) - (a.size || 0); // 큰 것 먼저
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      return arr;
    };
    const walk = (parentPath, depth) => {
      const node = nodes[parentPath];
      if (!node || !node.items) return;
      for (const item of sortItems(node.items)) {
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
  }, [nodes, expanded, filterChangedOnly, changedSet, hasChangedDescendant, searchQuery, sortMode]);

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
      return;
    }

    // ── 탐색/조작 (단일 선택 기준) ──
    const idx = visibleRows.findIndex((r) => r.path === selectedPath);
    const selectRow = (r) => {
      if (!r) return;
      setSelectedPath(r.path);
      setSelectedPaths(new Set([r.path]));
      selectionAnchorRef.current = r.path;
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectRow(visibleRows[idx < 0 ? 0 : Math.min(idx + 1, visibleRows.length - 1)]);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectRow(visibleRows[idx < 0 ? 0 : Math.max(idx - 1, 0)]);
      return;
    }
    if (idx < 0) return;
    const row = visibleRows[idx];
    if (e.key === 'F2' && row.path) {
      e.preventDefault();
      setRenameTarget({ path: row.path, draftName: row.name });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (row.type === 'directory') toggleFolder(row.path);
      else onFileSelect?.(row.path, hostId);
      return;
    }
    if (e.key === 'ArrowRight' && row.type === 'directory' && !expanded.has(row.path)) {
      e.preventDefault(); toggleFolder(row.path); return;
    }
    if (e.key === 'ArrowLeft' && row.type === 'directory' && expanded.has(row.path)) {
      e.preventDefault(); toggleFolder(row.path);
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
  const isContentMode = searchMode === 'content' && searchVisible && !isHostMode;
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
  /* Jump to a typed path. Local mode is workspace-relative, so a leading '/' is stripped —
     typing an absolute-looking path is natural and would otherwise resolve outside the
     workspace and come back empty. '~' means the pane's own starting point. */
  const goToPath = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    if (trimmed === '~') { goHomeRoot(); return; }
    const next = isHostMode
      ? stripHostPathPrefix(trimmed)
      : trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    const currentRoot = normalizedResolvedRoot || normalizedRootPath || rootPath || '';
    if (next === currentRoot) return;
    setRootPath(next);
    setRootPathForwardStack((prev) => (currentRoot
      ? [currentRoot, ...prev.filter((p) => p !== currentRoot)].slice(0, 8)
      : prev));
  };
  const goHomeRoot = () => {
    setRootPath(normalizedInitialPath);
    setRootPathForwardStack([]);
  };

  return (
    <div
      /* 외곽선 = "특정 폴더가 아니라 루트로 간다". 폴더가 대상이면 그쪽이 칠해지므로 끈다.
         대상이 루트('')면 dropTargetPath 가 falsy 라 여기서 외곽선이 뜬다 — 의도된 동작. */
      style={{ ...styles.wrap, ...(dragOver && !dropTargetPath ? { outline: `2px dashed ${color.accent}`, outlineOffset: '-2px', background: `${color.accent}08` } : {}) }}
      onDragOver={(e) => {
        e.preventDefault(); e.stopPropagation();
        // 대상이 되는 행은 stopPropagation 하므로, 여기 도달 = 여백이거나 대상 아닌 행
        // (파일 행 위의 내부 이동 드래그) = 대상 없음. 내부 드래그도 여기서 하이라이트를 건다.
        setDropTargetPath(null);
        setDragOver(isFileDrag(e.dataTransfer));
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
        setDropTargetPath(null); // 트리를 완전히 벗어남 — 행 하이라이트도 같이 걷는다
      }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setDragOver(false); setDropTargetPath(null);
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
            <HeadAction
              icon={ArrowDownUp}
              title={`${t('sortBy') || 'Sort'}: ${t(sortMode === 'modified' ? 'sortModified' : sortMode === 'size' ? 'sortSize' : 'sortName') || sortMode}`}
              onClick={() => setSortMode((m) => SORT_MODES[(SORT_MODES.indexOf(m) + 1) % SORT_MODES.length])}
              active={sortMode !== 'name'}
            />
            <HeadAction icon={Plus} title={t('newFile')} onClick={() => startCreate('', 'file')} />
            <HeadAction icon={Folder} title={t('newFolder')} onClick={() => startCreate('', 'directory')} />
            <HeadAction icon={Upload} title={`${t('upload') || 'Upload'} → ${uploadTargetDisplay}`} onClick={() => openUploadPicker()} />
            <HeadAction icon={Terminal} title={t('openTerminalHere')} onClick={() => onOpenTerminalAtFolder?.(terminalTargetPath)} />
            <HeadAction icon={RefreshCw} title={t('refresh')} onClick={refreshAll} />
          </div>
        </div>
        <div style={styles.pathRow} title={pathDraft === null ? rootDisplay : undefined}>
          {pathDraft === null ? (
            <button
              type="button"
              style={styles.pathButton}
              onClick={() => setPathDraft(rootDisplay)}
              title={t('goToPath') || 'Go to path'}
            >
              <span style={styles.branchName}>{rootDisplay}</span>
            </button>
          ) : (
            <input
              autoFocus
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={() => setPathDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setPathDraft(null); return; }
                if (e.key !== 'Enter') return;
                goToPath(pathDraft);
                setPathDraft(null);
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={styles.pathInput}
              aria-label={t('goToPath') || 'Go to path'}
            />
          )}
        </div>
      </div>

      <div style={{ ...styles.searchBar, ...(searchVisible ? styles.searchBarOpen : {}) }} aria-hidden={!searchVisible}>
        <Search size={12} style={{ color: color.muted }} />
        <input ref={searchInputRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={searchMode === 'content' ? (t('searchContents') || 'Search in files') : t('searchFiles')} style={styles.searchInput} tabIndex={searchVisible ? 0 : -1} />
        {!isHostMode && searchVisible && (
          <button
            onClick={() => setSearchMode((m) => (m === 'content' ? 'name' : 'content'))}
            style={styles.searchClearBtn}
            title={searchMode === 'content' ? (t('searchFilenames') || 'Search filenames') : (t('searchContents') || 'Search in files')}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <TextSearch size={12} style={{ color: searchMode === 'content' ? color.accent : color.muted }} />
          </button>
        )}
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

      {/* 내용 검색 모드 — 트리 리스트 대신 grep 결과. 트리 div 는 언마운트 없이 숨김(상태/스크롤 보존). */}
      {isContentMode && (
        <div style={{ ...styles.list, display: 'flex', flexDirection: 'column' }}>
          <ContentSearch query={searchQuery} onOpen={(p) => onFileSelect?.(p, hostId)} t={t} />
        </div>
      )}
      <div ref={listRef} style={{ ...styles.list, outline: 'none', ...(isContentMode ? { display: 'none' } : {}) }} tabIndex={-1} onKeyDown={handleTreeKeyDown} onScroll={handleListScroll} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: '', type: 'directory' } }); }}>
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
                sizeLabel={row.type === 'file' ? formatFileSize(row.size) : ''}
                title={row.modified ? `${row.name}\n${formatMtime(row.modified)}${row.type === 'file' && row.size != null ? ` · ${formatFileSize(row.size)}` : ''}` : row.name}
                draggable={!!row.path}
                onDragStart={(e) => handleRowDragStart(e, row)}
                /* 파일 행에도 건다 — 외부 파일 드롭은 그 파일의 부모 폴더가 대상이 되므로.
                   내부 드래그는 핸들러 안에서 폴더 행만 통과시킨다. */
                onDragOver={(e) => handleRowDragOver(e, row)}
                onDrop={(e) => handleRowDrop(e, row)}
                isDropTarget={isRowInDropTarget(dropTargetPath, row.path)}
                isDropTargetRoot={!!dropTargetPath && row.path === dropTargetPath}
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
          onCopyPath={() => { copyToClipboard(contextMenu.target.path || ''); setContextMenu(null); }}
          onCopyName={() => { copyToClipboard((contextMenu.target.path || '').split('/').pop()); setContextMenu(null); }}
        />,
        document.body
      )}
    </div>
  );
};


export default FileTree;
