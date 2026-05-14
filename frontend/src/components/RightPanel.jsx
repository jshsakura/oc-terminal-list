import { useState, memo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, GitBranch, Palette, X, RefreshCw, ChevronsUp, ChevronsDown, FileText, Trash2,
  Info, Server, Terminal as TerminalIcon, Anchor, Copy, Check, Wifi, KeyRound, HelpCircle,
  ExternalLink, MoreHorizontal,
  GripVertical, Columns2, Rows2, LayoutGrid,
  Eye, EyeOff,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import FileTree from './FileTree';
import SkeletonRow from './common/SkeletonRow';
import ChangesList from './ChangesList';
import ThemePicker from './common/ThemePicker';
import useGitChanges from '../hooks/useGitChanges';
import RailIconBtn from './common/RailIconBtn';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

/** Mirrored icons for split-left / split-up — same shape, flipped for visual distinction. */
const ColumnsFlipX = (props) => <Columns2 {...props} style={{ transform: 'scaleX(-1)' }} />;
const RowsFlipY = (props) => <Rows2 {...props} style={{ transform: 'scaleY(-1)' }} />;

const DEFAULT_PANEL_WIDTH = 260;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 500;

const TABS = [
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'git',   icon: GitBranch, label: 'Git' },
  { id: 'info',  icon: Info,     label: 'Info' },
  { id: 'theme', icon: Palette,   label: 'Theme' },
];

const RightPanel = ({
  isFocused = false, // pane 포커스 여부 — 사이드바 하단 눈 아이콘 (Eye/EyeOff) 으로 표시.
  showFocusEye = false, // true 일 때만 눈 아이콘 노출. 분할(isMultiple) 있을 때만 보여줌.
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
  const [activePanel, setActivePanel] = useState(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const panelRef = useRef(null);
  const closedAtRef = useRef(0);
  const [railMenu, setRailMenu] = useState(null);
  const moreBtnRef = useRef(null);
  const railMenuClosedAtRef = useRef(0);
  const [splitMenu, setSplitMenu] = useState(null);
  const splitBtnRef = useRef(null);
  const splitMenuClosedAtRef = useRef(0);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    closedAtRef.current = Date.now();
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
    const now = Date.now();
    if (now - closedAtRef.current < 300) return;
    setActivePanel((prev) => (prev === id ? null : id));
  }, []);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
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
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [panelWidth]);

  // Git 변경 카운트 — 활동 바 뱃지에 표시. 경로 없으면 fetch 안 함 (전체 워크스페이스 집계 X).
  const gitChanges = useGitChanges({
    enabled: gitContextPath != null && activeTabType === 'local',
    path: gitContextPath,
    intervalMs: 4000,
  });
  const { items: gitItems, refresh: refreshGitChanges } = gitChanges;
  const gitCount = gitContextPath != null ? (gitItems || []).length : 0;

  useEffect(() => {
    if (activePanel === 'files') {
      onRefreshCwd?.();
    } else if (activePanel === 'git') {
      refreshGitChanges?.();
    }
  }, [activePanel, onRefreshCwd, refreshGitChanges]);

  return (
    <div style={{ ...styles.root, borderTopColor: panelUi.border }}>
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
        .iterm-rp-panelbody, .iterm-rp-panelbody * {
          scrollbar-width: thin !important;
          scrollbar-color: ${panelUi.surface1} transparent !important;
        }
        .iterm-rp-panelbody::-webkit-scrollbar,
        .iterm-rp-panelbody *::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
        .iterm-rp-panelbody::-webkit-scrollbar-thumb,
        .iterm-rp-panelbody *::-webkit-scrollbar-thumb {
          background: ${panelUi.surface1} !important;
          border-radius: 3px !important;
        }
        .iterm-rp-panelbody::-webkit-scrollbar-thumb:hover,
        .iterm-rp-panelbody *::-webkit-scrollbar-thumb:hover {
          background: ${panelUi.accent} !important;
        }
        .iterm-rp-panelbody::-webkit-scrollbar-track,
        .iterm-rp-panelbody *::-webkit-scrollbar-track {
          background: transparent !important;
        }
      `}</style>

      {/* activity bar — drag handle + tab strip + split/status/eye/close cluster */}
      <div style={{
        ...styles.activityBar,
        background: `color-mix(in srgb, ${panelUi.surface0} 65%, transparent)`,
        backdropFilter: 'blur(14px) saturate(160%)',
        WebkitBackdropFilter: 'blur(14px) saturate(160%)',
        borderBottomColor: panelUi.border,
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
            }}
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
          opacity: disabled ? 0.4 : 1,
          pointerEvents: (disabled || loading) ? 'none' : 'auto',
        }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 2px' }}>
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
                  animation: `iterm-skel-shimmer ${1.6 + i * 0.08}s ease-in-out infinite`,
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

        {/* Spacer + CWD breadcrumb */}
        <CwdBreadcrumb paneInfo={paneInfo} loading={loading} disabled={disabled} ui={panelUi} />

        {/* Right cluster: split buttons → busy dot → … menu */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          gap: '1px', flexShrink: 0,
        }}>
          {/* Focus eye — shown for multiple panes or when busy/evicted. Busy/evicted state shown as badge dot on upper-right. */}
          {!loading && (showFocusEye || isBusy || sessionStatus?.evicted) && (() => {
            const isEvicted = !!sessionStatus?.evicted;
            const hasBadge = isBusy || isEvicted;
            const dotBg = isEvicted ? (panelUi.warning || '#f9e2af') : panelUi.accent;
            const badgeTitle = isEvicted
              ? (t?.('sessionTakenOver') || 'Session taken over')
              : (t?.('terminalBusy') || 'Terminal is active');
            const eyeTitle = isFocused ? (t?.('paneFocused') || 'Focused') : (t?.('paneUnfocused') || 'Unfocused');
            return (
              <div style={{ position: 'relative', flexShrink: 0 }} title={hasBadge ? badgeTitle : eyeTitle}>
                <RailIconBtn
                  icon={isFocused ? Eye : EyeOff}
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
              animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite',
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


          {/* More menu button — rightmost item in the topbar */}
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
                animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite',
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
        </div>
      </div>

      {/* RailSubMenu — portal to document.body */}
      {railMenu && createPortal(
        <RailSubMenu
          anchor={railMenu}
          ui={panelUi}
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
              <MenuBtn icon={ChevronsUp} onClick={() => { closeRailMenu(); sendScroll(-1); }} ui={panelUi}>
                {t?.('pageUp') || 'Page up'}
              </MenuBtn>
              <MenuBtn icon={ChevronsDown} onClick={() => { closeRailMenu(); sendScroll(1); }} ui={panelUi}>
                {t?.('pageDown') || 'Page down'}
              </MenuBtn>
              <MenuBtn icon={FileText} onClick={() => { closeRailMenu(); handleDump(); }} ui={panelUi}>
                {t?.('viewAsText') || 'View as text'}
              </MenuBtn>
            </>
          )}
          {onEqualizePane && (
            <MenuBtn icon={LayoutGrid} onClick={() => { closeRailMenu(); onEqualizePane(); }} ui={panelUi}>
              {t?.('equalizePane') || 'Equalize panes'}
            </MenuBtn>
          )}
          {onRefreshTerminal && !disabled && (
            <MenuBtn icon={RefreshCw} onClick={() => { closeRailMenu(); onRefreshTerminal(); }} ui={panelUi}>
              {t?.('refreshTerminal') || 'Reload terminal'}
            </MenuBtn>
          )}
        </RailSubMenu>,
        document.body
      )}

      {/* Split pane dropdown — portal to document.body */}
      {splitMenu && createPortal(
        <RailSubMenu
          anchor={splitMenu}
          ui={panelUi}
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
            background: `color-mix(in srgb, ${panelUi.base} 85%, transparent)`,
            backdropFilter: 'blur(14px) saturate(160%)',
            WebkitBackdropFilter: 'blur(14px) saturate(160%)',
            borderColor: panelUi.border,
            color: panelUi.text,
            width: `${panelWidth}px`,
            position: 'absolute',
            top: '30px',
            left: 0,
            bottom: 0,
            zIndex: 10,
            boxShadow: '4px 0 16px rgba(0,0,0,0.35)',
            outline: 'none',
            pointerEvents: 'auto',
          }}>
          {/* 리사이즈 드래그 핸들 — 패널 우측 가장자리 */}
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            style={{
              position: 'absolute',
              top: 0, right: 0, bottom: 0,
              width: '5px',
              cursor: 'col-resize',
              zIndex: 2,
            }}
          />
          <div style={{ ...styles.panelHeader, background: `color-mix(in srgb, ${panelUi.mantle} 75%, transparent)`, borderBottomColor: panelUi.border }}>
            <span style={{ ...styles.panelTitle, color: panelUi.text }}>
              {TABS.find((t) => t.id === activePanel)?.label}
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
          <div className="iterm-rp-panelbody" style={{ ...styles.panelBody, background: 'transparent', color: panelUi.text }}>
            {activePanel === 'files' && (
              <FileTree
                key={`${activeHostId ?? 'local'}:${activeHostId ? (paneCwd ?? 'home') : (paneCwd ?? gitContextPath ?? selectedFolderPath ?? 'root')}`}
                hostId={activeHostId}
                onFileSelect={onFileSelect}
                onFolderSelect={onFolderSelect}
                onOpenTerminalAtFolder={onOpenTerminalAtFolder}
                onRefreshCwd={onRefreshCwd}
                gitContextPath={gitContextPath}
                sharedGitChanges={gitChanges}
                language={language}
                initialPath={activeHostId ? (paneCwd || null) : (paneCwd ?? gitContextPath ?? selectedFolderPath ?? '')}
              />
            )}
            {activePanel === 'git' && (
              <ChangesList
                gitContextPath={gitContextPath}
                sharedGitChanges={gitChanges}
                onSelectFile={onFileSelect}
                onOpenFile={onFileSelect}
                t={t}
              />
            )}
            {activePanel === 'theme' && (
              <ThemeSettings
                paneThemeId={paneThemeId || settings.theme}
                globalThemeId={settings.theme}
                onPaneThemeChange={onPaneThemeChange}
                t={t}
              />
            )}
            {activePanel === 'info' && (
              <InfoPanel
                info={paneInfo}
                paneThemeId={paneThemeId}
                globalThemeId={settings.theme}
                t={t}
              />
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

const RailSubMenu = ({ anchor, ui, onClose, t, children }) => {
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
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        background: ui.surface0 || '#1e1e2e',
        border: `1px solid ${ui.borderStrong || ui.border}`,
        borderRadius: '6px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        padding: '3px',
        zIndex: 200000,
        minWidth: '160px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
      }}
    >
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
        padding: '5px 8px',
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
      onMouseEnter={(e) => { if (!disabled && !display) e.currentTarget.style.background = ui?.surface1 || color.surface1; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {Icon && <Icon size={12} strokeWidth={1.8} />}
      {children}
    </button>
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
        />
      </Field>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Info 패널 — 세션 메타데이터 + 시스템 자원(CPU/RAM/Disk/Load).
// 자원 정보는 패널이 *열려 있는 동안만* 2초 polling. 닫으면 즉시 멈춤.

const useSystemStats = (enabled) => {
  const [stats, setStats] = useState(null);
  const intervalRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let aborted = false;
    const fetchOnce = async () => {
      try {
        const token = (typeof localStorage !== 'undefined' && localStorage.getItem('auth_token')) || '';
        const res = await fetch('/api/system/stats', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setStats(data);
      } catch {
        /* 일시적 실패 — 다음 tick 에서 다시 시도 */
      }
    };
    fetchOnce();
    intervalRef.current = setInterval(fetchOnce, 2000);
    return () => {
      aborted = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);
  return stats;
};

const formatBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatUptime = (s) => {
  if (s == null) return '—';
  const sec = Math.floor(s);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const InfoPanel = memo(({ info, paneThemeId, globalThemeId, t }) => {
  const stats = useSystemStats(true);
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
      <style>{`.iterm-info-section + .iterm-info-section { border-top: 1px solid var(--ui-border, ${infoUi?.border || color.border}); }`}</style>
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
            <StatBar
              label="RAM"
              percent={stats.ram ?? 0}
              right={stats.mem_total
                ? `${formatBytes(stats.mem_used)} / ${formatBytes(stats.mem_total)}`
                : `${(stats.ram ?? 0).toFixed(1)}%`}
            />
            <StatBar
              label="Disk"
              percent={stats.disk ?? 0}
              right={stats.disk_total
                ? `${formatBytes(stats.disk_used)} / ${formatBytes(stats.disk_total)}`
                : `${(stats.disk ?? 0).toFixed(1)}%`}
            />
            {Array.isArray(stats.load_avg) && stats.load_avg.length === 3 && (
              <InfoRow
                label="Load"
                value={stats.load_avg.map((x) => x.toFixed(2)).join(' · ')}
              />
            )}
            {stats.uptime != null && (
              <InfoRow
                label={t?.('infoUptime') || 'Uptime'}
                value={formatUptime(stats.uptime)}
                mono={false}
              />
            )}
          </>
        )}
      </InfoSection>

      {/* 키보드/마우스 컨벤션 — tmux mouse on 환경의 표준이지만 사용자가 매번 외우긴 어려워 노출. */}
      <InfoSection title={t?.('infoShortcuts') || 'Shortcuts'} icon={HelpCircle}>
        <ShortcutRow keys={[t?.('drag') || 'Drag']}            desc={t?.('shortcutSelect')    || 'Select text (auto-copy)'} />
        <ShortcutRow keys={[t?.('doubleClick') || 'Double-click']} desc={t?.('shortcutSelectWord') || 'Select word'} />
        <ShortcutRow keys={[t?.('tripleClick') || 'Triple-click']} desc={t?.('shortcutSelectLine') || 'Select line'} />
        <ShortcutRow keys={['Ctrl', 'V']}                       desc={t?.('shortcutPaste')     || 'Paste (bracketed)'} />
        <ShortcutRow keys={[t?.('rightClick') || 'Right-click']} desc={t?.('shortcutContextMenu') || 'Context menu'} />
        <ShortcutRow keys={['Ctrl', 'Shift', 'C']}              desc={t?.('shortcutCopy')      || 'Copy selection'} />
        <ShortcutRow keys={[t?.('wheel') || 'Wheel']}            desc={t?.('shortcutScroll')   || 'Scroll (auto copy-mode)'} />
        <ShortcutRow keys={['Ctrl', 'C']}                       desc={t?.('shortcutSigint')    || 'Interrupt (SIGINT)'} />
        <ShortcutRow keys={['Ctrl', 'Shift', 'F']}              desc={t?.('shortcutSearch')    || 'Find in terminal'} />
        <ShortcutRow keys={['F12']}                             desc={t?.('shortcutDevtools')  || 'Open DevTools'} />
        <div style={{ height: space['1'] }} />
        <ShortcutRow keys={['Ctrl', 'Shift', 'P']}              desc={t?.('shortcutCommandPalette') || 'Command palette'} />
        <ShortcutRow keys={['Ctrl', 'T']}                       desc={t?.('shortcutNewTab')    || 'New tab'} />
        <ShortcutRow keys={['Ctrl', 'W']}                       desc={t?.('shortcutCloseTab')  || 'Close tab'} />
        <ShortcutRow keys={['Ctrl', '\\']}                      desc={t?.('shortcutSplitRight') || 'Split right'} />
        <ShortcutRow keys={['Ctrl', 'Shift', '\\']}             desc={t?.('shortcutSplitDown') || 'Split down'} />
        <ShortcutRow keys={['Ctrl', 'P']}                       desc={t?.('shortcutQuickOpen') || 'Quick open files'} />
        <ShortcutRow keys={['Ctrl', 'S']}                       desc={t?.('shortcutSave')      || 'Save file'} />
      </InfoSection>
    </div>
  );
});

const ShortcutRow = memo(({ keys, desc }) => (
  <div style={shortcutStyles.row}>
    <div style={shortcutStyles.keys}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} style={{ ...shortcutStyles.kbd, color: 'var(--ui-text)', background: 'var(--ui-surface1)', borderColor: 'var(--ui-border)' }}>{k}</span>
      ))}
    </div>
    <div style={{ ...shortcutStyles.desc, color: 'var(--ui-subtext)' }}>{desc}</div>
  </div>
));

const shortcutStyles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['2'],
    padding: `${space['1']} 0`,
    minHeight: 22,
  },
  keys: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  kbd: {
    fontFamily: font.mono,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    borderRadius: radius.sm,
    padding: '1px 5px',
    lineHeight: 1.4,
    border: '1px solid',
  },
  desc: {
    fontSize: fontSize['11'],
    color: 'var(--ui-subtext)',
    textAlign: 'right',
    lineHeight: 1.35,
  },
};

const InfoSection = ({ title, icon: Icon, subtitle = null, children }) => (
  <div className="iterm-info-section" style={infoStyles.section}>
    <div style={infoStyles.sectionHeader}>
      {Icon && <Icon size={11} strokeWidth={2} style={{ color: 'var(--ui-subtext)', flexShrink: 0 }} />}
      <span style={{ ...infoStyles.sectionTitle, color: 'var(--ui-subtext)' }}>{title}</span>
      {subtitle && <span style={{ ...infoStyles.sectionSubtitle, color: 'var(--ui-subtext)' }}>{subtitle}</span>}
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
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: 'var(--ui-subtext)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
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
    overflow: 'auto',
  },
  activityBar: {
    height: '28px',
    width: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: '4px',
    paddingRight: '4px',
    gap: '2px',
    background: 'var(--ui-surface0)',
    borderBottom: '1px solid var(--ui-border)',
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

const CwdBreadcrumb = memo(({ paneInfo, loading, disabled, ui }) => {
  const isHostPane = paneInfo?.tabType === 'host';
  const hostShort = paneInfo?.host?.hostname || paneInfo?.host?.host || null;
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
  const displayPath = homeTilde(rawPath);

  const headerPath = !loading && !disabled
    ? (isHostPane && hostShort
        ? (displayPath ? `${hostShort}:${displayPath}` : hostShort)
        : displayPath)
    : null;

  const pillStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    width: '100%',
    overflow: 'hidden',
    background: `color-mix(in srgb, ${ui.surface1 || ui.surface0} 45%, transparent)`,
    border: `1px solid color-mix(in srgb, ${ui.border || ui.surface1} 50%, transparent)`,
    borderRadius: '5px',
    padding: '2px 7px 2px 5px',
    userSelect: 'none',
    pointerEvents: 'none',
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
            animation: 'iterm-skel-shimmer 1.8s ease-in-out infinite',
          }} />
        </div>
      </div>
    );
  }

  if (disabled || !headerPath) {
    return <div style={{ flex: 1, minWidth: '4px' }} />;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 5px' }}>
      <div style={pillStyle}>
        <HostIcon
          value={iconValue}
          fallback={Server}
          size={9}
          strokeWidth={1.8}
          style={{ flexShrink: 0, color: dotColor, opacity: 0.85 }}
        />
        {/* 좌측 정렬, 우측 말줄임 */}
        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '10px',
          fontFamily: font.mono,
          color: ui.subtext0 || ui.subtext || ui.muted,
          opacity: 0.75,
          letterSpacing: '-0.01em',
        }}>
          {headerPath}
        </span>
      </div>
    </div>
  );
});

export default RightPanel;
