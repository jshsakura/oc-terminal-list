import { useMemo, useState } from 'react';
import { GitBranch, RefreshCw, ChevronRight, ChevronDown, Folder, FilePlus, FileMinus, FileEdit } from 'lucide-react';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';

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
 * 사이드바 4번째 탭. 활성 터미널 cwd 의 repo 변경 파일 리스트.
 * 파일 클릭 → onSelectFile (우측 diff peek 패널 열림)
 * 더블클릭 → onOpenFile (메인 에디터)
 */
const ChangesList = ({ gitContextPath = '', onSelectFile, onOpenFile, t }) => {
  const { items, branch, repo, error, refresh, loading } = useGitChanges({
    enabled: true,
    path: gitContextPath,
    intervalMs: 1500,
  });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const repoBasename = repo ? repo.split('/').pop() : null;

  const tree = useMemo(() => buildTree(items), [items]);

  const toggle = (p) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

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
            {isCollapsed ? <ChevronRight size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
          </span>
          <Folder size={12} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <span style={styles.dirName}>{node.name}</span>
          <span style={styles.dirCount}>{leafCount}</span>
        </div>
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.headLeft} title={repo || ''}>
          <GitBranch size={11} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          {repoBasename ? (
            <>
              <span style={styles.repoLabel}>{repoBasename}</span>
              <span style={styles.branchName}>{branch || '—'}</span>
            </>
          ) : (
            <span style={styles.branchName}>
              {gitContextPath ? (t('noGitHere') || 'no git here') : (t('noActiveTerminal') || 'no active terminal')}
            </span>
          )}
          {items.length > 0 && <span style={styles.countBadge}>{items.length}</span>}
        </div>
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

      <div style={styles.list}>
        {error && <div style={styles.notice}>{error}</div>}
        {!error && items.length === 0 && (
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
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
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
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
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
