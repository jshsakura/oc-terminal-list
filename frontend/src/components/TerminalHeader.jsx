import { useState, memo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, GitBranch, Palette, X, RefreshCw, FileText, Trash2,
  Info, Server, Monitor, Terminal as TerminalIcon, Anchor, Copy, Check, Wifi, KeyRound,
  ExternalLink, MoreHorizontal,
  GripVertical, Columns2, Rows2,
  Eye, EyeOff,
  XCircle, Zap, RotateCw,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import RailSkeleton from './common/RailSkeleton';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { glassPanelStyle, glassSectionStyle } from '../styles/glass';
import FileTree from './FileTree';
import ChangesList from './ChangesList';
import ThemePicker from './common/ThemePicker';
import useGitChanges from '../hooks/useGitChanges';
import RailIconBtn from './common/RailIconBtn';
import HostIcon from '../utils/hostIcons';
import InfoPanel from './terminalheader/InfoPanel';
import { RailSubMenu, MenuBtn, CommandHistoryPopover } from './terminalheader/RailMenus';
import ThemeSettings, { Field } from './terminalheader/ThemeSettings';
import CwdBreadcrumb from './terminalheader/CwdBreadcrumb';
import styles from './terminalheader/terminalHeaderStyles';
import {
  DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, TOP_RAIL_HEIGHT,
  PANEL_STATE_PREFIX, TABS, readPanelState,
} from './terminalheader/panelState';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const TerminalHeader = ({
  isFocused = false, // pane 포커스 여부 — 사이드바 하단 눈 아이콘 (Eye/EyeOff) 으로 표시.
  /* Is this pane on screen (i.e. its tab is active)? Gates git polling: every
     tab's PaneGrid stays mounted, so without this the invisible tabs each keep
     hammering /api/git/status — 80% of all HTTP on this deployment. */
  isPaneVisible = true,
  showFocusEye = false, // legacy hint; focus eye now keeps a stable slot for every live terminal.
  activeTabType,    // 'local' | 'host' | null
  activeHostId = null,
  gitContextPath = '',
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  onRefreshTerminal = null,
  /* 세션 재시작 — onRefreshTerminal 과 다르다. 저쪽은 살아있는 tmux 에 다시 붙을 뿐이라
     셸 환경이 그대로고, 이쪽은 tmux 를 죽이고 같은 경로에서 새 셸을 띄운다. */
  onRestartSession = null,
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
  activeFilePath = null, // 열려 있는 에디터 파일 — FileTree 업로드 목적지 폴백
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
  /* 세션 간 명령 픽커 대상 — Pane 이 collectOtherPaneSessions 로 계산한 다른 세션 목록. */
  sessionTargets = [],
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
  /* 리모트: 패널 열릴 때만 30s 폴링, 닫히면 폴링 중단 (SSH 연결 비용)
     로컬: 패널 열림 4s / 닫힘 60s.
     닫힌 패널이 먹이는 건 레일 아이콘의 배지 숫자 하나뿐이라 시계는 바닥값이면 된다 —
     신선도는 activityPaneId(그 pane 의 출력이 멎으면 갱신)가 책임진다. 예전의 15s 는
     보이는 repo 마다 분당 4회였고, 그게 이 배포에서 전체 HTTP 의 대부분이었다. */
  const gitEnabled = isPaneVisible && (isRemote
    ? gitPanelOpen
    : (gitContextPath != null || !!activeHostId));
  const gitIntervalMs = isRemote ? 30000 : (gitPanelOpen ? 4000 : 60000);
  const gitChanges = useGitChanges({
    enabled: gitEnabled,
    path: activeHostId ? (paneCwd || '') : (gitContextPath || ''),
    hostId: activeHostId || null,
    intervalMs: gitIntervalMs,
    activityPaneId: paneInfo?.paneId || null,
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
        // 레일은 터미널 **위로 뜬 크롬**이다 — base(터미널 배경)를 그대로 쓰면 한 톤으로
        // 뭉쳐 어디까지가 도구줄이고 어디부터 출력인지 안 보인다(DESIGN §14 의 사다리를
        // pane 안에도 적용). pane 자기 테마의 mantle 이라 테마를 바꾸면 같이 따라간다.
        background: panelUi.mantle,
        borderBottomColor: panelUi.border,
      }}>
        {/* 로딩 중엔 핸들 자리만 비워둔다 — 로딩이 끝나며 레일 전체가 옆으로 밀리지 않게. */}
        {!isMobile && loading && (
          <div style={{ width: '22px', height: '22px', marginRight: '1px', flexShrink: 0 }} aria-hidden="true" />
        )}

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
            <RailSkeleton count={TABS.length} compact ui={panelUi} gap="2px" />
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
            {/* Broadcast 토글은 TabBar(설정 버튼 옆)로 이동. 켜짐 상태는 pane 영역 우측 상단 배너로 표시. */}

            {/* Single split button — opens dropdown with left/right/up/down choices */}
            {loading && onSplitPane && (
              <RailSkeleton count={1} compact ui={panelUi} delayOffset={480} />
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
                <RailSkeleton count={1} compact ui={panelUi} delayOffset={640} />
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
            <MenuBtn
              icon={RefreshCw}
              onClick={() => { closeRailMenu(); onRefreshTerminal(); }}
              hint={t?.('refreshTerminalHint') || 'Redraws the screen. Nothing running is affected.'}
              ui={panelUi}
            >
              {t?.('refreshTerminal') || 'Reload terminal'}
            </MenuBtn>
          )}
          {/* 새로고침은 살아있는 tmux 에 다시 붙을 뿐이라 셸 환경이 그대로다.
              재시작은 셸을 새로 띄운다 — 방금 설치한 명령이 PATH 에 안 잡힐 때 쓴다. */}
          {onRestartSession && !disabled && (
            <MenuBtn
              icon={RotateCw}
              onClick={() => { closeRailMenu(); onRestartSession(); }}
              hint={t?.('restartSessionHint') || 'Opens a fresh shell. Everything running here ends.'}
              ui={panelUi}
            >
              {t?.('restartSession') || 'Restart session'}
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
          sessions={sessionTargets}
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
          {/* 흔히 쓰는 오른쪽/아래로 분할만. 왼쪽/위로 분할은 제외(탭 메뉴와 통일). */}
          <MenuBtn icon={Columns2} onClick={() => { closeSplitMenu(); onSplitPane('right'); }} ui={panelUi}>
            {t?.('splitRight') || 'Split right'}
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
                  activeFilePath={activeFilePath}
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

export default TerminalHeader;
