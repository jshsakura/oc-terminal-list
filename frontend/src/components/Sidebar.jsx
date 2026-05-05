import { useState, useRef, useEffect, memo, useMemo } from 'react';
import { X, Terminal, FolderTree, RefreshCw, Activity, Cpu, HardDrive, Search, Server, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import FileTree from './FileTree';
import HostList from './HostList';
import SessionActivity from './SessionActivity';
import ChangesList from './ChangesList';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

// 세션 ID를 안정적인 dot 컬러로 매핑
const colorForSession = (sessionId) => {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return color.dotPalette[h % color.dotPalette.length];
};

const Sidebar = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onRenameSession,
  onReconnectSession,
  // hosts
  hosts = [],
  onConnectHost,
  onAddHost,
  onEditHost,
  onDeleteHost,
  onManageKeys,
  // 현재 활성 세션의 정보 (사용량 라벨 컨텍스트에 사용)
  activeSession = null,
  // git context 의 기준 경로 (활성 터미널 cwd)
  gitContextPath = '',
  language = 'en',
  isMobile = false,
  width = 260,
  onResizeStart,
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  selectedFolderPath = '',
  viewportHeight,
}) => {
  const { t } = useTranslation(language);
  const [activeTab, setActiveTab] = useState('hosts'); // hosts | sessions | files
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [systemStats, setSystemStats] = useState({ cpu: 0, ram: 0, disk: 0 });
  const [filter, setFilter] = useState('');
  const [hoverId, setHoverId] = useState(null);
  const [expandedActivity, setExpandedActivity] = useState(new Set());
  const editInputRef = useRef(null);

  const toggleActivity = (id) => {
    setExpandedActivity((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 시스템 정보 폴링
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const res = await fetch('/api/system/stats', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setSystemStats(await res.json());
      } catch {}
    };
    fetchStats();
    const id = setInterval(fetchStats, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const filteredSessions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const name = (s.name || '').toLowerCase();
      const cwd = (s.cwd || '').toLowerCase();
      return name.includes(q) || cwd.includes(q) || s.id.toLowerCase().includes(q);
    });
  }, [filter, sessions]);

  const finishEdit = async () => {
    if (editingSessionId && editingName.trim() && onRenameSession) {
      await onRenameSession(editingSessionId, editingName.trim());
    }
    setEditingSessionId(null);
    setEditingName('');
  };

  const cancelEdit = () => {
    setEditingSessionId(null);
    setEditingName('');
  };

  if (!isOpen) return null;

  return (
    <>
      {isMobile && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: color.scrim, zIndex: 9998, animation: 'fadeIn 150ms ease' }}
        />
      )}
      <aside
        style={{
          ...styles.aside,
          width: isMobile ? 'min(82vw, 300px)' : `${width}px`,
          maxWidth: isMobile ? '82vw' : '420px',
          // 활성 사이드바 최소폭 = 활동바(40px) + 푸터(CPU/RAM/Disk 3개) 가 안 짤리는 폭
          minWidth: isMobile ? undefined : '240px',
          height: isMobile ? `${viewportHeight}px` : '100vh',
          flexDirection: 'row',
        }}
      >
        {/* 좌측 세로 아이콘 스트립 (Jupyter 식 activity bar) */}
        <nav style={styles.activityBar}>
          <ActivityIcon active={activeTab === 'hosts'} onClick={() => setActiveTab('hosts')} icon={Server} title={t('hosts') || 'Hosts'} />
          <ActivityIcon active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={FolderTree} title={t('files')} />
          <ActivityIcon active={activeTab === 'git'} onClick={() => setActiveTab('git')} icon={GitBranch} title={t('git') || 'Git'} />
          <ActivityIcon active={activeTab === 'sessions'} onClick={() => setActiveTab('sessions')} icon={Terminal} title={t('active') || t('sessions')} badge={sessions.length} />
          {isMobile && (
            <div style={{ marginTop: 'auto', paddingBottom: space['1'] }}>
              <button onClick={onClose} title={t('closeSidebar')} style={styles.closeBtn}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </nav>

        {/* 우측 패널 영역 */}
        <div style={styles.panelArea}>

        {/* hosts 탭 */}
        {activeTab === 'hosts' && (
          <HostList
            hosts={hosts}
            onConnect={(h) => {
              // 로컬: 폴더 먼저 고르도록 Files 탭으로 전환 (셸은 거기서 '여기서 터미널 열기' 로)
              if (h?.id === 'local' || h?.isLocal) {
                setActiveTab('files');
                return;
              }
              // 원격 호스트: 즉시 SSH 연결 + Active 탭 전환
              onConnectHost?.(h);
              setActiveTab('sessions');
              if (isMobile) onClose();
            }}
            onAddHost={onAddHost}
            onEditHost={onEditHost}
            onDeleteHost={onDeleteHost}
            onManageKeys={onManageKeys}
            t={t}
          />
        )}

        {/* sessions 탭 */}
        {activeTab === 'sessions' && (
          <>
            <div style={styles.searchRow}>
              <div style={styles.searchInputWrap}>
                <Search size={12} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('searchSessions') || 'Search sessions'}
                  style={styles.searchInput}
                />
              </div>
            </div>

            <div style={styles.list}>
              {filteredSessions.length === 0 ? (
                <div style={styles.empty}>
                  <div style={styles.emptyTitle}>
                    {sessions.length === 0
                      ? (t('noTerminals') || 'No sessions yet')
                      : (t('noResults') || 'No matches')}
                  </div>
                  <div style={styles.emptyHint}>
                    {sessions.length === 0
                      ? (t('createFirstTerminal') || 'Create one to get started.')
                      : (t('tryDifferentSearch') || 'Try a different search.')}
                  </div>
                </div>
              ) : (
                filteredSessions.map((session, index) => {
                  const isActive = session.id === activeSessionId;
                  const isHovered = session.id === hoverId;
                  const dotColor = colorForSession(session.id);
                  const isExpanded = expandedActivity.has(session.id);
                  const isHostTab = !!session.hostId;
                  // 표시 이름: 사용자 명시명 > cwd basename > Terminal N
                  const cwdBase = session.cwd
                    ? (session.cwd.split('/').filter(Boolean).pop() || 'workspace')
                    : null;
                  const displayName = session.name || cwdBase || `Terminal ${index + 1}`;
                  return (
                    <div key={session.id} style={styles.cardOuter}>
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('application/x-iterminallist-session', session.id);
                        }}
                        onMouseEnter={() => setHoverId(session.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={() => {
                          onSelectSession(session.id);
                          if (isMobile) onClose();
                        }}
                        title={`${session.name || session.id} — ${t('dragToSplitHint') || 'drag to terminal to split'}`}
                        style={{
                          ...styles.row,
                          background: isActive ? color.accentSubtle : color.surface0,
                          borderColor: isActive ? color.accentBorder : (isHovered ? color.borderStrong : color.border),
                          borderBottomLeftRadius: isExpanded ? 0 : radius.md,
                          borderBottomRightRadius: isExpanded ? 0 : radius.md,
                          cursor: 'grab',
                        }}
                      >
                        <div style={{ ...styles.activeBar, background: isActive ? color.accent : 'transparent' }} />
                        <div style={{ ...styles.dot, background: dotColor }} />
                        <div style={styles.rowBody}>
                          {editingSessionId === session.id ? (
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={finishEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') finishEdit();
                                else if (e.key === 'Escape') cancelEdit();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={styles.editInput}
                            />
                          ) : (
                            <div
                              style={{
                                ...styles.rowName,
                                color: isActive ? color.text : color.text,
                                fontWeight: isActive ? fontWeight.medium : fontWeight.regular,
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingSessionId(session.id);
                                setEditingName(displayName);
                              }}
                            >
                              {displayName}
                            </div>
                          )}
                          {session.cwd && <div style={styles.rowSub}>{session.cwd}</div>}
                        </div>

                        <div style={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                          {!isHostTab && (
                            <RowAction
                              onClick={() => toggleActivity(session.id)}
                              icon={isExpanded ? ChevronDown : ChevronRight}
                              title={t('activity') || 'Recent activity'}
                            />
                          )}
                          {(isHovered || isActive) && (
                            <>
                              <RowAction
                                onClick={() => onReconnectSession?.(session.id)}
                                icon={RefreshCw}
                                title={t('reconnect') || 'Reconnect'}
                              />
                              <RowAction
                                onClick={() => onCloseSession(session.id)}
                                icon={X}
                                title={t('closeTerminal')}
                                tone="danger"
                              />
                            </>
                          )}
                        </div>
                      </div>

                      {isExpanded && !isHostTab && (
                        <SessionActivity sessionId={session.id} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* files 탭 — 트리만 */}
        {activeTab === 'files' && (
          <div style={styles.fileTreeWrap}>
            <FileTree
              onFileSelect={onFileSelect}
              onFolderSelect={onFolderSelect}
              onOpenTerminalAtFolder={(p) => onOpenTerminalAtFolder?.(p)}
              gitContextPath={gitContextPath}
              language={language}
              initialPath={selectedFolderPath}
            />
          </div>
        )}

        {/* git 탭 — 활성 터미널 cwd 가 속한 repo 의 변경사항. 클릭 → 파일 열기 (우측 패널 없음) */}
        {activeTab === 'git' && (
          <ChangesList
            gitContextPath={gitContextPath}
            onSelectFile={(p) => {
              onFileSelect?.(p);
              if (isMobile) onClose();
            }}
            onOpenFile={(p) => {
              onFileSelect?.(p);
              if (isMobile) onClose();
            }}
            t={t}
          />
        )}

        {/* 푸터: 컨텍스트 정보 — 활성 세션이 호스트면 호스트 라벨, 로컬이면 로컬 시스템 통계 */}
        <div
          style={{
            ...styles.footer,
            paddingBottom: isMobile ? 'calc(34px + env(safe-area-inset-bottom, 0px))' : space['2'],
          }}
        >
          {activeSession?.kind === 'host' ? (
            <div style={styles.footerHostLabel}>
              <Server size={11} strokeWidth={2} style={{ color: color.accent, flexShrink: 0 }} />
              <span style={styles.footerHostName}>{activeSession.name}</span>
              <span style={styles.footerHostBadge}>{t('remoteLabel') || 'remote'}</span>
            </div>
          ) : (
            <>
              <Stat icon={Cpu} value={`${systemStats.cpu}%`} hue={color.accent} />
              <Stat icon={Activity} value={`${systemStats.ram}%`} hue={color.success} />
              <Stat icon={HardDrive} value={`${systemStats.disk}%`} hue={color.info} />
            </>
          )}
        </div>

        </div>

        {!isMobile && onResizeStart && (
          <div
            onMouseDown={onResizeStart}
            title={t('resizeSidebar')}
            style={styles.resizeHandle}
          />
        )}
      </aside>
    </>
  );
};

// 좌측 세로 아이콘 (JupyterLab/VS Code activity bar 식)
const ActivityIcon = ({ active, onClick, icon: Icon, title, badge }) => (
  <button
    onClick={onClick}
    title={badge != null && badge > 0 ? `${title} (${badge})` : title}
    style={{
      position: 'relative',
      width: '40px',
      height: '36px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      color: active ? color.text : color.muted,
      border: 'none',
      borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
      cursor: 'pointer',
      transition: 'color 120ms ease, border-left-color 120ms ease',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = color.text; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = color.muted; }}
  >
    <Icon size={16} strokeWidth={2} />
    {badge != null && badge > 0 && (
      <span style={{
        position: 'absolute',
        top: '4px',
        right: '4px',
        minWidth: '14px',
        height: '14px',
        padding: '0 3px',
        fontSize: '9px',
        lineHeight: '14px',
        textAlign: 'center',
        fontFamily: font.mono,
        color: color.crust,
        background: color.accent,
        borderRadius: '999px',
      }}>
        {badge}
      </span>
    )}
  </button>
);

const RowAction = ({ onClick, icon: Icon, title, tone }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      ...styles.rowActionBtn,
      color: tone === 'danger' ? color.danger : color.muted,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon size={12} strokeWidth={2} />
  </button>
);

const Stat = ({ icon: Icon, value, hue }) => (
  <div style={styles.stat}>
    <Icon size={11} strokeWidth={2} style={{ color: hue }} />
    <span style={styles.statValue}>{value}</span>
  </div>
);

const styles = {
  aside: {
    position: 'fixed',
    top: 0,
    left: 0,
    display: 'flex',
    flexDirection: 'row',
    background: color.mantle,
    borderRight: `1px solid ${color.border}`,
    fontFamily: font.sans,
    zIndex: 9999,
    transition: `width ${motion.normal}`,
  },
  activityBar: {
    width: '40px',
    minWidth: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    background: color.crust,
    borderRight: `1px solid ${color.border}`,
    paddingTop: '4px',
  },
  panelArea: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  closeBtn: {
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
  },
  searchRow: {
    display: 'flex',
    gap: space['1.5'],
    padding: `${space['2']} ${space['2']} ${space['1.5']}`,
  },
  searchInputWrap: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    height: '28px',
    padding: `0 ${space['2']}`,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: color.text,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${space['2']} ${space['2']}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space['1'],
  },
  empty: {
    textAlign: 'center',
    padding: `${space['8']} ${space['4']}`,
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
  cardOuter: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `${space['2']} ${space['3']}`,
    paddingLeft: space['4'],
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}, border-radius ${motion.fast}`,
    minHeight: '46px',
  },
  activeBar: {
    position: 'absolute',
    left: '6px',
    top: '10px',
    bottom: '10px',
    width: '2px',
    borderRadius: '2px',
    transition: `background ${motion.fast}`,
  },
  dot: {
    flexShrink: 0,
    width: '7px',
    height: '7px',
    borderRadius: radius.full,
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: fontSize['13'],
    color: color.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  rowSub: {
    fontSize: fontSize['11'],
    color: color.muted,
    fontFamily: font.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: '1px',
  },
  editInput: {
    width: '100%',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.xs,
    padding: '2px 6px',
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    outline: 'none',
  },
  rowActions: {
    display: 'flex',
    gap: '2px',
  },
  rowActionBtn: {
    width: '22px',
    height: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}`,
  },
  fileTreeWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  footer: {
    display: 'flex',
    gap: space['3'],
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: `${space['2']} ${space['3']}`,
    background: color.crust,
    borderTop: `1px solid ${color.border}`,
  },
  stat: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space['1'],
  },
  statValue: {
    fontSize: fontSize['11'],
    color: color.subtext,
    fontFamily: font.mono,
    fontVariantNumeric: 'tabular-nums',
  },
  footerHostLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    width: '100%',
    minWidth: 0,
  },
  footerHostName: {
    flex: 1,
    fontSize: fontSize['12'],
    color: color.text,
    fontWeight: fontWeight.medium,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footerHostBadge: {
    fontSize: fontSize['11'],
    color: color.accent,
    background: color.accentSubtle,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.full,
    padding: `1px ${space['1.5']}`,
    flexShrink: 0,
    fontFamily: font.mono,
    letterSpacing: '0.04em',
  },
  resizeHandle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '3px',
    cursor: 'ew-resize',
    background: 'transparent',
    transition: `background ${motion.fast}`,
    zIndex: 10000,
  },
};

export default memo(Sidebar);
