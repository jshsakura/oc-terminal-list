import { useState, memo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, GitBranch, Palette, X, RefreshCw, FileText, Trash2,
  Info, Server, Monitor, Terminal as TerminalIcon, Anchor, Copy, Check, Wifi, KeyRound,
  ExternalLink, MoreHorizontal,
  GripVertical, Columns2, Rows2,
  Eye, EyeOff,
  XCircle, Zap,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { glassMenuItemHover, glassMenuStyle, glassPanelStyle, glassSectionStyle } from '../styles/glass';
import FileTree from './FileTree';
import SkeletonRow from './common/SkeletonRow';
import ChangesList from './ChangesList';
import ThemePicker from './common/ThemePicker';
import useGitChanges from '../hooks/useGitChanges';
import useCommandHistory from '../hooks/useCommandHistory';
import { removeCommand as removeHistoryCommand, clearCommandsFor as clearHistoryFor } from '../utils/commandHistory';
import RailIconBtn from './common/RailIconBtn';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

/** Mirrored icons for split-left / split-up — same shape, flipped for visual distinction. */
const ColumnsFlipX = (props) => <Columns2 {...props} style={{ transform: 'scaleX(-1)' }} />;
const RowsFlipY = (props) => <Rows2 {...props} style={{ transform: 'scaleY(-1)' }} />;

const DEFAULT_PANEL_WIDTH = 260;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;
const TOP_RAIL_HEIGHT = 30;
const PANEL_STATE_PREFIX = 'iterm:terminal-header-panel:v1:';

const TABS = [
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'git',   icon: GitBranch, label: 'Git' },
  { id: 'info',  icon: Info,     label: 'Info' },
  { id: 'theme', icon: Palette,   label: 'Theme' },
];
const PANEL_IDS = new Set(TABS.map((tab) => tab.id));

const readPanelState = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH };
    const parsed = JSON.parse(raw);
    const activePanel = PANEL_IDS.has(parsed?.activePanel) ? parsed.activePanel : null;
    const width = Number(parsed?.panelWidth);
    const panelWidth = Number.isFinite(width)
      ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width))
      : DEFAULT_PANEL_WIDTH;
    return { activePanel, panelWidth };
  } catch {
    return { activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH };
  }
};

const TerminalHeader = ({
  isFocused = false, // pane 포커스 여부 — 사이드바 하단 눈 아이콘 (Eye/EyeOff) 으로 표시.
  showFocusEye = false, // legacy hint; focus eye now keeps a stable slot for every live terminal.
  activeTabType,    // 'local' | 'host' | null
  activeHostId = null,
  gitContextPath = '',
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  onRefreshTerminal = null,  // 호출 시 활성 터미널을 통째로 remount (WS 재접속)
  onRefreshCwd = null,       // 파일 패널 새로고침 시 현재 tmux cwd 를 1회 재조회
  selectedFolderPath = '',
  settings,
  updateSettings,
  /* per-pane 테마 오버라이드 — 이 패널은 한 pane 의 컨텍스트이므로 theme 픽커는 그 pane 에만 적용.
     paneThemeId = 현재 pane 에 실제로 적용된 테마 id (override 없으면 settings.theme).
     onPaneThemeChange(id) — pane 의 themeOverride 를 바꿈. id===settings.theme 면 override 해제. */
  paneThemeId = null,
  onPaneThemeChange = null,
  /* Info 패널 컨텍스트 — pane/tab/host/cwd 메타데이터 묶음. PaneGrid 가 채워서 보냄. */
  paneInfo = null,
  language = 'en',
  t,
  viewportHeight,
  disabled = false,  // 빈 pane 일 때 활동바만 표시 / 클릭 무효
  loading = false,   // 터미널 연결 중 — 레일 아이콘 스켈레톤
  terminalKey = null, // window.terminalSessions[key] lookup — 페이지 업/다운 송신용
  paneCwd = null,     // 호스트 모드 FileTree 시작 경로 (없으면 host.start_path)
  onScreenDump = null, // 텍스트 덤프 모달 열기 콜백 (App.jsx 가 처리)
  onCloseTerminal = null, // pane 닫기 — 단일 pane 이면 closePane 이 closeTab 으로 위임
  /* 분할 pane 을 새 탭으로 detach — null 이면 버튼 숨김 (단일 pane / 빈 pane). */
  onExtractPane = null,
  /* pane rail 분할 버튼 — (dir) => void. dir = 'right'|'left'|'down'|'up'|'2x2'. */
  onSplitPane = null,
  /* 모든 분할 팬 사이즈 균등 리셋 */
  onEqualizePane = null,
  /* busy 인디케이터 — 터미널 활동 점멸 여부. */
  isBusy = false,
  /* 터미널 세션 상태 — { evicted, ended, isReady, hasContent }. */
  sessionStatus = null,
  isMobile = false,
  filePanelOpen = false,
  onFilePanelToggle = null,
}) => {
  const panelTheme = themes[paneThemeId || settings?.theme] || themes.catppuccin;
  const panelUi = buildThemeUI(panelTheme);
  // 페이지 단위 스크롤 — 모바일에서는 물리 PgUp/PgDn 키가 없어서 가장 자주
  // 막히는 동작. xterm.js 의 viewport 를 직접 스크롤 (tmux scrollback 와는
  // 별개의 클라이언트 버퍼) 해 즉시 반응.
  const sendScroll = useCallback((pages) => {
    const sess = terminalKey ? window.terminalSessions?.[terminalKey] : null;
    sess?.scrollPages?.(pages);
  }, [terminalKey]);

  const handleDump = useCallback(() => {
    const sess = terminalKey ? window.terminalSessions?.[terminalKey] : null;
    const text = sess?.getBufferText?.(true) || '';
    onScreenDump?.(text);
  }, [terminalKey, onScreenDump]);
  const panelStorageKey = `${PANEL_STATE_PREFIX}${paneInfo?.paneId || terminalKey || 'default'}`;
  const [activePanel, setActivePanel] = useState(() => readPanelState(panelStorageKey).activePanel);
  const [panelWidth, setPanelWidth] = useState(() => readPanelState(panelStorageKey).panelWidth);
  const [filePanelRevealPath, setFilePanelRevealPath] = useState(null);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const [railMenu, setRailMenu] = useState(null);
  const moreBtnRef = useRef(null);
  const railMenuClosedAtRef = useRef(0);
  const [splitMenu, setSplitMenu] = useState(null);
  const splitBtnRef = useRef(null);
  const splitMenuClosedAtRef = useRef(0);
  // Eye 아이콘 클릭 → 이 터미널의 명령 히스토리 popover.
  // Anchor 는 button rect (RailSubMenu 와 동일 패턴).
  const [historyMenu, setHistoryMenu] = useState(null);
  const eyeBtnRef = useRef(null);
  const historyMenuClosedAtRef = useRef(0);
  const handleEyeClick = useCallback(() => {
    if (historyMenu) {
      setHistoryMenu(null);
      historyMenuClosedAtRef.current = Date.now();
      return;
    }
    if (Date.now() - historyMenuClosedAtRef.current < 300) return;
    if (eyeBtnRef.current) {
      const rect = eyeBtnRef.current.getBoundingClientRect();
      setHistoryMenu({ x: rect.right, y: rect.bottom + 4 });
    }
  }, [historyMenu]);
  const closeHistoryMenu = useCallback(() => {
    setHistoryMenu(null);
    historyMenuClosedAtRef.current = Date.now();
  }, []);
  const [panelResizeHot, setPanelResizeHot] = useState(false);
  const [panelResizing, setPanelResizing] = useState(false);

  const closePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  const handleMoreClick = useCallback(() => {
    if (railMenu) {
      setRailMenu(null);
      railMenuClosedAtRef.current = Date.now();
      return;
    }
    // Prevent immediate reopen from outside-click close
    if (Date.now() - railMenuClosedAtRef.current < 300) return;
    if (moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setRailMenu({ x: rect.right, y: rect.bottom + 4 });
    }
  }, [railMenu]);

  const closeRailMenu = useCallback(() => {
    setRailMenu(null);
    railMenuClosedAtRef.current = Date.now();
  }, []);

  const handleSplitClick = useCallback(() => {
    if (splitMenu) {
      setSplitMenu(null);
      splitMenuClosedAtRef.current = Date.now();
      return;
    }
    if (Date.now() - splitMenuClosedAtRef.current < 300) return;
    if (splitBtnRef.current) {
      const rect = splitBtnRef.current.getBoundingClientRect();
      setSplitMenu({ x: rect.right, y: rect.bottom + 4 });
    }
  }, [splitMenu]);

  const closeSplitMenu = useCallback(() => {
    setSplitMenu(null);
    splitMenuClosedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (activePanel && panelRef.current) panelRef.current.focus();
  }, [activePanel]);

  useEffect(() => {
    const saved = readPanelState(panelStorageKey);
    setActivePanel(saved.activePanel);
    setPanelWidth(saved.panelWidth);
  }, [panelStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(panelStorageKey, JSON.stringify({ activePanel, panelWidth }));
    } catch { /* ignore storage quota/private mode */ }
  }, [panelStorageKey, activePanel, panelWidth]);

  useEffect(() => {
    if (!activePanel) return;
    const id = setTimeout(() => {
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
        }
      };
      const handleMouseDown = (e) => {
        if (rootRef.current?.contains(e.target)) return;
        if (panelRef.current && !panelRef.current.contains(e.target)) {
          closePanel();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleMouseDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('mousedown', handleMouseDown);
      };
    }, 0);
    return () => clearTimeout(id);
  }, [activePanel, closePanel]);

  const togglePanel = useCallback((id) => {
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setPanelResizeHot(true);
    setPanelResizing(true);
    resizingRef.current = true;
    startXRef.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    startWidthRef.current = panelWidth;
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const cx = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
      const delta = cx - startXRef.current;
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidthRef.current + delta));
      setPanelWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      setPanelResizeHot(false);
      setPanelResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('blur', onUp);
  }, [panelWidth]);

  // Git 변경 카운트 — 활동 바 뱃지에 표시.
  // local: 로컬 워크스페이스 git API
  // host:  원격 호스트 SSH git API (hostId + remoteCwd)
  const isRemote = !!activeHostId;
  const gitPanelOpen = activePanel === 'git';
  // 리모트: 패널 열릴 때만 30s 폴링, 닫히면 폴링 중단 (SSH 연결 비용)
  // 로컬: 패널 열림 4s / 닫힘 15s (로컬 API는 저렴)
  const gitEnabled = isRemote
    ? gitPanelOpen
    : (gitContextPath != null || !!activeHostId);
  const gitIntervalMs = isRemote ? 30000 : (gitPanelOpen ? 4000 : 15000);
  const gitChanges = useGitChanges({
    enabled: gitEnabled,
    path: activeHostId ? (paneCwd || '') : (gitContextPath || ''),
    hostId: activeHostId || null,
    intervalMs: gitIntervalMs,
  });
  const { items: gitItems, refresh: refreshGitChanges } = gitChanges;
  const gitCount = (gitContextPath != null || !!activeHostId) ? (gitItems || []).length : 0;
  const activePanelMeta = activePanel ? TABS.find((tab) => tab.id === activePanel) : null;
  const ActivePanelIcon = activePanelMeta?.icon || Info;
  const filePanelInitialPath = filePanelRevealPath ?? (
    activeHostId
      ? (paneCwd || null)
      : (paneCwd ?? gitContextPath ?? selectedFolderPath ?? '')
  );

  const revealInFilePanel = useCallback((folderPath) => {
    setFilePanelRevealPath(folderPath || '');
    setActivePanel('files');
    if (onFilePanelToggle && !filePanelOpen) onFilePanelToggle();
    onFolderSelect?.(folderPath || '');
  }, [filePanelOpen, onFilePanelToggle, onFolderSelect]);

  useEffect(() => {
    if (activePanel === 'files') {
      onRefreshCwd?.();
    } else if (activePanel === 'git') {
      refreshGitChanges?.();
    }
  }, [activePanel, onRefreshCwd, refreshGitChanges]);

  return (
    <div ref={rootRef} style={{ ...styles.root, borderTopColor: panelUi.border }}>
      {/* 사이드바 내부 스크롤바 — 현재 pane 의 테마(panelUi) 색으로 직접 박음.
          글로벌 스크롤바 룰보다 더 specific + !important 로 확실히 오버라이드.
          폭 6px, 색은 surface1 (mid-tone) — 너무 찐한 느낌 완화. */}
      <style>{`
        @keyframes iterm-pane-busy-dot {
          0%, 100% { opacity: 0.48; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes iterm-skel-shimmer {
          0%   { background-position: 150% center; }
          100% { background-position: -150% center; }
        }
        @keyframes skel-pulse {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.78; }
        }
        @keyframes iterm-cwd-shine {
          0%,  70% { background-position: -200% center; }
          85%, 100% { background-position: 200% center; }
        }
        .iterm-terminal-header-panelbody, .iterm-terminal-header-panelbody * {
          scrollbar-width: thin !important;
          scrollbar-color: ${panelUi.surface1} transparent !important;
        }
        .iterm-terminal-header-panelbody::-webkit-scrollbar,
        .iterm-terminal-header-panelbody *::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
        .iterm-terminal-header-panelbody::-webkit-scrollbar-thumb,
        .iterm-terminal-header-panelbody *::-webkit-scrollbar-thumb {
          background: ${panelUi.surface1} !important;
          border-radius: 3px !important;
        }
        .iterm-terminal-header-panelbody::-webkit-scrollbar-thumb:hover,
        .iterm-terminal-header-panelbody *::-webkit-scrollbar-thumb:hover {
          background: ${panelUi.accent} !important;
        }
        .iterm-terminal-header-panelbody::-webkit-scrollbar-track,
        .iterm-terminal-header-panelbody *::-webkit-scrollbar-track {
          background: transparent !important;
        }
      `}</style>

      {/* activity bar */}
      <div style={{
        ...styles.activityBar,
        background: panelUi.base,
        borderBottomColor: panelUi.borderSubtle || panelUi.border,
      }}>
        {/* Far-left: drag/move handle affordance — empty panes can be dragged too */}
        {!isMobile && !loading && (
          <div
            title={t?.('paneHandle') || 'Move / split handle'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              flexShrink: 0,
              cursor: 'grab',
              marginRight: '1px',
              pointerEvents: loading ? 'none' : 'auto',
              borderRadius: radius.md,
              color: panelUi.muted,
              transition: 'color 150ms, background 150ms',
            }}
            draggable
            onDragStart={(e) => {
              const payload = JSON.stringify({
                type: 'pane',
                tabId: paneInfo?.tabId || paneInfo?.sessionId,
                paneId: paneInfo?.paneId,
              });
              e.dataTransfer.setData('text/plain', payload);
              e.dataTransfer.setData('application/x-iterminallist-pane', payload);
              e.dataTransfer.effectAllowed = 'move';
              window.__draggingPaneId = paneInfo?.paneId || null;
            }}
            onDragEnd={() => { window.__draggingPaneId = null; }}
            onMouseEnter={(e) => { e.currentTarget.style.color = panelUi.text; e.currentTarget.style.background = panelUi.surface1 || 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = panelUi.muted; e.currentTarget.style.background = 'transparent'; }}
          >
            <GripVertical size={12} strokeWidth={2} />
          </div>
        )}

        {/* Left: tab strip — 4 main panel tabs only */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          gap: '2px',
          minWidth: 0,
          overflow: 'hidden',
          opacity: disabled ? 0.4 : 1,
          pointerEvents: (disabled || loading) ? 'none' : 'auto',
        }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 2px', overflow: 'hidden' }}>
              {TABS.map((_, i) => (
                <div key={i} style={{
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  background: `linear-gradient(90deg,
                    color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 0%,
                    color-mix(in srgb, ${panelUi.accent || '#89b4fa'} 22%, transparent) 50%,
                    color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 100%)`,
                  backgroundSize: '300% 100%',
                  animation: `iterm-skel-shimmer ${1.6 + i * 0.08}s ease-in-out infinite, skel-pulse 1.4s ease-in-out infinite`,
                  animationDelay: `${i * 130}ms`,
                  flexShrink: 0,
                }} />
              ))}
            </div>
          ) : (
            TABS.map(({ id, icon: Icon, label }) => {
              const isFilesTab = id === 'files';
              const isActive = isFilesTab && onFilePanelToggle
                ? filePanelOpen
                : activePanel === id;
              const handleTabClick = () => {
                if (disabled) return;
                if (isFilesTab && onFilePanelToggle) {
                  onFilePanelToggle();
                } else {
                  togglePanel(id);
                }
              };
              const badge = id === 'git' && gitCount > 0 ? gitCount : null;
              return (
                <RailIconBtn
                  key={id}
                  icon={Icon}
                  onClick={handleTabClick}
                  title={badge ? `${label} (${badge})` : label}
                  active={isActive}
                  disabled={disabled}
                  badge={badge}
                  ui={panelUi}
                  compact
                />
              );
            })
          )}
        </div>

        <CwdBreadcrumb paneInfo={paneInfo} loading={loading} disabled={disabled} ui={panelUi} onRefreshCwd={onRefreshCwd} t={t} />

        {/* Right cluster: split buttons → busy dot → … menu */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          gap: '1px', flexShrink: 0,
        }}>
            {/* Focus eye — stable status slot. Activity/session notices are only the dot overlay. */}
            {!disabled && (() => {
              const isEvicted = !!sessionStatus?.evicted;
              const hasBadge = isBusy || isEvicted;
              const dotBg = isEvicted ? (panelUi.warning || '#f9e2af') : panelUi.accent;
              const badgeTitle = isEvicted
                ? (t?.('sessionTakenOver') || 'Session taken over')
                : (t?.('terminalBusy') || 'Terminal is active');
              const eyeTitle = isFocused ? (t?.('paneFocused') || 'Focused') : (t?.('paneUnfocused') || 'Unfocused');
              const clickTitle = t?.('showHistory') || 'Show recent commands';
              return (
                <div ref={eyeBtnRef} style={{ position: 'relative', flexShrink: 0, opacity: (isFocused || hasBadge) ? 1 : 0.62, transition: 'opacity 120ms' }} title={hasBadge ? badgeTitle : clickTitle}>
                  <RailIconBtn
                    icon={isFocused ? Eye : EyeOff}
                    tone={isFocused ? 'accent' : undefined}
                    onClick={terminalKey ? handleEyeClick : undefined}
                    title={terminalKey ? clickTitle : eyeTitle}
                    ariaLabel={terminalKey ? clickTitle : eyeTitle}
                    active={!!historyMenu}
                    ui={panelUi}
                    compact
                  />
                  {hasBadge && (
                    <span style={{
                      position: 'absolute',
                      top: '3px',
                      right: '3px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: dotBg,
                      boxShadow: isEvicted
                        ? `0 0 0 1.5px ${panelUi.base}, 0 0 5px ${panelUi.warning || '#f9e2af'}`
                        : `0 0 0 1.5px ${panelUi.base}, 0 0 5px ${panelUi.accent}`,
                      animation: 'iterm-pane-busy-dot 1.15s ease-in-out infinite',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>
              );
            })()}
            {/* Single split button — opens dropdown with left/right/up/down choices */}
            {loading && onSplitPane && (
              <div style={{
                width: '20px',
                height: '6px',
                borderRadius: '3px',
                background: `linear-gradient(90deg,
                  color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 0%,
                  color-mix(in srgb, ${panelUi.accent || '#89b4fa'} 22%, transparent) 50%,
                  color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 100%)`,
                backgroundSize: '300% 100%',
                animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite, skel-pulse 1.4s ease-in-out infinite',
                animationDelay: '480ms',
                flexShrink: 0,
              }} />
            )}
            {!disabled && !loading && onSplitPane && (
              <div ref={splitBtnRef}>
                <RailIconBtn
                  icon={Columns2}
                  onClick={handleSplitClick}
                  title={t?.('splitPane') || 'Split pane'}
                  active={!!splitMenu}
                  ui={panelUi}
                  compact
                />
              </div>
            )}


            {/* Empty pane: direct X close button instead of the … menu */}
            {disabled && onCloseTerminal && (
              <RailIconBtn
                icon={X}
                onClick={onCloseTerminal}
                title={t?.('close') || 'Close'}
                ui={panelUi}
                compact
              />
            )}

            {/* More menu button — hidden for empty panes (only one action → surfaced above) */}
            {!disabled && (
            <div ref={moreBtnRef}>
              {loading ? (
                <div style={{
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  background: `linear-gradient(90deg,
                    color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 0%,
                    color-mix(in srgb, ${panelUi.accent || '#89b4fa'} 22%, transparent) 50%,
                    color-mix(in srgb, ${panelUi.surface1 || '#45475a'} 50%, transparent) 100%)`,
                  backgroundSize: '300% 100%',
                  animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite, skel-pulse 1.4s ease-in-out infinite',
                  animationDelay: '640ms',
                  flexShrink: 0,
                }} />
              ) : (
                <RailIconBtn
                  icon={MoreHorizontal}
                  onClick={handleMoreClick}
                  title={t?.('more') || 'More'}
                  active={!!railMenu}
                  ui={panelUi}
                  compact
                />
              )}
            </div>
            )}
        </div>
      </div>

      {/* RailSubMenu — portal to document.body */}
      {railMenu && createPortal(
        <RailSubMenu
          anchor={railMenu}
          ui={panelUi}
          isMobile={isMobile}
          onClose={closeRailMenu}
          t={t}
        >
          {onCloseTerminal && (
            <MenuBtn icon={disabled ? X : Trash2} onClick={() => { closeRailMenu(); onCloseTerminal(); }} danger={!disabled} ui={panelUi}>
              {disabled ? (t?.('close') || 'Close') : (t?.('closeTerminal') || 'Close terminal')}
            </MenuBtn>
          )}
          {onExtractPane && (
            <MenuBtn icon={ExternalLink} onClick={() => { closeRailMenu(); onExtractPane(); }} ui={panelUi}>
              {t?.('detachPane') || 'Detach to new tab'}
            </MenuBtn>
          )}
          {!disabled && terminalKey && (
            <>
              <MenuBtn icon={FileText} onClick={() => { closeRailMenu(); handleDump(); }} ui={panelUi}>
                {t?.('viewAsText') || 'View as text'}
              </MenuBtn>
            </>
          )}
          {onRefreshTerminal && !disabled && (
            <MenuBtn icon={RefreshCw} onClick={() => { closeRailMenu(); onRefreshTerminal(); }} ui={panelUi}>
              {t?.('refreshTerminal') || 'Reload terminal'}
            </MenuBtn>
          )}
        </RailSubMenu>,
        document.body
      )}

      {/* Per-terminal command history — anchored under the eye icon */}
      {historyMenu && terminalKey && createPortal(
        <CommandHistoryPopover
          anchor={historyMenu}
          terminalKey={terminalKey}
          ui={panelUi}
          isMobile={isMobile}
          onClose={closeHistoryMenu}
          onSelect={(text) => {
            const session = window.terminalSessions?.[terminalKey];
            if (!session?.sendData) return;
            session.sendData(text);
            window.setTimeout(() => session.sendData?.('\r'), 40);
            closeHistoryMenu();
          }}
          t={t}
        />,
        document.body
      )}

      {/* Split pane dropdown — portal to document.body */}
      {splitMenu && createPortal(
        <RailSubMenu
          anchor={splitMenu}
          ui={panelUi}
          isMobile={isMobile}
          onClose={closeSplitMenu}
          t={t}
        >
          <MenuBtn icon={ColumnsFlipX} onClick={() => { closeSplitMenu(); onSplitPane('left'); }} ui={panelUi}>
            {t?.('splitLeft') || 'Split left'}
          </MenuBtn>
          <MenuBtn icon={Columns2} onClick={() => { closeSplitMenu(); onSplitPane('right'); }} ui={panelUi}>
            {t?.('splitRight') || 'Split right'}
          </MenuBtn>
          <MenuBtn icon={RowsFlipY} onClick={() => { closeSplitMenu(); onSplitPane('up'); }} ui={panelUi}>
            {t?.('splitUp') || 'Split up'}
          </MenuBtn>
          <MenuBtn icon={Rows2} onClick={() => { closeSplitMenu(); onSplitPane('down'); }} ui={panelUi}>
            {t?.('splitDown') || 'Split down'}
          </MenuBtn>
        </RailSubMenu>,
        document.body
      )}

      {/* content panel — absolute overlay below top rail (left-side panel).
          Files panel is rendered inline in PaneGrid when onFilePanelToggle is set. */}
      {activePanel && !disabled && !(activePanel === 'files' && onFilePanelToggle) && (
        <div
          ref={panelRef}
          tabIndex={-1}
          style={{
            ...styles.panel,
            ...glassPanelStyle(panelUi, { boxShadow: 'none' }),
            color: panelUi.text,
            // Mobile: full-width overlay. Desktop: resizable fixed width.
            ...(isMobile ? { left: 0, right: 0 } : { width: `${panelWidth}px` }),
            position: 'absolute',
            top: `${TOP_RAIL_HEIGHT}px`,
            bottom: 0,
            left: 0,
            zIndex: 10,
            outline: 'none',
            pointerEvents: 'auto',
          }}>
          {/* 리사이즈 드래그 핸들 — 패널 우측 가장자리 */}
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            onMouseEnter={() => setPanelResizeHot(true)}
            onMouseLeave={() => { if (!panelResizing) setPanelResizeHot(false); }}
            title={t?.('resizePanel') || 'Resize panel'}
            style={{
              position: 'absolute',
              top: 0, right: '-4px', bottom: 0,
              width: '9px',
              cursor: panelResizing ? 'col-resize' : 'ew-resize',
              zIndex: 2,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'stretch',
              touchAction: 'none',
            }}
          >
            <div
              style={{
                width: '1px',
                height: '100%',
                borderRadius: radius.full,
                opacity: panelResizeHot || panelResizing ? 1 : 0,
                background: panelResizing
                  ? panelUi.accent
                  : `color-mix(in srgb, ${panelUi.accent} 72%, transparent)`,
                boxShadow: panelResizeHot || panelResizing
                  ? `0 0 12px color-mix(in srgb, ${panelUi.accent} 38%, transparent)`
                  : 'none',
                transform: panelResizeHot || panelResizing ? 'scaleX(1)' : 'scaleX(0.6)',
                transformOrigin: 'center',
                transition: 'opacity 120ms, background 120ms, box-shadow 120ms, transform 120ms',
                pointerEvents: 'none',
              }}
            />
          </div>
          <div style={{ ...styles.panelHeader, ...glassSectionStyle(panelUi), borderBottomColor: glassSectionStyle(panelUi).borderColor }}>
            <span style={{ ...styles.panelTitle, color: panelUi.text }}>
              <ActivePanelIcon size={13} strokeWidth={2} aria-hidden="true" style={{ color: panelUi.accent }} />
              <span>{activePanelMeta?.label}</span>
            </span>
            <button
              style={styles.closeBtn}
              onClick={closePanel}
              onMouseEnter={(e) => { e.currentTarget.style.background = panelUi.surface1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
          <div className="iterm-terminal-header-panelbody" style={{ ...styles.panelBody, background: 'transparent', color: panelUi.text }}>
            {activePanel === 'files' && (
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <FileTree
                  key={`${activeHostId ?? 'local'}:${filePanelInitialPath ?? 'home'}`}
                  hostId={activeHostId}
                  onFileSelect={onFileSelect}
                  onFolderSelect={onFolderSelect}
                  onOpenTerminalAtFolder={onOpenTerminalAtFolder}
                  onRefreshCwd={onRefreshCwd}
                  gitContextPath={gitContextPath}
                  sharedGitChanges={gitChanges}
                  language={language}
                  initialPath={filePanelInitialPath}
                />
              </div>
            )}
            {activePanel === 'git' && (
              <ChangesList
                gitContextPath={gitContextPath}
                sharedGitChanges={gitChanges}
                hostId={activeHostId}
                onSelectFile={onFileSelect}
                onOpenFile={onFileSelect}
                onRevealInFiles={revealInFilePanel}
                t={t}
              />
            )}
            {activePanel === 'theme' && (
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <ThemeSettings
                  paneThemeId={paneThemeId || settings.theme}
                  globalThemeId={settings.theme}
                  onPaneThemeChange={onPaneThemeChange}
                  t={t}
                />
              </div>
            )}
            {activePanel === 'info' && (
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <InfoPanel
                  info={paneInfo}
                  paneThemeId={paneThemeId}
                  globalThemeId={settings.theme}
                  t={t}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// RailSubMenu — per-pane "…" dropdown for secondary actions (close, detach,
// page scroll, log dump, refresh, focus indicator). Positioned via measured
// pattern; uses stable ref + setTimeout(0) for outside-click / Escape per AGENTS.md.

const RailSubMenu = ({ anchor, ui, isMobile = false, onClose, t, children }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => {
      if (!ref.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = anchor.x - rect.width;
      let nextY = anchor.y;
      if (nextX < margin) nextX = margin;
      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;
      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  return (
    <div
      ref={ref}
      className={isMobile ? 'iterm-rail-submenu-mobile' : undefined}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        minWidth: '160px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
      }}
    >
      {isMobile && (
        <style>{`
          .iterm-rail-submenu-mobile > button {
            min-height: 42px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
          .iterm-rail-submenu-mobile > button > svg {
            width: 15px !important;
            height: 15px !important;
          }
        `}</style>
      )}
      {children}
    </div>
  );
};

const MenuBtn = ({ icon: Icon, onClick, children, danger = false, disabled = false, display = false, ui }) => {
  const fg = danger ? (ui?.danger || color.danger) : (ui?.text || color.text);
  // Stop propagation on all pointer events so the portal's outside-click listener
  // cannot swallow or duplicate the interaction. This is critical for the "Close terminal"
  // action where closeRailMenu() + onCloseTerminal() must both fire without interference.
  const stop = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      onClick={display ? undefined : onClick}
      onPointerDown={stop}
      onTouchStart={stop}
      onMouseDown={stop}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        textAlign: 'left',
        minHeight: '30px',
        padding: '6px 9px',
        background: 'transparent',
        border: 'none',
        borderRadius: '3px',
        cursor: display ? 'default' : (disabled ? 'default' : 'pointer'),
        color: fg,
        fontSize: '11.5px',
        fontFamily: 'inherit',
        transition: 'background 120ms',
        lineHeight: 1.3,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled && !display) e.currentTarget.style.background = glassMenuItemHover(ui); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {Icon && <Icon size={13} strokeWidth={1.8} />}
      {children}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CommandHistoryPopover — eye 아이콘 아래에 뜨는 작은 popover.
// 해당 터미널에서 보냈던 최근 명령 N개를 보여주고, 클릭 시 다시 보냄.
//
// 동작:
// - 외부 클릭 / Escape 로 닫힘 (setTimeout(0) 패턴 — 즉시 자동 닫힘 방지)
// - 등장 시 fade + 살짝 위에서 내려오는 모션
// - 각 row 는 mono font, ellipsis, X 로 개별 삭제 가능
const CommandHistoryPopover = ({ anchor, terminalKey, ui, isMobile = false, onClose, onSelect, t }) => {
  const ref = useRef(null);
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  // "비우기" 확정 단계 — 휴지통 한 번 누르면 inline 확인 영역이 popover 안에 오버레이.
  // 외부 confirm() 다이얼로그는 popover 컨텍스트를 끊고 모바일 UX 가 어색해서 안 쓴다.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(terminalKey);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => { if (!ref.current?.contains(e.target)) onCloseRef.current(); };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let nextX = anchor.x - rect.width;
    let nextY = anchor.y;
    if (nextX < margin) nextX = margin;
    if (nextX + rect.width > window.innerWidth - margin) {
      nextX = window.innerWidth - rect.width - margin;
    }
    if (nextY + rect.height > window.innerHeight - margin) {
      nextY = window.innerHeight - rect.height - margin;
    }
    if (nextY < margin) nextY = margin;
    setPos({ x: nextX, y: nextY });
    setMeasured(true);
  }, [anchor.x, anchor.y, items.length]);

  // 인피니티 스크롤 — 리스트 끝 sentinel 이 viewport 안에 들어오면 다음 페이지 fetch.
  // IntersectionObserver root 를 listRef (스크롤 컨테이너) 로 지정해 popover 안에서만 trigger.
  useEffect(() => {
    if (!sentinelRef.current || !listRef.current) return undefined;
    if (!hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        // 콘텐츠 길이와 무관하게 일관된 폭 — 짧은 명령으로 줄어들거나 긴 명령으로 350px 까지
        // 늘어나는 일이 없게 고정. 두 줄까지는 wrap 허용.
        width: isMobile ? '260px' : '320px',
        maxHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transform: measured ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 140ms ease, transform 140ms ease',
      }}
    >
      <style>{`
        @keyframes iterm-cmd-history-item-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .iterm-cmd-history-list::-webkit-scrollbar { width: 6px; }
        .iterm-cmd-history-list::-webkit-scrollbar-thumb {
          background: ${ui.surface1 || '#45475a'};
          border-radius: 3px;
        }
        .iterm-cmd-history-list { scrollbar-width: thin; }
        .iterm-cmd-history-item { animation: iterm-cmd-history-item-in 200ms ease both; }
        .iterm-cmd-history-item .__rm { opacity: 0; transition: opacity 120ms; }
        .iterm-cmd-history-item:hover .__rm { opacity: 1; }
      `}</style>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: `1px solid color-mix(in srgb, ${ui.border} 65%, transparent)`,
        background: `color-mix(in srgb, ${ui.base} 38%, transparent)`,
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: fontSize['11'],
          fontWeight: fontWeight.semibold,
          color: ui.subtext,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {t?.('historyTitle') || 'Recent commands'}
          {items.length > 0 && (
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '8px',
              background: `color-mix(in srgb, ${ui.accent} 20%, transparent)`,
              color: ui.text,
              letterSpacing: 'normal',
              textTransform: 'none',
            }}>{items.length}{hasMore ? '+' : ''}</span>
          )}
        </span>
        {items.length > 0 && !confirmingClear && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            title={t?.('clearHistory') || 'Clear history'}
            style={{
              width: '20px', height: '20px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: ui.subtext, padding: 0, borderRadius: '4px',
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Inline confirm bar — 휴지통 버튼 누르면 헤더 아래로 슬라이드해 들어온다. */}
      {confirmingClear && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 10px',
          background: `color-mix(in srgb, ${ui.danger || '#f38ba8'} 14%, transparent)`,
          borderBottom: `1px solid color-mix(in srgb, ${ui.danger || '#f38ba8'} 32%, transparent)`,
          animation: 'iterm-cmd-history-item-in 160ms ease both',
        }}>
          <span style={{
            fontSize: fontSize['11'], color: ui.text, lineHeight: 1.4, flex: 1, minWidth: 0,
          }}>{t?.('confirmClearHistory') || 'Clear command history for this terminal?'}</span>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: 'transparent', border: `1px solid ${ui.border}`,
                color: ui.subtext, fontSize: fontSize['11'], cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 120ms, color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(ui); e.currentTarget.style.color = ui.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ui.subtext; }}
            >
              {t?.('cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => { clearHistoryFor(terminalKey); setConfirmingClear(false); }}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: ui.danger || '#f38ba8',
                color: ui.crust || '#11111b',
                border: '1px solid transparent',
                fontSize: fontSize['11'], fontWeight: fontWeight.semibold, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'opacity 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {t?.('clearHistory') || 'Clear'}
            </button>
          </div>
        </div>
      )}

      <div ref={listRef} className="iterm-cmd-history-list" style={{
        flex: 1, overflowY: 'auto', padding: '4px',
        display: 'flex', flexDirection: 'column', gap: '2px',
      }}>
        {loading && items.length === 0 ? (
          // 첫 로딩 스켈레톤
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                height: '30px', borderRadius: '4px',
                background: `linear-gradient(90deg,
                  color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 0%,
                  color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
                  color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 100%)`,
                backgroundSize: '300% 100%',
                animation: `iterm-skel-shimmer ${1.6 + i * 0.1}s ease-in-out infinite`,
                opacity: 0.6,
              }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{
            padding: '18px 12px', textAlign: 'center',
            fontSize: fontSize['12'], color: ui.subtext, opacity: 0.7,
          }}>
            {t?.('historyEmpty') || 'No history yet'}
          </div>
        ) : items.map((entry, idx) => (
          <div
            key={`${entry.ts}-${idx}`}
            className="iterm-cmd-history-item"
            style={{
              display: 'flex', alignItems: 'stretch', gap: '2px',
              borderRadius: '4px',
              // 등장 애니메이션은 첫 화면 (1페이지) 에만 살짝 — 이후 페이지 prepend 는 stagger 적용 안 함.
              animationDelay: idx < 12 ? `${idx * 18}ms` : '0ms',
            }}
          >
            <button
              type="button"
              onClick={() => onSelect?.(entry.text)}
              title={`${entry.text}\n— ${t?.('clickToResend') || 'click to re-send'}`}
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start',
                background: 'transparent', color: ui.text, border: 'none',
                cursor: 'pointer', padding: '7px 9px',
                fontFamily: font.mono, fontSize: fontSize['12'],
                textAlign: 'left', borderRadius: '4px',
                transition: 'background 120ms',
                lineHeight: 1.35,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(ui); }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {/* 두 줄까지 wrap, 그 이상은 ellipsis. WebkitLineClamp 는 -webkit-box 필수. */}
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
                wordBreak: 'break-all',
              }}>{entry.text}</span>
            </button>
            <button
              type="button"
              className="__rm"
              onClick={(e) => { e.stopPropagation(); removeHistoryCommand(terminalKey, entry.text); }}
              title={t?.('remove') || 'Remove'}
              aria-label={t?.('remove') || 'Remove'}
              style={{
                width: '20px', flexShrink: 0,
                display: 'inline-flex', alignItems: 'flex-start', justifyContent: 'center',
                background: 'transparent', color: ui.subtext,
                border: 'none', cursor: 'pointer', padding: '8px 0 0 0',
                borderRadius: '4px',
                transition: 'background 120ms, color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
            >
              <X size={10} strokeWidth={2.4} />
            </button>
          </div>
        ))}
        {/* 인피니티 스크롤 sentinel — 화면에 닿으면 다음 페이지. hasMore=false 일 때는 비표시. */}
        {items.length > 0 && hasMore && (
          <div ref={sentinelRef} style={{
            padding: '8px 0', display: 'flex', justifyContent: 'center',
            fontSize: '10px', color: ui.subtext, opacity: 0.7,
          }}>
            {loadingMore ? (t?.('loading') || 'Loading…') : '·'}
          </div>
        )}
        {items.length > 0 && !hasMore && !loading && (
          <div style={{
            padding: '8px 0', display: 'flex', justifyContent: 'center',
            fontSize: '10px', color: ui.subtext, opacity: 0.55,
            letterSpacing: '0.05em',
          }}>
            {t?.('historyEnd') || 'End of history'}
          </div>
        )}
      </div>
    </div>
  );
};

const ThemeSettings = memo(({ paneThemeId, globalThemeId, onPaneThemeChange, t }) => {
  const effectiveId = paneThemeId || globalThemeId;
  const isOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;
  const theme = themes[effectiveId] || themes.catppuccin;
  const ui = buildThemeUI(theme);

  return (
    <div style={{ padding: space['3'], display: 'flex', flexDirection: 'column', gap: space['4'] }}>
      <Field
        label={t?.('theme') || 'Theme'}
        hint={
          isOverridden
            ? (t?.('themePerPaneOverride') || 'This terminal only — global theme is unchanged.')
            : (t?.('themePerPaneHint') || 'Applies to this terminal only. Global theme lives in Settings.')
        }
        action={
          isOverridden && onPaneThemeChange ? (
            <button
              type="button"
              onClick={() => onPaneThemeChange(globalThemeId)}
              style={{
                background: 'transparent',
                border: `1px solid ${ui.border}`,
                color: ui.subtext,
                fontSize: fontSize['11'],
                fontFamily: font.sans,
                padding: '2px 8px',
                borderRadius: radius.xs,
                cursor: 'pointer',
              }}
              title={t?.('resetToGlobalTheme') || 'Reset to global theme'}
            >
              {t?.('reset') || 'Reset'}
            </button>
          ) : null
        }
      >
        <ThemePicker
          value={effectiveId}
          onChange={onPaneThemeChange}
          t={t}
          markedId={globalThemeId}
          showRandom
        />
      </Field>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Info 패널 — 세션 메타데이터 + 시스템 자원(CPU/RAM/Disk/Load).
// 자원 정보는 패널이 *열려 있는 동안만* 2초 polling. 닫으면 즉시 멈춤.

// Info 탭은 트레이스가 아니라 스냅샷에 가깝다. 매 몇 초 갱신은 실시간 모니터링도 아닌데 부하만 키움.
// → 탭 열려 있는 동안만 30s 마다 폴링하고, 닫으면 즉시 멈춤. 사용자가 즉시 보고 싶으면 새로고침 버튼.
const SYSTEM_STATS_POLL_MS = 30000;

const useSystemStats = (enabled) => {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const fetchRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let aborted = false;
    const fetchOnce = async () => {
      setRefreshing(true);
      try {
        const token = (typeof localStorage !== 'undefined' && localStorage.getItem('auth_token')) || '';
        const res = await fetch('/api/system/stats', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setStats(data);
      } catch { /* 다음 tick 또는 사용자 새로고침에 다시 시도 */ }
      finally {
        if (!aborted) setRefreshing(false);
      }
    };
    fetchRef.current = fetchOnce;
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, SYSTEM_STATS_POLL_MS);
    return () => {
      aborted = true;
      fetchRef.current = null;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [enabled]);
  const refresh = useCallback(() => { fetchRef.current?.(); }, []);
  return { stats, refresh, refreshing };
};

const formatBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatRate = (n) => `${formatBytes(n)}/s`;

const formatUptime = (s, t) => {
  if (s == null) return '—';
  const sec = Math.floor(s);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const label = (key, fallback) => {
    const value = t?.(key);
    return value && value !== key ? value : fallback;
  };
  const day = label('uptimeDayUnit', 'd');
  const hour = label('uptimeHourUnit', 'h');
  const minute = label('uptimeMinuteUnit', 'm');
  if (d > 0) return `${d}${day} ${h}${hour}`;
  if (h > 0) return `${h}${hour} ${m}${minute}`;
  return `${m}${minute}`;
};

const InfoPanel = memo(({ info, paneThemeId, globalThemeId, t }) => {
  const { stats, refresh: refreshStats, refreshing: statsRefreshing } = useSystemStats(true);
  const themeOverridden = !!paneThemeId && !!globalThemeId && paneThemeId !== globalThemeId;
  const activeThemeId = paneThemeId || globalThemeId;
  const infoTheme = themes[activeThemeId] || themes.catppuccin;
  const infoUi = buildThemeUI(infoTheme);
  const [copiedKey, setCopiedKey] = useState(null);
  const handleCopy = (key, value) => {
    if (!value) return;
    try {
      navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1100);
    } catch { /* ignore */ }
  };

  const host = info?.host || null;
  const isHost = info?.tabType === 'host';

  const hostAddr = host
    ? [host.ssh_user || host.username, host.hostname || host.host].filter(Boolean).join('@')
      + (host.port && host.port !== 22 ? `:${host.port}` : '')
    : null;

  const cwdDisplay = info?.cwd
    ? info.cwd
    : (info?.paneCwdRel != null ? `~/${info.paneCwdRel}` : '—');

  /* 라이브 연결 상태 — Terminal.jsx 가 노출한 getDims/getConnectionState 폴링.
     1초 간격이면 충분 (사이즈는 자주 안 바뀜). */
  const [live, setLive] = useState({ cols: 0, rows: 0, conn: 'unknown' });
  useEffect(() => {
    const sid = info?.sessionId;
    if (!sid) return undefined;
    const tick = () => {
      const sess = (typeof window !== 'undefined') ? window.terminalSessions?.[sid] : null;
      if (!sess) {
        setLive({ cols: 0, rows: 0, conn: 'closed' });
        return;
      }
      const dims = sess.getDims?.() || { cols: 0, rows: 0 };
      const conn = sess.getConnectionState?.() || 'unknown';
      setLive({ cols: dims.cols || 0, rows: dims.rows || 0, conn });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info?.sessionId]);

  const connToneMap = {
    open:       { dot: '#a6e3a1', label: t?.('connOpen')       || 'Connected' },
    connecting: { dot: '#f9e2af', label: t?.('connConnecting') || 'Connecting…' },
    closing:    { dot: '#f9e2af', label: t?.('connClosing')    || 'Closing…' },
    closed:     { dot: '#f38ba8', label: t?.('connClosed')     || 'Disconnected' },
    unknown:    { dot: '#6c7086', label: '—' },
  };
  const connTone = connToneMap[live.conn] || connToneMap.unknown;

  const authLabelMap = {
    key:       t?.('authKey')       || 'SSH key',
    password:  t?.('authPassword')  || 'Password',
    tailscale: t?.('authTailscale') || 'Tailscale',
  };

  return (
    <div style={infoStyles.root}>
      {/* 인접 섹션 사이 풀폭 구분선 — first/last 자동 제외 (`+` 형제 셀렉터). */}
      <style>{`
        .iterm-info-section + .iterm-info-section { border-top: 1px solid var(--ui-border, ${infoUi?.border || color.border}); }
        @keyframes iterm-info-connected-breath {
          0%, 100% { opacity: 0.62; transform: scale(0.88); box-shadow: 0 0 0 2px ${connToneMap.open.dot}20, 0 0 4px ${connToneMap.open.dot}24; }
          50% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 3px ${connToneMap.open.dot}30, 0 0 9px ${connToneMap.open.dot}55; }
        }
        @keyframes iterm-spin { to { transform: rotate(360deg); } }
      `}</style>
      {/* 세션 */}
      <InfoSection title={t?.('infoSession') || 'Session'} icon={TerminalIcon}>
        <InfoRow label={t?.('infoTabName') || 'Tab'} value={info?.paneName || info?.tabName || '—'} mono={false} />
        <InfoRow
          label={t?.('infoMode') || 'Mode'}
          value={isHost ? (t?.('infoModeRemote') || 'SSH (remote)') : (t?.('infoModeLocal') || 'Local')}
          mono={false}
          accent={isHost}
        />
        {info?.paneCount > 1 && (
          <InfoRow
            label={t?.('infoPane') || 'Pane'}
            value={`${(info.paneIndex ?? 0) + 1} / ${info.paneCount}`}
            mono={false}
          />
        )}
        <InfoRow
          label={t?.('infoSessionId') || 'Session ID'}
          value={info?.sessionId || '—'}
          copyable={!!info?.sessionId}
          onCopy={() => handleCopy('sessionId', info?.sessionId)}
          copied={copiedKey === 'sessionId'}
        />
        {info?.effectiveTmuxSession && (
          <InfoRow
            label={t?.('infoTmuxSession') || 'tmux session'}
            value={info.effectiveTmuxSession}
            copyable
            onCopy={() => handleCopy('tmux', info.effectiveTmuxSession)}
            copied={copiedKey === 'tmux'}
            icon={Anchor}
          />
        )}
        <InfoRow
          label={t?.('infoPersistent') || 'Persistent'}
          value={info?.isPersistent
            ? (t?.('yes') || 'Yes')
            : (t?.('no') || 'No')}
          mono={false}
          accent={!!info?.isPersistent}
        />
      </InfoSection>

      {/* 연결 — 라이브. xterm 의 cols×rows + WS readyState. */}
      <InfoSection title={t?.('infoConnection') || 'Connection'} icon={Wifi}>
        <InfoRow
          label={t?.('infoStatus') || 'Status'}
          value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: connTone.dot, flexShrink: 0,
                boxShadow: live.conn === 'open' ? `0 0 0 2px ${connTone.dot}33` : 'none',
                animation: live.conn === 'open' ? 'iterm-info-connected-breath 1.7s ease-in-out infinite' : 'none',
              }} />
              {connTone.label}
            </span>
          }
          mono={false}
        />
        <InfoRow
          label={t?.('infoSize') || 'Size'}
          value={live.cols && live.rows ? `${live.cols} × ${live.rows}` : '—'}
        />
        <div style={infoStyles.note}>
          {t?.('infoTakeoverHint') || 'Last attach wins — opening this session elsewhere will detach this view.'}
        </div>
      </InfoSection>

      {/* 호스트 (host 모드만) */}
      {isHost && host && (
        <InfoSection title={t?.('infoHost') || 'Host'} icon={Server}>
          <InfoRow label={t?.('infoHostName') || 'Name'} value={host.name || '—'} mono={false} />
          <InfoRow
            label={t?.('infoAddress') || 'Address'}
            value={hostAddr || '—'}
            copyable={!!hostAddr}
            onCopy={() => handleCopy('addr', hostAddr)}
            copied={copiedKey === 'addr'}
          />
          <InfoRow
            label={t?.('infoAuth') || 'Auth'}
            value={authLabelMap[host.auth_method] || host.auth_method || '—'}
            mono={false}
            icon={KeyRound}
          />
          <InfoRow
            label={t?.('infoUseRemoteTmux') || 'Remote tmux'}
            value={host.use_remote_tmux
              ? (t?.('on') || 'On')
              : (t?.('off') || 'Off')}
            mono={false}
            accent={!!host.use_remote_tmux}
          />
          {host.start_path && (
            <InfoRow
              label={t?.('infoStartPath') || 'Start path'}
              value={host.start_path}
              copyable
              onCopy={() => handleCopy('start_path', host.start_path)}
              copied={copiedKey === 'start_path'}
            />
          )}
        </InfoSection>
      )}

      {/* 위치 */}
      <InfoSection title={t?.('infoLocation') || 'Location'} icon={Folder}>
        <InfoRow
          label={t?.('infoCwd') || 'CWD'}
          value={cwdDisplay}
          copyable={cwdDisplay !== '—'}
          onCopy={() => handleCopy('cwd', cwdDisplay)}
          copied={copiedKey === 'cwd'}
        />
        {info?.cwdAbsolute && (
          <InfoRow
            label={t?.('infoAbsolutePath') || 'Absolute'}
            value={info.cwdAbsolute}
            copyable
            onCopy={() => handleCopy('cwdAbsolute', info.cwdAbsolute)}
            copied={copiedKey === 'cwdAbsolute'}
          />
        )}
      </InfoSection>

      {/* 테마 */}
      <InfoSection title={t?.('infoTheme') || 'Theme'} icon={Palette}>
        <InfoRow
          label={t?.('infoActiveTheme') || 'Active'}
          value={activeThemeId || '—'}
          mono={false}
          accent={themeOverridden}
        />
        {themeOverridden && (
          <div style={infoStyles.note}>
            {t?.('themePerPaneOverride') || 'Pane override active.'}
          </div>
        )}
      </InfoSection>

      {/* 시스템 자원 — 백엔드 호스트 (앱 서버) 기준 */}
      <InfoSection
        title={t?.('infoSystem') || 'System'}
        icon={Info}
        subtitle={stats?.hostname ? `${stats.hostname}` : null}
        action={(
          <button
            type="button"
            onClick={() => refreshStats?.()}
            disabled={statsRefreshing}
            title={t?.('refresh') || 'Refresh'}
            style={{
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: 'var(--ui-subtext)',
              padding: 0,
              cursor: statsRefreshing ? 'wait' : 'pointer',
              opacity: statsRefreshing ? 0.4 : 0.8,
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
            onMouseEnter={(e) => { if (!statsRefreshing) { e.currentTarget.style.background = 'var(--ui-surface1)'; e.currentTarget.style.color = 'var(--ui-text)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
          >
            <RefreshCw size={11} strokeWidth={2} style={{ animation: statsRefreshing ? 'iterm-spin 0.7s linear infinite' : 'none' }} />
          </button>
        )}
      >
        {!stats ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <SkeletonRow width="32px" height="10px" />
                  <SkeletonRow width="60px" height="10px" />
                </div>
                <SkeletonRow width="100%" height="6px" borderRadius="3px" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <StatBar
              label="CPU"
              percent={stats.cpu ?? 0}
              right={stats.cpu_count ? `${(stats.cpu ?? 0).toFixed(1)}% · ${stats.cpu_count} cores` : `${(stats.cpu ?? 0).toFixed(1)}%`}
            />
            <MemoryStackBar stats={stats} />
            <StatBar
              label="Disk"
              percent={stats.disk ?? 0}
              right={stats.disk_total
                ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)} · free ${formatBytes(stats.disk_free)}`
                : `${(stats.disk ?? 0).toFixed(1)}%`}
            />
            {(stats.net_rx_rate != null || stats.net_tx_rate != null) && (
              <InfoRow
                label="Network"
                value={`↓ ${formatRate(stats.net_rx_rate || 0)} · ↑ ${formatRate(stats.net_tx_rate || 0)}`}
              />
            )}
            {Array.isArray(stats.load_avg) && stats.load_avg.length === 3 && (
              <InfoRow
                label="Load"
                value={stats.load_avg.map((x) => x.toFixed(2)).join(' · ')}
              />
            )}
            {stats.uptime != null && (
              <InfoRow
                label={t?.('infoUptime') || 'Uptime'}
                value={formatUptime(stats.uptime, t)}
                mono={false}
              />
            )}
            {Array.isArray(stats.top_processes) && stats.top_processes.length > 0 && (
              <ProcessList processes={stats.top_processes} onRefresh={refreshStats} />
            )}
          </>
        )}
      </InfoSection>
    </div>
  );
});

const InfoSection = ({ title, icon: Icon, subtitle = null, action = null, children }) => (
  <div className="iterm-info-section" style={infoStyles.section}>
    <div style={infoStyles.sectionHeader}>
      {Icon && <Icon size={11} strokeWidth={2} style={{ color: 'var(--ui-subtext)', flexShrink: 0 }} />}
      <span style={{ ...infoStyles.sectionTitle, color: 'var(--ui-subtext)' }}>{title}</span>
      {subtitle && <span style={{ ...infoStyles.sectionSubtitle, color: 'var(--ui-subtext)' }}>{subtitle}</span>}
      {action && <span style={{ marginLeft: subtitle ? '4px' : 'auto', display: 'inline-flex', alignItems: 'center' }}>{action}</span>}
    </div>
    <div style={infoStyles.sectionBody}>
      {children}
    </div>
  </div>
);

const InfoRow = ({ label, value, mono = true, accent = false, copyable = false, onCopy, copied = false, icon: Icon = null }) => (
  <div style={infoStyles.row}>
    <span style={{ ...infoStyles.rowLabel, color: 'var(--ui-subtext)' }}>{label}</span>
    <span style={{
      ...infoStyles.rowValue,
      ...(mono ? infoStyles.rowValueMono : null),
      color: accent ? 'var(--ui-accent)' : 'var(--ui-text)',
    }}>
      {Icon && <Icon size={10} strokeWidth={2} style={{ marginRight: '4px', opacity: 0.7 }} />}
      <span style={infoStyles.rowValueText} title={typeof value === 'string' ? value : undefined}>{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          style={infoStyles.copyBtn}
          title="Copy"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ui-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ui-subtext)'; }}
        >
          {copied ? <Check size={10} strokeWidth={2.4} /> : <Copy size={10} strokeWidth={2} />}
        </button>
      )}
    </span>
  </div>
);

const MemoryStackBar = ({ stats }) => {
  const memTotal = Number(stats.mem_total) || 0;
  const swapTotal = Number(stats.swap_total) || 0;
  const total = memTotal + swapTotal;
  const used = Math.max(0, Number(stats.mem_used) || 0);
  const cache = Math.max(0, (Number(stats.mem_cache) || 0) + (Number(stats.mem_buffers) || 0));
  const swapUsed = Math.max(0, Number(stats.swap_used) || 0);
  const free = Math.max(0, total - used - cache - swapUsed);
  const pct = (value) => total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const segments = [
    { key: 'used', label: 'Used', value: used, color: 'var(--ui-accent, #89b4fa)' },
    { key: 'cache', label: 'Cache', value: cache, color: 'var(--ui-warning, #f9e2af)' },
    { key: 'swap', label: 'Swap', value: swapUsed, color: 'var(--ui-danger, #f38ba8)' },
    { key: 'free', label: 'Free', value: free, color: 'var(--ui-surface2, #585b70)' },
  ].filter((item) => item.value > 0 || item.key === 'free');

  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>Memory</span>
        <span style={infoStyles.statRight}>
          {memTotal ? `${formatBytes(used)} used · ${formatBytes(cache)} cache${swapTotal ? ` · ${formatBytes(swapUsed)} swap` : ''}` : `${(stats.ram ?? 0).toFixed(1)}%`}
        </span>
      </div>
      <div style={infoStyles.stackTrack}>
        {segments.map((item) => (
          <span
            key={item.key}
            title={`${item.label}: ${formatBytes(item.value)}`}
            style={{
              ...infoStyles.stackSegment,
              width: `${pct(item.value)}%`,
              background: item.color,
              opacity: item.key === 'free' ? 0.45 : 0.95,
            }}
          />
        ))}
      </div>
      <div style={infoStyles.stackLegend}>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-accent, #89b4fa)' }} />Used</span>
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-warning, #f9e2af)' }} />Cache</span>
        {swapTotal > 0 && <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-danger, #f38ba8)' }} />Swap</span>}
        <span style={infoStyles.legendItem}><b style={{ ...infoStyles.legendDot, background: 'var(--ui-surface2, #585b70)' }} />Free</span>
      </div>
    </div>
  );
};

const ProcessList = ({ processes, onRefresh }) => {
  const [pending, setPending] = useState(null); // pid currently sending kill
  const [error, setError] = useState(null);

  const sendKill = useCallback(async (pid, sig) => {
    const label = sig === 'kill' ? 'force kill (SIGKILL)' : 'terminate (SIGTERM)';
    if (!window.confirm(`PID ${pid} — ${label}?`)) return;
    setPending(pid);
    setError(null);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/system/processes/${pid}/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ signal: sig }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      // 백엔드가 다음 stats 폴링 때 자연스럽게 빠짐. 즉시 한 번 더 당김.
      onRefresh?.();
    } catch (e) {
      setError(`pid ${pid}: ${e.message}`);
    } finally {
      setPending(null);
    }
  }, [onRefresh]);

  return (
    <div style={infoStyles.processBox}>
      <div style={infoStyles.processHeader}>
        <span>Top processes</span>
        <span style={{ textAlign: 'right' }}>CPU · RSS</span>
      </div>
      {error && (
        <div style={infoStyles.processError}>{error}</div>
      )}
      {processes.slice(0, 8).map((proc) => {
        const canKill = proc.is_mine !== false; // 명시적으로 false 가 아니면 시도 허용
        const isPending = pending === proc.pid;
        return (
          <div key={proc.pid} style={infoStyles.processRow}>
            <div style={infoStyles.processMain}>
              <div style={infoStyles.processNameRow}>
                <span style={{ ...infoStyles.processName, color: proc.llm_like ? 'var(--ui-accent)' : 'var(--ui-text)' }}>
                  {proc.name || `pid ${proc.pid}`}
                </span>
                <span style={infoStyles.processMeta}>
                  pid {proc.pid}
                  {proc.user ? ` · ${proc.user}` : ''}
                </span>
              </div>
              <span style={infoStyles.processCmd} title={proc.cmd}>{proc.cmd || `pid ${proc.pid}`}</span>
            </div>
            {proc.llm_like && <span style={infoStyles.processBadge}>LLM</span>}
            <div style={infoStyles.processStats}>
              <span style={infoStyles.processCpu}>{(proc.cpu_percent ?? 0).toFixed(1)}%</span>
              <span style={infoStyles.processMem}>{formatBytes(proc.rss_bytes)}</span>
            </div>
            <div style={infoStyles.processActions}>
              <button
                type="button"
                onClick={() => sendKill(proc.pid, 'term')}
                disabled={!canKill || isPending}
                title={canKill ? 'Terminate (SIGTERM)' : 'Not your process'}
                style={{
                  ...infoStyles.processKillBtn,
                  opacity: !canKill || isPending ? 0.35 : 0.85,
                  cursor: !canKill || isPending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => { if (canKill && !isPending) { e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-warning, #f9e2af) 24%, transparent)'; e.currentTarget.style.color = 'var(--ui-warning, #f9e2af)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
              >
                <XCircle size={12} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => sendKill(proc.pid, 'kill')}
                disabled={!canKill || isPending}
                title={canKill ? 'Force kill (SIGKILL)' : 'Not your process'}
                style={{
                  ...infoStyles.processKillBtn,
                  opacity: !canKill || isPending ? 0.35 : 0.85,
                  cursor: !canKill || isPending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => { if (canKill && !isPending) { e.currentTarget.style.background = 'color-mix(in srgb, var(--ui-danger, #f38ba8) 24%, transparent)'; e.currentTarget.style.color = 'var(--ui-danger, #f38ba8)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ui-subtext)'; }}
              >
                <Zap size={12} strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StatBar = ({ label, percent = 0, right = '' }) => {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone =
    safe >= 90 ? 'var(--ui-danger, #f38ba8)'
    : safe >= 75 ? 'var(--ui-warning, #f9e2af)'
    : 'var(--ui-accent, #89b4fa)';
  return (
    <div style={infoStyles.statRow}>
      <div style={infoStyles.statHeader}>
        <span style={infoStyles.statLabel}>{label}</span>
        <span style={infoStyles.statRight}>{right}</span>
      </div>
      <div style={infoStyles.barTrack}>
        <div style={{
          ...infoStyles.barFill,
          width: `${safe}%`,
          background: tone,
          boxShadow: `0 0 12px ${tone}55`,
          transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
    </div>
  );
};

const infoStyles = {
  root: {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    fontFamily: font.sans,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  sectionTitle: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sectionSubtitle: {
    marginLeft: 'auto',
    fontSize: '10.5px',
    fontFamily: font.mono,
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '120px',
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    minHeight: '20px',
    fontSize: fontSize['12'],
  },
  rowLabel: {
    flexShrink: 0,
    minWidth: '64px',
    fontSize: '11px',
    letterSpacing: '0.02em',
    color: 'var(--ui-subtext)',
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--ui-text)',
  },
  rowValueText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueMono: {
    fontFamily: font.mono,
    fontSize: '11.5px',
    letterSpacing: 0,
  },
  copyBtn: {
    flexShrink: 0,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--ui-subtext)',
    padding: 0,
    borderRadius: '3px',
    transition: 'color 120ms',
  },
  note: {
    fontSize: '10.5px',
    color: 'var(--ui-accent)',
    opacity: 0.85,
    lineHeight: 1.4,
    paddingTop: '2px',
  },
  statRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingTop: '2px',
    paddingBottom: '2px',
  },
  statHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['2'],
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: fontWeight.semibold,
    color: 'var(--ui-subtext)',
    letterSpacing: '0.04em',
  },
  statRight: {
    fontFamily: font.mono,
    fontSize: '10.5px',
    color: 'var(--ui-subtext)',
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  barTrack: {
    width: '100%',
    height: '6px',
    background: 'var(--ui-crust)',
    borderRadius: '3px',
    overflow: 'hidden',
    border: '1px solid var(--ui-border)',
  },
  barFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms',
  },
  stackTrack: {
    width: '100%',
    height: '8px',
    display: 'flex',
    gap: '1px',
    background: 'var(--ui-crust)',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid var(--ui-border)',
  },
  stackSegment: {
    height: '100%',
    minWidth: '1px',
    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  stackLegend: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
    fontFamily: font.mono,
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
  },
  legendDot: {
    width: '6px',
    height: '6px',
    borderRadius: '2px',
    display: 'inline-block',
    flexShrink: 0,
  },
  processBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    paddingTop: '3px',
  },
  processHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: '8px',
    padding: '0 6px 2px',
    fontSize: '10px',
    color: 'var(--ui-subtext)',
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  processError: {
    fontSize: '10px',
    color: 'var(--ui-danger, #f38ba8)',
    padding: '3px 6px',
    background: 'color-mix(in srgb, var(--ui-danger, #f38ba8) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-danger, #f38ba8) 35%, transparent)',
    borderRadius: '4px',
    marginBottom: '2px',
  },
  processRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
    alignItems: 'center',
    gap: '6px',
    minHeight: '28px',
    padding: '4px 5px',
    borderRadius: '5px',
    background: 'color-mix(in srgb, var(--ui-surface0) 72%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-border) 46%, transparent)',
  },
  processMain: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  processNameRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    minWidth: 0,
  },
  processName: {
    fontSize: '11px',
    fontWeight: fontWeight.semibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  processMeta: {
    fontFamily: font.mono,
    fontSize: '9px',
    color: 'var(--ui-subtext)',
    flexShrink: 0,
    opacity: 0.7,
  },
  processCmd: {
    fontFamily: font.mono,
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  processBadge: {
    height: '15px',
    padding: '0 5px',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: fontWeight.bold,
    color: 'var(--ui-accent)',
    background: 'color-mix(in srgb, var(--ui-accent) 14%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ui-accent) 32%, transparent)',
  },
  processStats: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0',
    minWidth: '56px',
    fontFamily: font.mono,
  },
  processCpu: {
    fontSize: '10px',
    color: 'var(--ui-text)',
    fontWeight: fontWeight.semibold,
  },
  processMem: {
    fontSize: '9.5px',
    color: 'var(--ui-subtext)',
  },
  processActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
  },
  processKillBtn: {
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--ui-subtext)',
    padding: 0,
    transition: 'background 0.12s ease, color 0.12s ease',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const Field = ({ label, hint = null, action = null, children }) => (
  <div>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space['2'],
      marginBottom: hint ? '4px' : space['2'],
    }}>
      <div style={{
        fontSize: fontSize['11'],
        fontWeight: fontWeight.semibold,
        color: 'var(--ui-subtext)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
      }}>
        {label}
      </div>
      {action}
    </div>
    {hint && (
      <div style={{
        fontSize: '11px',
        color: 'var(--ui-subtext)',
        marginBottom: space['2'],
        lineHeight: 1.4,
      }}>
        {hint}
      </div>
    )}
    {children}
  </div>
);

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    flexShrink: 0,
    position: 'relative',
    pointerEvents: 'none',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--ui-border)',
    borderBottom: '1px solid var(--ui-border)',
    background: 'var(--ui-base)',
    overflow: 'hidden',
    fontFamily: font.sans,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['2']} ${space['3']}`,
    borderBottom: '1px solid var(--ui-border)',
    flexShrink: 0,
  },
  panelTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    minWidth: 0,
    fontSize: fontSize['12'],
    fontFamily: font.brand,
    fontWeight: 400,
    color: 'var(--ui-subtext)',
    textTransform: 'uppercase',
    letterSpacing: 0,
    lineHeight: 1,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--ui-subtext)',
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
  },
  panelBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  activityBar: {
    height: `${TOP_RAIL_HEIGHT}px`,
    width: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '2px',
    paddingLeft: '4px',
    paddingRight: '4px',
    background: 'var(--ui-surface0)',
    borderBottom: '1px solid var(--ui-border)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'auto',
  },
  divider: {
    alignSelf: 'stretch',
    width: '1px',
    height: '18px',
    background: 'var(--ui-border)',
    margin: '0 2px',
  },
};

const homeTilde = (path) => {
  if (!path) return path;
  return path.replace(/^\/(?:home|Users)\/[^/]+/, '~');
};

const stripHostPathPrefix = (path) => {
  if (!path || typeof path !== 'string') return path || '';
  const trimmed = path.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return trimmed;
  const match = trimmed.match(/^(?:[^@:\s]+@)?[^:\s]+:(\/?~?\/?[^\s].*)$/);
  return match ? match[1] : trimmed;
};

const CwdBreadcrumb = memo(({ paneInfo, loading, disabled, ui, onRefreshCwd = null, t = null }) => {
  const [refreshing, setRefreshing] = useState(false);
  const isHostPane = paneInfo?.tabType === 'host';
  const iconValue = isHostPane
    ? (paneInfo?.host?.icon || null)
    : (paneInfo?.tabIcon || null);
  const colorIndex = isHostPane
    ? (paneInfo?.host?.color_index ?? null)
    : (paneInfo?.tabColorIndex ?? null);
  const dotColor = colorIndex != null
    ? (tokens.color.dotPalette[colorIndex % tokens.color.dotPalette.length] || ui.accent)
    : ui.accent;

  // absPath: 로컬 tmux 폴링 (remote 는 null)
  // staticCwd: pane.cwd — 절대경로일 때만 사용
  // lastKnownCwd: host.last_cwd — DB에 저장된 마지막 CWD (접속 시 갱신)
  // startPath: host.start_path — 설정된 시작 경로
  const absPath = paneInfo?.cwdAbsolute || null;
  const staticCwd = paneInfo?.cwd || null;
  const lastKnownCwd = isHostPane ? (paneInfo?.host?.last_cwd || null) : null;
  const startPath = isHostPane ? (paneInfo?.host?.start_path || null) : null;
  const rawPath = absPath
    || (staticCwd && staticCwd.startsWith('/') ? staticCwd : null)
    || lastKnownCwd
    || startPath;
  const displayPath = homeTilde(isHostPane ? stripHostPathPrefix(rawPath) : rawPath);

  // 진짜 cwd 가 없어도 비워두지 않는다 — 호스트면 user@host, 로컬이면 `~` 로 폴백.
  // 실제 cwd 가 fetch 되는 순간 자동으로 업데이트됨.
  const placeholderPath = isHostPane
    ? (paneInfo?.host?.ssh_user && paneInfo?.host?.hostname
        ? `${paneInfo.host.ssh_user}@${paneInfo.host.hostname}`
        : (paneInfo?.host?.hostname || '~'))
    : '~';
  const headerPath = !loading && !disabled
    ? (displayPath || placeholderPath)
    : null;
  const isPlaceholder = !loading && !disabled && !displayPath;

  const handleRefresh = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRefreshCwd || refreshing) return;
    try {
      setRefreshing(true);
      await onRefreshCwd();
    } finally {
      setRefreshing(false);
    }
  };

  const pillStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: `color-mix(in srgb, ${ui.surface1 || ui.surface0} 45%, transparent)`,
    border: `1px solid color-mix(in srgb, ${ui.border || ui.surface1} 50%, transparent)`,
    borderRadius: '5px',
    padding: '2px 4px 2px 5px',
    pointerEvents: 'auto',
  };

  // 로딩 중 — 스켈레톤 pill
  if (loading) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 5px' }}>
        <div style={{ ...pillStyle, pointerEvents: 'none' }}>
          <div style={{
            width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
            background: `color-mix(in srgb, ${dotColor} 40%, transparent)`,
          }} />
          <div style={{
            flex: 1, height: '7px', borderRadius: '3px',
            background: `linear-gradient(90deg,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 50%, transparent) 0%,
              color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 50%, transparent) 100%)`,
            backgroundSize: '300% 100%',
            animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite, skel-pulse 1.4s ease-in-out infinite',
          }} />
        </div>
      </div>
    );
  }

  if (disabled || !headerPath) {
    return <div style={{ flex: 1, minWidth: '4px' }} />;
  }

  // placeholder 텍스트는 진짜 cwd 와 시각적으로 구분 — 살짝 흐리게 + italic.

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 5px' }}>
      <div style={pillStyle}>
        <HostIcon
          value={iconValue}
          fallback={isHostPane ? Server : Monitor}
          size={9}
          strokeWidth={1.8}
          style={{ flexShrink: 0, color: dotColor, opacity: 0.85 }}
        />
        {/* 좌측 정렬, 우측 말줄임 — 드래그 선택으로 복사 가능 */}
        <span
          title={rawPath || headerPath}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '10px',
            fontFamily: font.mono,
            letterSpacing: '-0.01em',
            userSelect: 'text',
            cursor: 'text',
            color: ui.subtext0 || ui.muted,
            opacity: isPlaceholder ? 0.5 : 0.82,
            fontStyle: isPlaceholder ? 'italic' : 'normal',
          }}
        >
          {headerPath}
        </span>
        {onRefreshCwd && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title={t?.('refreshCurrentPath') || t?.('refresh') || 'Refresh current path'}
            style={{
              width: '17px',
              height: '17px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              border: 'none',
              borderRadius: '4px',
              background: 'transparent',
              color: ui.muted,
              opacity: refreshing ? 0.45 : 0.75,
              cursor: refreshing ? 'wait' : 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ui.surface1 || 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = ui.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ui.muted; }}
          >
            <RefreshCw size={10} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
});

export default TerminalHeader;
