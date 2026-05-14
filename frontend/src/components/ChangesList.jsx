import { useMemo, useState, useRef, useEffect } from 'react';
import { GitBranch, RefreshCw, ChevronRight, ChevronDown, Folder, FilePlus, FileMinus, FileEdit, GitCommit, Upload, Loader2, Search, X } from 'lucide-react';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

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

/**
 * 사이드바 git 탭. 활성 터미널 cwd 의 repo 변경 파일 리스트 + commit/push.
 */
const ChangesList = ({ gitContextPath = '', sharedGitChanges = null, onSelectFile, onOpenFile, t }) => {
  const effectivePath = gitContextPath;

  const canUseSharedGitChanges = !!sharedGitChanges && gitContextPath != null;
  const localGitChanges = useGitChanges({
    enabled: !canUseSharedGitChanges,
    path: effectivePath,
    intervalMs: 1500,
  });
  const { items, branch, repo, error, refresh, loading } = canUseSharedGitChanges
    ? sharedGitChanges
    : localGitChanges;

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const repoBasename = repo ? repo.split('/').pop() : null;

  const [commitMsg, setCommitMsg] = useState('');
  const [commitOp, setCommitOp] = useState(null); // null | 'commit' | 'push'
  const [commitResult, setCommitResult] = useState(null); // null | {ok, text} | {error}

  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen]);

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

  const handleCommit = async () => {
    if (!commitMsg.trim() || commitOp) return;
    setCommitOp('commit');
    setCommitResult(null);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: effectivePath, message: commitMsg.trim() }),
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
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: effectivePath }),
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

  const renderNode = (node, depth) => {
    if (node.type === 'file') {
      const it = node.item;
      const meta = STATUS_META[it.kind] || STATUS_META.modified;
      return (
        <button
          key={it.path}
          onClick={() => onSelectFile?.(it.path)}
          onDoubleClick={() => onOpenFile?.(it.path)}
          style={{ ...styles.row, paddingLeft: 4 + depth * 14 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.chevSlot} />
          <span style={{ ...styles.statusLetter, color: meta.tone, borderColor: `${meta.tone}55`, background: `${meta.tone}11` }}>
            {meta.letter}
          </span>
          <span style={{ ...styles.name, color: color.subtext }}>{node.name}</span>
        </button>
      );
    }
    const isCollapsed = collapsed.has(node.path);
    const leafCount = countLeaves(node);
    return (
      <div key={`d:${node.path}`}>
        <div
          onClick={() => toggle(node.path)}
          style={{ ...styles.dirRow, paddingLeft: 4 + depth * 14 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.chevSlot}>
            {isCollapsed ? <ChevronRight size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
          </span>
          <Folder size={11} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
          <span style={styles.dirName}>{node.name}</span>
          {leafCount > 0 && <span style={styles.dirCount}>{leafCount}</span>}
        </div>
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.wrap}>
      <style>{`@keyframes cl-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={styles.head}>
        <div style={styles.headLeft}>
          <GitBranch size={11} strokeWidth={2} style={{ color: (repo) ? color.muted : color.faint, flexShrink: 0 }} />
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
            style={{ ...styles.refreshBtn, color: searchOpen ? color.accent : color.muted }}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = searchOpen ? color.accent : color.muted; }}
          >
            <Search size={11} strokeWidth={2} />
          </button>
          <button
            onClick={refresh}
            title={t('refresh') || 'Refresh'}
            style={styles.refreshBtn}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
          >
            <RefreshCw size={11} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
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

      {/* Commit / push bar */}
      <div style={styles.commitBar}>
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit(); }}
          placeholder={t('commitMessagePlaceholder') || 'Commit message…'}
          style={styles.commitInput}
          rows={2}
          disabled={!!commitOp}
        />
        {commitResult && (
          <div style={{ ...styles.commitStatus, color: commitResult.error ? color.danger : color.success }}>
            {commitResult.error || commitResult.text}
          </div>
        )}
        <div style={styles.commitActions}>
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || !!commitOp}
            style={{ ...styles.actionBtn, flex: 1, opacity: (!commitMsg.trim() || !!commitOp) ? 0.45 : 1 }}
            title={t('commitAll') || 'Stage all & commit (Ctrl+Enter)'}
          >
            {commitOp === 'commit'
              ? <Loader2 size={11} strokeWidth={2} style={{ animation: 'cl-spin 0.8s linear infinite' }} />
              : <GitCommit size={11} strokeWidth={2} />}
            <span>{t('commitAll') || 'Commit all'}</span>
          </button>
          <button
            onClick={handlePush}
            disabled={!!commitOp}
            style={{ ...styles.actionBtn, opacity: commitOp ? 0.45 : 1 }}
            title={t('push') || 'Push'}
          >
            {commitOp === 'push'
              ? <Loader2 size={11} strokeWidth={2} style={{ animation: 'cl-spin 0.8s linear infinite' }} />
              : <Upload size={11} strokeWidth={2} />}
            <span>{t('push') || 'Push'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const countLeaves = (node) => {
  if (node.type === 'file') return 1;
  return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
};

const styles = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  head: {
    height: '32px',
    minHeight: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `0 ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    gap: space['2'],
  },
  headLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    minWidth: 0,
    flex: 1,
  },
  repoLabel: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    fontWeight: fontWeight.medium,
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  branchName: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.muted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  countBadge: {
    fontSize: fontSize['11'],
    color: color.muted,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.full,
    padding: `0 ${space['1.5']}`,
    fontFamily: font.mono,
    flexShrink: 0,
  },
  refreshBtn: {
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
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1']} ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.crust,
    minHeight: '28px',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '20px',
    padding: `0 ${space['1']}`,
    background: 'transparent',
    border: 'none',
    color: color.text,
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    outline: 'none',
  },
  searchClear: {
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.muted,
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
    minHeight: 0,
  },
  commitBar: {
    flexShrink: 0,
    borderTop: `1px solid ${color.border}`,
    background: color.base,
    boxShadow: 'none',
    padding: `${space['1.5']} ${space['2']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
  },
  commitInput: {
    width: '100%',
    boxSizing: 'border-box',
    resize: 'none',
    padding: `${space['1']} ${space['1.5']}`,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    color: color.text,
    fontSize: fontSize['12'],
    fontFamily: font.sans,
    outline: 'none',
    lineHeight: 1.5,
    minHeight: '46px',
    transition: `border-color ${motion.fast}, box-shadow ${motion.fast}`,
  },
  commitStatus: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.9,
  },
  commitActions: {
    display: 'flex',
    gap: space['1.5'],
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    height: '26px',
    padding: `0 ${space['2']}`,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    color: color.subtext,
    fontSize: fontSize['11'],
    fontFamily: font.sans,
    cursor: 'pointer',
    transition: `opacity ${motion.fast}, background ${motion.fast}`,
    whiteSpace: 'nowrap',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    width: '100%',
    padding: '2px 4px',
    background: 'transparent',
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    minHeight: '22px',
    transition: `background ${motion.fast}`,
  },
  dirRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 4px',
    background: 'transparent',
    borderRadius: radius.xs,
    cursor: 'pointer',
    minHeight: '22px',
    userSelect: 'none',
    transition: `background ${motion.fast}`,
  },
  dirName: {
    flex: 1,
    fontSize: fontSize['12'],
    color: color.subtext,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dirCount: {
    fontSize: fontSize['11'],
    color: color.muted,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.full,
    padding: `0 ${space['1.5']}`,
    fontFamily: font.mono,
    flexShrink: 0,
  },
  chevSlot: {
    width: '12px',
    height: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: color.muted,
    flexShrink: 0,
  },
  statusLetter: {
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    fontWeight: fontWeight.semibold,
    border: '1px solid',
    borderRadius: radius.xs,
    flexShrink: 0,
  },
  name: {
    flex: 1,
    fontSize: fontSize['12'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  notice: {
    padding: `${space['6']} ${space['3']}`,
    textAlign: 'center',
    color: color.muted,
  },
  noticeTitle: {
    fontSize: fontSize['12'],
    color: color.subtext,
    marginBottom: space['1'],
  },
  noticeHint: {
    fontSize: fontSize['11'],
    color: color.muted,
  },
};

export default ChangesList;
