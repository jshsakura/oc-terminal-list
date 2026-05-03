import { useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, X, FileText, FilePlus, FileMinus, FileEdit, ChevronRight, ChevronDown, Folder } from 'lucide-react';
import useGitChanges from '../hooks/useGitChanges';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const STATUS_META = {
  modified:  { letter: 'M', tone: color.warning, Icon: FileEdit },
  added:     { letter: 'A', tone: color.success, Icon: FilePlus },
  untracked: { letter: 'U', tone: color.success, Icon: FilePlus },
  deleted:   { letter: 'D', tone: color.danger,  Icon: FileMinus },
};

/**
 * 우측 변경사항 패널.
 * - 워크스페이스의 git status 를 4초마다 폴링
 * - 파일 클릭 → 하단에 unified diff 표시
 * - 클로드 코드 같은 도구가 파일을 수정하면 즉시 보임
 */
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 320;

// path 리스트 → 디렉토리 트리. items 는 leaf 만, dir 는 중간 노드.
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
        child = { name: part, path: childRel, fullPath: stripPrefix ? `${stripPrefix}/${childRel}` : childRel, type: 'dir', children: [] };
        parent.children.push(child);
        idx.set(childRel, child);
      }
      parent = child;
      parentRel = childRel;
    }
    parent.children.push({ name: fileName, path: rel, fullPath, type: 'file', item: it });
  }
  // 정렬: dir 먼저, 그 다음 file
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

const ChangesPanel = ({ isOpen, onClose, onOpenFile, t, externalSelectedPath, onConsumedExternalPath, gitContextPath = '' }) => {
  const { items, branch, repo, repos, error, refresh, fetchDiff } = useGitChanges({
    enabled: isOpen,
    path: gitContextPath,
    intervalMs: gitContextPath ? 1500 : 7000,
  });
  const repoBasename = repo ? repo.split('/').pop() : null;
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleCollapse = (path) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('changes_panel_width') || '0', 10);
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => { localStorage.setItem('changes_panel_width', String(width)); }, [width]);

  const startResize = (e) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev) => {
      // 패널이 우측에 있으므로, 왼쪽으로 끌면 너비 증가
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (startX - ev.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 외부에서 선택 요청 (사이드바 Git 탭 클릭) — 패널이 열릴 때 그 파일을 선택
  useEffect(() => {
    if (externalSelectedPath) {
      setSelected(externalSelectedPath);
      onConsumedExternalPath?.();
    }
  }, [externalSelectedPath, onConsumedExternalPath]);

  // 선택한 파일이 더 이상 변경 목록에 없으면 선택 해제
  useEffect(() => {
    if (selected && !items.some((it) => it.path === selected)) {
      setSelected(null);
      setDiff(null);
    }
  }, [items, selected]);

  // 선택 시 diff fetch
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    fetchDiff(selected, false)
      .then((data) => setDiff(data.patch || ''))
      .catch((e) => setDiffError(e.message))
      .finally(() => setDiffLoading(false));
  }, [selected, fetchDiff, items]); // items 변할 때 diff 갱신

  if (!isOpen) return null;

  // 폴더 하위 leaf 개수 (재귀)
  const countLeaves = (node) => {
    if (node.type === 'file') return 1;
    return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
  };

  // 트리 노드 재귀 렌더
  const renderNode = (node, depth) => {
    if (node.type === 'file') {
      const it = node.item;
      const meta = STATUS_META[it.kind] || STATUS_META.modified;
      const isSelected = selected === it.path;
      return (
        <button
          key={it.path}
          onClick={() => setSelected(isSelected ? null : it.path)}
          onDoubleClick={() => onOpenFile?.(it.path)}
          style={{
            ...styles.row,
            paddingLeft: 4 + depth * 14,
            background: isSelected ? color.accentSubtle : 'transparent',
          }}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = color.surface0; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.chevronSlot} />
          <span style={{ ...styles.statusLetter, color: meta.tone, borderColor: `${meta.tone}55`, background: `${meta.tone}11` }}>
            {meta.letter}
          </span>
          <span style={{ ...styles.rowName, color: isSelected ? color.text : color.subtext }}>{node.name}</span>
        </button>
      );
    }
    // dir
    const isCollapsed = collapsed.has(node.fullPath || node.path);
    const leafCount = countLeaves(node);
    return (
      <div key={`d:${node.fullPath || node.path}`}>
        <div
          onClick={() => toggleCollapse(node.fullPath || node.path)}
          style={{
            ...styles.dirRow,
            paddingLeft: 4 + depth * 14,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.chevronSlot}>
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

  const renderTreeForItems = (its, stripPrefix = '') => {
    const tree = buildTree(its, stripPrefix);
    return tree.children.map((c) => renderNode(c, 0));
  };

  return (
    <aside style={{ ...styles.aside, width: `${width}px` }}>
      <div
        onMouseDown={startResize}
        style={{ ...styles.resizeHandle, background: isResizing ? color.accentBorder : 'transparent' }}
        title={t('resizePanel') || 'Drag to resize'}
      />
      <header style={styles.header} title={repo || gitContextPath || ''}>
        <div style={styles.headerLeft}>
          <GitBranch size={12} strokeWidth={2} style={{ color: color.muted }} />
          {repoBasename && <span style={styles.repoLabel}>{repoBasename}</span>}
          <span style={styles.branchName}>
            {branch || (repos && repos.length > 0 ? `${repos.length} repos` : (gitContextPath ? '—' : 'workspace'))}
          </span>
          {items.length > 0 && (
            <span style={styles.countBadge}>{items.length}</span>
          )}
        </div>
        <div style={styles.headerActions}>
          <HeaderBtn onClick={refresh} title={t('refresh') || 'Refresh'} icon={RefreshCw} />
          <HeaderBtn onClick={onClose} title={t('close') || 'Close'} icon={X} />
        </div>
      </header>

      <div style={styles.list}>
        {error && <div style={styles.errorBox}>{error}</div>}
        {!error && items.length === 0 && (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>
              {repoBasename
                ? `${repoBasename}: ${t('noChanges') || 'No changes'}`
                : (t('noChanges') || 'No changes')}
            </div>
            <div style={styles.emptyHint}>
              {repo
                ? (t('emptyRepoHint') || '커밋 안 된 변경이 없습니다. 파일을 수정해보세요.')
                : (t('changesHint') || 'When files change, they show up here.')}
            </div>
          </div>
        )}
        {/* repo 다수면 repo 별로 그룹핑 + 트리, 단일이면 트리만 */}
        {repos && repos.length > 1 ? (
          repos.map((repo) => {
            const groupItems = items.filter((it) => it.path.startsWith(repo.rel + '/') || it.path === repo.rel);
            const showLabel = repo.noisy
              ? `${repo.total} (skipped)`
              : (repo.truncated ? `${repo.count} of ${repo.total}` : `${repo.count}`);
            return (
              <div key={repo.root} style={styles.group}>
                <div style={styles.groupHead} title={repo.noisy ? `이 repo는 ${repo.total}개 변경으로 너무 시끄러워서 자동으로 접힘. .gitignore 확인 권장.` : ''}>
                  <GitBranch size={10} strokeWidth={2} style={{ color: color.muted }} />
                  <span style={styles.groupRepo}>{repo.rel}</span>
                  <span style={styles.groupBranch}>{repo.branch || '—'}</span>
                  <span style={{
                    ...styles.groupCount,
                    color: repo.noisy ? color.warning : color.accent,
                    background: repo.noisy ? `${color.warning}1A` : color.accentSubtle,
                    borderColor: repo.noisy ? `${color.warning}55` : color.accentBorder,
                  }}>{showLabel}</span>
                </div>
                {!repo.noisy && renderTreeForItems(groupItems, repo.rel)}
              </div>
            );
          })
        ) : (
          renderTreeForItems(items)
        )}
      </div>

      {selected && (
        <div style={styles.diffWrap}>
          <div style={styles.diffHead}>
            <FileText size={11} strokeWidth={2} style={{ color: color.muted }} />
            <span style={styles.diffPath}>{selected}</span>
            <button
              onClick={() => onOpenFile?.(selected)}
              style={styles.openInEditorBtn}
              title={t('openInEditor') || 'Open in editor'}
            >
              {t('openInEditor') || 'Open in editor'}
            </button>
          </div>
          <div style={styles.diffBody}>
            {diffLoading && <div style={styles.muted}>{t('loading') || 'Loading…'}</div>}
            {diffError && <div style={styles.errorBox}>{diffError}</div>}
            {!diffLoading && !diffError && (
              <DiffView patch={diff || ''} />
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

const DiffView = ({ patch }) => {
  const lines = useMemo(() => (patch || '').split('\n'), [patch]);
  if (!patch.trim()) {
    return <div style={styles.muted}>(no diff — file may be binary or new untracked)</div>;
  }
  return (
    <pre style={styles.diffPre}>
      {lines.map((line, i) => {
        let bg = 'transparent';
        let cl = color.subtext;
        if (line.startsWith('+++') || line.startsWith('---')) { cl = color.muted; }
        else if (line.startsWith('@@')) { cl = color.info; bg = `${color.info}10`; }
        else if (line.startsWith('+')) { cl = color.success; bg = `${color.success}12`; }
        else if (line.startsWith('-')) { cl = color.danger; bg = `${color.danger}12`; }
        return (
          <div key={i} style={{ background: bg, color: cl, padding: '0 8px', whiteSpace: 'pre' }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
};

const HeaderBtn = ({ onClick, title, icon: Icon }) => (
  <button
    onClick={onClick}
    title={title}
    style={styles.iconBtn}
    onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
  >
    <Icon size={12} strokeWidth={2} />
  </button>
);

const styles = {
  aside: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: color.mantle,
    borderLeft: `1px solid ${color.border}`,
    fontFamily: font.sans,
    position: 'relative',
    flexShrink: 0,
  },
  resizeHandle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '-3px',
    width: '6px',
    cursor: 'ew-resize',
    zIndex: 10,
    transition: 'background 120ms ease',
  },
  header: {
    height: '36px',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `0 ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
  },
  headerActions: {
    display: 'flex',
    gap: '2px',
  },
  repoLabel: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    fontWeight: fontWeight.medium,
    color: color.text,
  },
  branchName: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.muted,
  },
  countBadge: {
    fontSize: fontSize['11'],
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `0 ${space['1.5']}`,
    fontFamily: font.mono,
  },
  iconBtn: {
    width: '24px',
    height: '24px',
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
    flexShrink: 0,
    maxHeight: '50%',
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    marginBottom: space['1'],
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    padding: `${space['1']} ${space['2']}`,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    fontFamily: font.mono,
    fontSize: fontSize['11'],
    marginTop: '2px',
  },
  groupRepo: {
    color: color.text,
    fontWeight: fontWeight.medium,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '50%',
  },
  groupBranch: {
    color: color.muted,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groupCount: {
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `0 ${space['1.5']}`,
    flexShrink: 0,
  },
  empty: {
    padding: `${space['8']} ${space['3']}`,
    textAlign: 'center',
    color: color.muted,
  },
  emptyTitle: {
    fontSize: fontSize['13'],
    color: color.subtext,
    marginBottom: space['1'],
  },
  emptyHint: {
    fontSize: fontSize['11'],
    color: color.muted,
  },
  errorBox: {
    color: color.danger,
    padding: space['3'],
    fontSize: fontSize['12'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    width: '100%',
    padding: `2px ${space['1']}`,
    background: 'transparent',
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: `background ${motion.fast}`,
    minHeight: '22px',
  },
  dirRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    width: '100%',
    padding: `2px ${space['1']}`,
    background: 'transparent',
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: `background ${motion.fast}`,
    minHeight: '22px',
    userSelect: 'none',
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
    minWidth: '16px',
    textAlign: 'center',
  },
  chevronSlot: {
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
  rowName: {
    flex: 1,
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  diffWrap: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  diffHead: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    height: '28px',
    padding: `0 ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.crust,
  },
  diffPath: {
    flex: 1,
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.subtext,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  openInEditorBtn: {
    fontSize: fontSize['11'],
    color: color.subtext,
    background: 'transparent',
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    padding: `2px ${space['2']}`,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  diffBody: {
    flex: 1,
    overflow: 'auto',
  },
  diffPre: {
    margin: 0,
    fontFamily: font.mono,
    fontSize: fontSize['12'],
    lineHeight: 1.45,
  },
  muted: {
    padding: space['3'],
    textAlign: 'center',
    color: color.muted,
    fontSize: fontSize['12'],
  },
};

export default ChangesPanel;
