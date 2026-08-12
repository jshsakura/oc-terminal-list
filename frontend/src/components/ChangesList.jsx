import { memo, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, RefreshCw, ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FilePlus, FileMinus, FileEdit, GitCommit, Upload, Loader2, Search, X, PenLine } from 'lucide-react';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';
import { styles } from './changes/styles';
import { authHeaders } from '../utils/auth';

const { color } = tokens;

const STATUS_META = {
  modified:  { letter: 'M', tone: color.warning, Icon: FileEdit },
  added:     { letter: 'A', tone: color.success, Icon: FilePlus },
  untracked: { letter: 'U', tone: color.success, Icon: FilePlus },
  deleted:   { letter: 'D', tone: color.danger,  Icon: FileMinus },
};

// path 들 → 디렉토리 트리
const buildTree = (items, stripPrefix = '') => {
  const root = { name: '', path: '', type: 'dir', children: [] };
  const idx = new Map([['', root]]);
  for (const it of items) {
    const fullPath = it.path;
    const rel = stripPrefix && fullPath.startsWith(stripPrefix + '/') ? fullPath.slice(stripPrefix.length + 1) : fullPath;
    const parts = rel.split('/');
    const fileName = parts.pop();
    let parentRel = '';
    let parent = root;
    for (const part of parts) {
      const childRel = parentRel ? `${parentRel}/${part}` : part;
      let child = idx.get(childRel);
      if (!child) {
        child = { name: part, path: childRel, type: 'dir', children: [] };
        parent.children.push(child);
        idx.set(childRel, child);
      }
      parent = child;
      parentRel = childRel;
    }
    parent.children.push({ name: fileName, path: rel, fullPath, type: 'file', item: it });
  }
  const sortRec = (node) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) if (c.type === 'dir') sortRec(c);
  };
  sortRec(root);
  return root;
};

const countLeaves = (node) => {
  if (node.type === 'file') return 1;
  return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
};

const dirname = (path) => {
  const clean = (path || '').replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return clean.startsWith('/') ? '/' : '';
  return clean.slice(0, idx);
};

const MenuItem = ({ icon: Icon, label, onClick }) => (
  <button
    type="button"
    className="iterm-menu-item"
    onClick={onClick}
    style={styles.menuItem}
  >
    <Icon size={13} strokeWidth={1.8} />
    <span>{label}</span>
  </button>
);

const GitContextMenu = ({ x, y, target, t, onClose, onReveal, onOpen, onDiff }) => {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  const [pos, setPos] = useState({ x, y });
  const [measured, setMeasured] = useState(false);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMeasured(false);
    setPos({ x, y });
  }, [x, y]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    const nextX = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
    const nextY = Math.min(Math.max(margin, y), window.innerHeight - rect.height - margin);
    setPos({ x: nextX, y: nextY });
    setMeasured(true);
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (!ref.current?.contains(e.target)) onCloseRef.current?.();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('contextmenu', handleMouseDown);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('contextmenu', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={ref}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        ...styles.contextMenu,
        left: pos.x,
        top: pos.y,
        opacity: measured ? 1 : 0,
      }}
    >
      <MenuItem
        icon={FileText}
        label={t('openInEditor') || 'Open in editor'}
        onClick={() => { onOpen?.(target); onClose?.(); }}
      />
      <MenuItem
        icon={GitBranch}
        label={t('viewDiff') || 'Diff'}
        onClick={() => { onDiff?.(target); onClose?.(); }}
      />
      <MenuItem
        icon={FolderOpen}
        label={t('showInFileExplorer') || 'Show in file explorer'}
        onClick={() => { onReveal?.(target); onClose?.(); }}
      />
    </div>
  );
};

const ChangeFileRow = memo(function ChangeFileRow({ node, depth, hostId, onSelectFile, onOpenFile, onContextMenu }) {
  const it = node.item;
  const meta = STATUS_META[it.kind] || STATUS_META.modified;
  const resolvedPath = node.resolvedPath;
  return (
    <button
      onClick={() => onSelectFile?.(resolvedPath, hostId)}
      onDoubleClick={() => onOpenFile?.(resolvedPath, hostId)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu({
          x: e.clientX,
          y: e.clientY,
          target: {
            filePath: resolvedPath,
            folderPath: dirname(resolvedPath),
            item: it,
          },
        });
      }}
      className="iterm-menu-item"
      style={{ ...styles.row, paddingLeft: 4 + depth * 14 }}
    >
      <span style={styles.chevSlot} />
      <span style={{ ...styles.statusLetter, color: meta.tone, borderColor: `${meta.tone}55`, background: `${meta.tone}11` }}>
        {meta.letter}
      </span>
      <span style={{ ...styles.name, color: color.subtext }}>{node.name}</span>
    </button>
  );
});

const ChangeDirRow = memo(function ChangeDirRow({ node, depth, isCollapsed, leafCount, onToggle }) {
  return (
    <div
      onClick={() => onToggle(node.path)}
      className="iterm-menu-item"
      style={{ ...styles.dirRow, paddingLeft: 4 + depth * 14 }}
    >
      <span style={styles.chevSlot}>
        {isCollapsed ? <ChevronRight size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
      </span>
      <Folder size={11} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
      <span style={styles.dirName}>{node.name}</span>
      {leafCount > 0 && <span style={styles.dirCount}>{leafCount}</span>}
    </div>
  );
});

const DiffModal = ({ diff, t, onClose }) => (
  <div style={styles.diffOverlay} onMouseDown={onClose}>
    <div style={styles.diffModal} onMouseDown={(e) => e.stopPropagation()}>
      <header style={styles.diffHeader}>
        <span style={styles.diffTitle}>{t('viewDiff') || 'Diff'}: {diff.path}</span>
        <button type="button" onClick={onClose} style={styles.diffClose}>
          <X size={13} strokeWidth={2} />
        </button>
      </header>
      <pre style={styles.diffBody}>{diff.patch || (t('diffEmpty') || '(no diff)')}</pre>
    </div>
  </div>
);

/**
 * 사이드바 git 탭. 활성 터미널 cwd 의 repo 변경 파일 리스트 + commit/push.
 */
const ChangesList = ({ gitContextPath = '', sharedGitChanges = null, hostId = null, onSelectFile, onOpenFile, onRevealInFiles, t }) => {
  const effectivePath = gitContextPath;

  const canUseSharedGitChanges = !!sharedGitChanges && (gitContextPath != null || !!hostId);
  /* 폴백 경로 전용(보통은 헤더의 인스턴스를 공유한다). 열린 git 패널의 기본 주기와 맞춘다 —
     공유 스토어가 최솟값을 채택하므로 여기만 낮으면 같은 repo 전체가 그 주기가 된다. */
  const localGitChanges = useGitChanges({
    enabled: !canUseSharedGitChanges,
    path: effectivePath,
    intervalMs: 4000,
  });
  const { items, branch, repo, error, refresh, loading } = canUseSharedGitChanges
    ? sharedGitChanges
    : localGitChanges;
  const fetchDiff = canUseSharedGitChanges ? sharedGitChanges?.fetchDiff : localGitChanges.fetchDiff;

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const inputRef = useRef(null);
  const repoBasename = repo ? repo.split('/').pop() : null;

  const [commitMsg, setCommitMsg] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitOp, setCommitOp] = useState(null); // null | 'commit' | 'push'
  const [commitResult, setCommitResult] = useState(null); // null | {ok, text} | {error}
  const [contextMenu, setContextMenu] = useState(null);
  const [diffView, setDiffView] = useState(null);

  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen]);
  useEffect(() => { if (commitOpen && inputRef.current) inputRef.current.focus(); }, [commitOpen]);

  // 커밋 결과 3초 뒤 자동 클리어
  useEffect(() => {
    if (!commitResult) return;
    const tid = setTimeout(() => setCommitResult(null), 3000);
    return () => clearTimeout(tid);
  }, [commitResult]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((it) => it.path.toLowerCase().includes(q));
  }, [items, searchQuery]);

  const tree = useMemo(() => buildTree(filteredItems), [filteredItems]);

  const toggle = (p) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const gitApiBase = hostId ? `/api/hosts/${hostId}/git` : '/api/git';
  const gitPath = hostId ? (repo || effectivePath || '') : effectivePath;

  const handleCommit = async () => {
    if (!commitMsg.trim() || commitOp) return;
    setCommitOp('commit');
    setCommitResult(null);
    try {
      const res = await fetch(`${gitApiBase}/commit`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: gitPath, message: commitMsg.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Commit failed');
      setCommitMsg('');
      setCommitResult({ ok: true, text: data.output || 'Committed' });
      refresh();
    } catch (e) {
      setCommitResult({ error: e.message });
    } finally {
      setCommitOp(null);
    }
  };

  const handlePush = async () => {
    if (commitOp) return;
    setCommitOp('push');
    setCommitResult(null);
    try {
      const res = await fetch(`${gitApiBase}/push`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: gitPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Push failed');
      setCommitResult({ ok: true, text: data.output || 'Pushed' });
    } catch (e) {
      setCommitResult({ error: e.message });
    } finally {
      setCommitOp(null);
    }
  };

  const resolvePath = (it) => {
    if (hostId && repo) {
      const base = repo.endsWith('/') ? repo : `${repo}/`;
      return `${base}${it.path}`.replace('//', '/');
    }
    return it.path;
  };

  const revealTarget = (target) => {
    if (!target?.folderPath && target?.folderPath !== '') return;
    onRevealInFiles?.(target.folderPath, hostId, target.filePath);
  };

  const openDiff = async (target) => {
    if (!target?.filePath || !fetchDiff) return;
    setDiffView({ path: target.filePath, patch: t('loading') || 'Loading...', loading: true });
    try {
      const data = await fetchDiff(target.filePath, !!target.item?.staged);
      setDiffView({ path: target.filePath, patch: data.patch || '', loading: false });
    } catch (e) {
      setDiffView({ path: target.filePath, patch: e.message || String(e), loading: false });
    }
  };

  const renderNode = (node, depth) => {
    if (node.type === 'file') {
      const it = node.item;
      const resolvedPath = resolvePath(it);
      return (
        <ChangeFileRow
          key={it.path}
          node={{ ...node, resolvedPath }}
          depth={depth}
          hostId={hostId}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
          onContextMenu={setContextMenu}
        />
      );
    }
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={`d:${node.path}`}>
        <ChangeDirRow
          node={node}
          depth={depth}
          isCollapsed={isCollapsed}
          leafCount={countLeaves(node)}
          onToggle={toggle}
        />
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.wrap}>
      <style>{`@keyframes cl-spin { to { transform: rotate(360deg); } }`}</style>

      {/* 헤더 */}
      <div style={styles.head}>
        <div style={styles.headLeft}>
          <GitBranch size={11} strokeWidth={2} style={{ color: repo ? color.muted : color.faint, flexShrink: 0 }} />
          {repoBasename ? (
            <>
              <span style={styles.repoLabel}>{repoBasename}</span>
              <span style={styles.branchName}>{branch || '—'}</span>
            </>
          ) : (
            <span style={styles.branchName}>
              {effectivePath != null ? (t('noGitHere') || 'no git here') : (t('noActiveTerminal') || 'no active terminal')}
            </span>
          )}
          {items.length > 0 && <span style={styles.countBadge}>{items.length}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={() => { setSearchOpen((v) => !v); setSearchQuery(''); }}
            title={t('search') || 'Search'}
            style={{ ...styles.iconBtn, color: searchOpen ? color.accent : color.muted }}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = searchOpen ? color.accent : color.muted; }}
          >
            <Search size={11} strokeWidth={2} />
          </button>
          <button
            onClick={refresh}
            title={t('refresh') || 'Refresh'}
            style={styles.iconBtn}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
          >
            <RefreshCw size={11} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
          </button>
          {/* 커밋 패널 토글 */}
          <button
            onClick={() => setCommitOpen((v) => !v)}
            title={commitOpen ? (t('hideCommit') || 'Hide commit') : (t('commit') || 'Commit')}
            style={{ ...styles.iconBtn, color: commitOpen ? color.accent : color.muted }}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = commitOpen ? color.accent : color.muted; }}
          >
            <PenLine size={11} strokeWidth={2} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div style={styles.searchBar}>
          <Search size={11} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setSearchOpen(false); } }}
            placeholder={t('searchFiles') || 'Search files…'}
            style={styles.searchInput}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={styles.searchClear}>
              <X size={10} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {/* 커밋 패널 — 토글 시에만 표시 */}
      {commitOpen && (
        <div style={styles.commitBar}>
          <div style={styles.commitRow}>
            <input
              ref={inputRef}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit(); }}
              placeholder={t('commitMessagePlaceholder') || 'Message (⌘Enter)'}
              style={styles.commitInput}
              disabled={!!commitOp}
            />
            <button
              onClick={handleCommit}
              disabled={!commitMsg.trim() || !!commitOp}
              style={{ ...styles.actionBtn, opacity: (!commitMsg.trim() || !!commitOp) ? 0.4 : 1 }}
              title={t('commitAll') || 'Stage all & commit'}
            >
              {commitOp === 'commit'
                ? <Loader2 size={11} strokeWidth={2} style={{ animation: 'cl-spin 0.8s linear infinite' }} />
                : <GitCommit size={11} strokeWidth={2} />}
            </button>
            <button
              onClick={handlePush}
              disabled={!!commitOp}
              style={{ ...styles.actionBtn, opacity: commitOp ? 0.4 : 1 }}
              title={t('push') || 'Push'}
            >
              {commitOp === 'push'
                ? <Loader2 size={11} strokeWidth={2} style={{ animation: 'cl-spin 0.8s linear infinite' }} />
                : <Upload size={11} strokeWidth={2} />}
            </button>
          </div>
          {commitResult && (
            <div style={{ ...styles.commitStatus, color: commitResult.error ? color.danger : color.success }}>
              {commitResult.error || commitResult.text}
            </div>
          )}
        </div>
      )}

      <div style={styles.list}>
        {error && <div style={styles.notice}>{error}</div>}
        {!error && loading && items.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 4px' }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '24px', paddingLeft: `${4 + (i > 3 ? 16 : 0)}px` }}>
                {(i === 0 || i > 3) && <SkeletonRow width="13px" height="13px" borderRadius="2px" />}
                <SkeletonRow width={`${50 + ((i * 11) % 30)}%`} height="12px" />
              </div>
            ))}
          </div>
        )}
        {!error && !loading && items.length === 0 && (
          <div style={styles.notice}>
            <div style={styles.noticeTitle}>
              {repoBasename ? `${repoBasename}: ${t('noChanges') || 'No changes'}` : (t('noChanges') || 'No changes')}
            </div>
            <div style={styles.noticeHint}>
              {repo ? (t('emptyRepoHint') || '커밋 안 된 변경이 없습니다.') : (t('changesHint') || 'Open a terminal in a git repo to see changes.')}
            </div>
          </div>
        )}
        {!error && items.length > 0 && tree.children.map((c) => renderNode(c, 0))}
      </div>
      {contextMenu && createPortal(
        <GitContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          t={t}
          onClose={() => setContextMenu(null)}
          onReveal={revealTarget}
          onOpen={(target) => onOpenFile?.(target.filePath, hostId)}
          onDiff={openDiff}
        />,
        document.body
      )}
      {diffView && createPortal(
        <DiffModal
          diff={diffView}
          t={t}
          onClose={() => setDiffView(null)}
        />,
        document.body
      )}
    </div>
  );
};


export default ChangesList;
