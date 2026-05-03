import { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, FilePlus, FileEdit, FileMinus } from 'lucide-react';
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
 * 사이드바의 Git 탭. 브랜치명 + 변경 파일 리스트.
 * 파일 클릭 → 우측 ChangesPanel 자동 열려서 diff 표시 (onSelectFile 콜백).
 */
const GitChangesTab = ({ onSelectFile, t }) => {
  const { items, branch, error, loading, refresh } = useGitChanges({ enabled: true });
  const [hoverPath, setHoverPath] = useState(null);

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.headLeft}>
          <GitBranch size={12} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <span style={styles.branch}>{branch || (error ? '—' : '…')}</span>
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
        {error && (
          <div style={styles.notice}>
            <div style={styles.noticeTitle}>{t('notAGitRepo') || 'Not a git repo'}</div>
            <div style={styles.noticeHint}>{error}</div>
          </div>
        )}
        {!error && items.length === 0 && (
          <div style={styles.notice}>
            <div style={styles.noticeTitle}>{t('noChanges') || 'No changes'}</div>
            <div style={styles.noticeHint}>{t('changesHint') || 'When files change, they show up here.'}</div>
          </div>
        )}
        {items.map((it) => {
          const meta = STATUS_META[it.kind] || STATUS_META.modified;
          const isHover = hoverPath === it.path;
          return (
            <button
              key={it.path}
              onClick={() => onSelectFile?.(it.path)}
              onMouseEnter={() => setHoverPath(it.path)}
              onMouseLeave={() => setHoverPath(null)}
              style={{
                ...styles.row,
                background: isHover ? color.surface0 : 'transparent',
              }}
            >
              <span style={{ ...styles.statusLetter, color: meta.tone, borderColor: `${meta.tone}55`, background: `${meta.tone}11` }}>
                {meta.letter}
              </span>
              <span style={styles.path}>{it.path}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
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
  },
  headLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    minWidth: 0,
  },
  branch: {
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
    minHeight: '24px',
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
  path: {
    flex: 1,
    fontSize: fontSize['12'],
    fontFamily: font.mono,
    color: color.subtext,
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
    fontSize: fontSize['13'],
    color: color.subtext,
    marginBottom: space['1'],
  },
  noticeHint: {
    fontSize: fontSize['11'],
    color: color.muted,
    fontFamily: font.mono,
    wordBreak: 'break-word',
  },
};

export default GitChangesTab;
