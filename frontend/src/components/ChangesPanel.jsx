import { useEffect, useMemo, useState } from 'react';
import { GitBranch, RefreshCw, X, FileText, FilePlus, FileMinus, FileEdit } from 'lucide-react';
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
const ChangesPanel = ({ isOpen, onClose, onOpenFile, t }) => {
  const { items, branch, error, refresh, fetchDiff } = useGitChanges({ enabled: isOpen });
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);

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

  return (
    <aside style={styles.aside}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <GitBranch size={12} strokeWidth={2} style={{ color: color.muted }} />
          <span style={styles.branchName}>{branch || '—'}</span>
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
            <div style={styles.emptyTitle}>{t('noChanges') || 'No changes'}</div>
            <div style={styles.emptyHint}>{t('changesHint') || 'When files change in this repo, they show up here.'}</div>
          </div>
        )}
        {items.map((it) => {
          const meta = STATUS_META[it.kind] || STATUS_META.modified;
          const isSelected = selected === it.path;
          return (
            <button
              key={it.path}
              onClick={() => setSelected(it.path)}
              onDoubleClick={() => onOpenFile?.(it.path)}
              style={{
                ...styles.row,
                background: isSelected ? color.accentSubtle : 'transparent',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = color.surface0; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ ...styles.statusLetter, color: meta.tone, borderColor: `${meta.tone}55`, background: `${meta.tone}11` }}>
                {meta.letter}
              </span>
              <span style={{ ...styles.rowName, color: isSelected ? color.text : color.subtext }}>{it.path}</span>
            </button>
          );
        })}
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
    width: '320px',
    minWidth: '260px',
    maxWidth: '480px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: color.mantle,
    borderLeft: `1px solid ${color.border}`,
    fontFamily: font.sans,
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
  branchName: {
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.subtext,
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
    maxHeight: '40%',
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
    borderBottom: `1px solid ${color.border}`,
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
    gap: space['2'],
    width: '100%',
    padding: `${space['1']} ${space['2']}`,
    background: 'transparent',
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: `background ${motion.fast}`,
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
