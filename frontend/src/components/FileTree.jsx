import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, RefreshCw, ChevronLeft, Terminal } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

const gitTone = (status) => {
  if (status === 'M') return color.warning;
  if (status === '??' || status === 'A') return color.success;
  if (status === 'D') return color.danger;
  return color.muted;
};

const FileTree = ({ onFileSelect, onFolderSelect, onOpenTerminalAtFolder, language = 'en', initialPath = '' }) => {
  const { t } = useTranslation(language);
  const [items, setItems] = useState([]);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [activeItemPath, setActiveItemPath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredPath, setHoveredPath] = useState(null);
  const lastClickRef = useRef({ id: null, time: 0 });

  const fetchFiles = useCallback(async (path) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const ts = Date.now();
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}&_t=${ts}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setCurrentPath(path);
      onFolderSelect?.(path);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onFolderSelect]);

  useEffect(() => {
    fetchFiles(initialPath);
  }, [fetchFiles, initialPath]);

  const goBack = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  const onItemClick = (item) => {
    setActiveItemPath(item.path);
    if (item.type === 'directory') {
      fetchFiles(item.path);
    } else {
      onFileSelect?.(item.path);
    }
  };

  const onItemTouch = (item) => {
    const now = Date.now();
    const isDouble = lastClickRef.current.id === item.path && (now - lastClickRef.current.time) < 300;
    setActiveItemPath(item.path);
    if (isDouble) {
      onItemClick(item);
      lastClickRef.current = { id: null, time: 0 };
    } else {
      lastClickRef.current = { id: item.path, time: now };
    }
  };

  if (error) {
    return (
      <div style={styles.errorBox}>
        <div>Error: {error}</div>
        <button onClick={() => fetchFiles(currentPath)} style={styles.retryBtn}>
          {t('retry') || 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <div style={styles.headTopRow}>
          <span style={styles.headLabel}>{t('explorer')}</span>
          <div style={styles.headActions}>
            <HeadAction
              icon={Terminal}
              title={t('focusTerminal') || 'Open terminal here'}
              onClick={() => onOpenTerminalAtFolder?.(currentPath)}
            />
            <HeadAction
              icon={RefreshCw}
              title={t('refresh') || 'Refresh'}
              spin={loading}
              onClick={() => fetchFiles(currentPath)}
            />
          </div>
        </div>
        <Breadcrumbs path={currentPath} onJump={fetchFiles} />
      </div>

      <div style={styles.list}>
        {loading && items.length === 0 ? (
          <div style={styles.muted}>{t('loading') || 'Loading…'}</div>
        ) : (
          <>
            {currentPath && (
              <Row
                onClick={goBack}
                hovered={hoveredPath === 'back'}
                onMouseEnter={() => setHoveredPath('back')}
                onMouseLeave={() => setHoveredPath(null)}
                muted
              >
                <ChevronLeft size={14} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
                <span style={styles.nameMuted}>.. {t('parentFolder')}</span>
              </Row>
            )}

            {items.length === 0 ? (
              <div style={styles.muted}>{t('folderEmpty') || 'Empty folder'}</div>
            ) : (
              items.map((item) => {
                const isActive = item.path === activeItemPath;
                const isHovered = item.path === hoveredPath;
                const tone = gitTone(item.git_status);
                return (
                  <Row
                    key={item.path}
                    onClick={() => onItemTouch(item)}
                    hovered={isHovered}
                    active={isActive}
                    onMouseEnter={() => setHoveredPath(item.path)}
                    onMouseLeave={() => setHoveredPath(null)}
                  >
                    {item.type === 'directory' ? (
                      <Folder size={14} strokeWidth={2} style={{ color: color.accent, flexShrink: 0 }} />
                    ) : (
                      <File size={14} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
                    )}
                    <span
                      style={{
                        ...styles.name,
                        color: item.git_status ? tone : (isActive ? color.text : color.subtext),
                        fontWeight: isActive ? fontWeight.medium : fontWeight.regular,
                      }}
                    >
                      {item.name}
                    </span>
                    {item.git_status && (
                      <span style={{ ...styles.gitTag, color: tone, borderColor: 'transparent', background: 'transparent' }}>
                        {item.git_status === '??' ? 'U' : item.git_status}
                      </span>
                    )}
                  </Row>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
};

const HeadAction = ({ icon: Icon, title, onClick, spin }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    title={title}
    style={styles.headActionBtn}
    onMouseEnter={(e) => { e.currentTarget.style.color = color.text; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = color.muted; }}
  >
    <Icon size={13} strokeWidth={2} className={spin ? 'animate-spin' : undefined} />
  </button>
);

const Breadcrumbs = ({ path, onJump }) => {
  if (!path) return <span style={styles.crumbRoot}>~ /</span>;
  const parts = path.split('/').filter(Boolean);
  return (
    <div style={styles.crumbRow}>
      <span onClick={() => onJump('')} style={styles.crumbLink}>~</span>
      {parts.map((part, i) => {
        const partial = parts.slice(0, i + 1).join('/');
        return (
          <span key={i} style={styles.crumbItem}>
            <span style={styles.crumbSep}>/</span>
            <span onClick={() => onJump(partial)} style={styles.crumbLink}>{part}</span>
          </span>
        );
      })}
    </div>
  );
};

const Row = ({ onClick, onMouseEnter, onMouseLeave, hovered, active, children, muted }) => (
  <div
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    style={{
      ...styles.row,
      background: active ? color.accentSubtle : (hovered ? color.surface0 : 'transparent'),
      opacity: muted ? 0.85 : 1,
    }}
  >
    {children}
  </div>
);

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
    padding: `${space['2']} ${space['2']}`,
    borderBottom: `1px solid ${color.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['1.5'],
  },
  headTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headLabel: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.muted,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  headActions: {
    display: 'flex',
    gap: space['0.5'],
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
  crumbRoot: {
    fontSize: fontSize['11'],
    color: color.muted,
    fontFamily: font.mono,
  },
  crumbRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: fontSize['11'],
    color: color.subtext,
    fontFamily: font.mono,
    gap: '1px',
  },
  crumbItem: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  crumbSep: {
    color: color.muted,
    margin: '0 2px',
  },
  crumbLink: {
    cursor: 'pointer',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['1']} ${space['1']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['1']} ${space['2']}`,
    borderRadius: radius.xs,
    cursor: 'pointer',
    fontSize: fontSize['13'],
    userSelect: 'none',
    transition: `background ${motion.fast}`,
    minHeight: '26px',
  },
  name: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nameMuted: {
    flex: 1,
    color: color.muted,
    fontSize: fontSize['12'],
  },
  gitTag: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    fontWeight: fontWeight.medium,
    flexShrink: 0,
    minWidth: '14px',
    textAlign: 'right',
  },
  errorBox: {
    color: color.danger,
    padding: space['4'],
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
    padding: `${space['6']} ${space['4']}`,
    textAlign: 'center',
    color: color.muted,
    fontSize: fontSize['12'],
  },
};

export default FileTree;
