import { Suspense, lazy, useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Server, Monitor, Settings as SettingsIcon,
  Edit3, Trash2, ChevronLeft, ChevronRight, GripVertical,
  SquareSplitHorizontal, SquareSplitVertical,
  ArrowRightLeft, Terminal as TerminalIcon, Copy, LayoutPanelLeft,
  BarChart3,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import { glassDividerStyle, glassMenuStyle } from '../styles/glass';
import TerminalHeader from './TerminalHeader';
import HomeDashboard, { HostRow } from './HomeDashboard';
import LocalFolderPicker from './LocalFolderPicker';
import RemoteFolderPicker from './RemoteFolderPicker';
import HostIcon from '../utils/hostIcons';
import useActiveTerminalCwd from '../hooks/useActiveTerminalCwd';
import useTouchDragReorder from '../hooks/useTouchDragReorder';

const Terminal = lazy(() => import('./Terminal'));

const { color, font, fontSize, fontWeight, radius, space } = tokens;

// 호스트 카드 subtitle 한 줄 truncate + block — 멀티라인 안에서 각 라인 ellipsis 적용용.
const SUB_LINE = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

/**
 * 탭 내부의 1–4 pane. 각 pane = (Terminal/Empty) + 자체 TerminalHeader.
 * TerminalHeader 패널은 absolute overlay 라 터미널 폭을 안 밀어냄.
 */
const PaneGrid = ({
  tab,
  allTabs = [],
  hosts = [],
  isActive = true,
  isMobile = false,
  onFocusPane,
  onClosePane,
  onActivatePane,
  onExtractPaneToTab,  // (tabId, paneId) → 분할 pane 을 새 단독 탭으로 분리 (detach)
  onReorderPane,       // (tabId, fromPaneId, toPaneId) → 분할 pane 순서 변경 (subTabs 컨텍스트 메뉴)
  onPaneDragToSplit,   // (tabId, srcPaneId, destPaneId, dir) → pane 드래그로 분할 배치
  onPaneCwdChange,     // (paneId, workspaceRel, isLocal) → 부모로 cwd 변화 보고 (자동 탭명 등)
  onPaneThemeChange,   // (paneId, themeId|null) → pane 별 테마 오버라이드 설정/해제
  onSplitPane,         // (tabId, paneId, dir) → pane rail 의 split 버튼에서 호출
  layoutSignal,
  settings,
  updateSettings,
  cwd,
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
  onScreenDump,
  /* EmptyPane Resumable 카드의 종료/재attach 흐름 — App 레벨 콜백을 그대로 통과. */
  onConfirm,
  onNotify,
  onResumeHostSession,
  onTerminateHostSession,
  busyTabIds,
  busyPaneIds,
  /* EmptyPane 의 호스트/로컬 카드용 — 새탭 (HomeDashboard) 과 동일한 폴더 픽커 / 호스트 설정 진입. */
  onPickHostPath,
  onPickLocalPath,
  onEditHost,
  onEditLocal,
  refreshHosts,
  /* 인라인 폴더 픽커 — App 레벨 상태를 받아서 매칭 pane 안에서 오버레이로 렌더. */
  localPicker = null,
  onLocalPickerClose = null,
  onLocalPickerPick = null,
  remotePickerHost = null,
  remotePickerSlot = null,
  onRemotePickerClose = null,
  onRemotePickerPick = null,
  language = 'en',
  t,
  viewportHeight,
  onRenamePane,
  onDropTabToPane = null,
  onClosePaneImmediate = null,
  reloadSignal = 0,
  equalizeRef = null,  // 부모가 equalizeCurrentTab 을 호출할 수 있도록 ref 노출
}) => {
  const panes = tab?.panes || [];

  // ── split-pane resize state ─────────────────────────────────────────────────
  // Key: `${tab.id}:${path}` so sizes persist when switching tabs within same PaneGrid instance.
  const [splitSizes, setSplitSizes] = useState({});
  const resizeDragRef = useRef(null); // tracks active resize drag
  const [resizeSignal, setResizeSignal] = useState(0); // bumped on drag-end → triggers single fit

  const equalizeCurrentTab = useCallback(() => {
    setSplitSizes((prev) => {
      const prefix = `${tab.id}:`;
      const next = {};
      Object.keys(prev).forEach((k) => { if (!k.startsWith(prefix)) next[k] = prev[k]; });
      return next;
    });
    setResizeSignal((s) => s + 1);
  }, [tab.id]);

  useEffect(() => {
    if (equalizeRef) equalizeRef.current = equalizeCurrentTab;
  }, [equalizeRef, equalizeCurrentTab]);

  // Auto-equalize when panes are added or removed from the SAME tab.
  // Tab switches must NOT trigger equalization (would reset manually-configured sizes).
  const prevEqTabId = useRef(tab?.id);
  const prevEqPanesLen = useRef(panes.length);
  useEffect(() => {
    const sameTab = tab?.id === prevEqTabId.current;
    const countChanged = panes.length !== prevEqPanesLen.current;
    prevEqTabId.current = tab?.id;
    prevEqPanesLen.current = panes.length;
    if (sameTab && countChanged) equalizeCurrentTab();
  }, [tab?.id, panes.length, equalizeCurrentTab]);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizeDragRef.current) return;
      // Suppress terminal resize during drag — terminals listen to this flag
      window.__paneResizingActive = true;
      const { sizeKey, index, direction, containerEl, startPos, startSizes } = resizeDragRef.current;
      const rect = containerEl.getBoundingClientRect();
      const total = direction === 'row' ? rect.width : rect.height;
      if (total === 0) return;
      const current = direction === 'row' ? e.clientX : e.clientY;
      const delta = (current - startPos) / total;
      const next = [...startSizes];
      const MIN = 0.12;
      const SNAP_ZONE = 0.025; // snap to 50% when within 2.5% of center
      let a = Math.max(MIN, startSizes[index] + delta);
      let b = Math.max(MIN, startSizes[index + 1] - delta);
      const pair = a + b;
      const aFrac = a / pair;
      if (Math.abs(aFrac - 0.5) < SNAP_ZONE) { a = pair * 0.5; b = pair * 0.5; }
      next[index] = a;
      next[index + 1] = b;
      const sum = next.reduce((x, y) => x + y, 0);
      setSplitSizes((prev) => ({ ...prev, [sizeKey]: next.map((s) => s / sum) }));
    };
    const onUp = () => {
      if (resizeDragRef.current && window.__paneResizingActive) {
        window.__paneResizingActive = false;
        // Bump signal → layoutSignal change → each Terminal does a single clean fit
        setResizeSignal((s) => s + 1);
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('iterm:fit-terminals')));
      }
      resizeDragRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (panes.length === 0) return null;

  const layout = tab.layout || 'single';
  // sub-tabs 모드: 모바일 전용. 데스크탑에서는 split panes 를 항상 분할 화면으로 보여준다.
  const useSubTabs = panes.length > 1 && isMobile;

  // 모바일 분할: 서브탭 바 + 활성 pane 만 fullscreen
  if (useSubTabs) {
    const activePane = panes.find((p) => p.id === tab.activePaneId) || panes[0];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <SubTabBar
          panes={panes}
          activePaneId={activePane.id}
          hosts={hosts}
          busyPaneIds={busyPaneIds}
          settings={settings}
          tabColorIndex={tab.color_index}
          activeThemeId={activePane?.themeOverride || settings?.theme}
          onSelect={(paneId) => onFocusPane?.(tab.id, paneId)}
          onClose={(paneId) => onClosePane?.(tab.id, paneId)}
          onReorder={onReorderPane ? (fromId, toId) => onReorderPane(tab.id, fromId, toId) : null}
          onRenamePane={onRenamePane ? (paneId) => onRenamePane(tab.id, paneId) : null}
          onSplitPane={onSplitPane ? (paneId, dir) => onSplitPane(tab.id, paneId, dir) : null}
          isMobile={isMobile}
          t={t}
        />
        {/* 모든 pane 마운트 유지 — visibility 토글로 xterm 인스턴스·WS 연결 보존.
            display:none 대신 visibility:hidden 사용: 레이아웃 흐름에 남아 컨테이너 크기가
            항상 확정되므로 xterm.js fit 이 처음부터 정확하고 탭 전환 시 squish 없음. */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {panes.map((pane) => {
            const isThisActive = pane.id === activePane.id;
            return (
              <div
                key={pane.id}
                {...(!isThisActive ? { inert: '' } : {})}
                style={{
                  visibility: isThisActive ? 'visible' : 'hidden',
                  pointerEvents: isThisActive ? 'auto' : 'none',
                  display: 'grid',
                  gridTemplateRows: '1fr',
                  width: '100%',
                  height: '100%',
                  position: 'absolute',
                  inset: 0,
                }}
              >
                <Pane
                  pane={pane}
                  tab={tab}
                  hosts={hosts}
                  isMobile={isMobile}
                  isFocused={isThisActive}
                  isMultiple={false}
                  onFocus={() => onFocusPane?.(tab.id, pane.id)}
                  onClose={() => onClosePane?.(tab.id, pane.id)}
                  onActivate={(target) => onActivatePane?.(tab.id, pane.id, target)}
                  isActive={isActive && isThisActive}
                  layoutSignal={layoutSignal}
                  settings={settings}
                  updateSettings={updateSettings}
                  onPaneThemeChange={onPaneThemeChange}
                  cwd={cwd}
                  onFileSelect={onFileSelect}
                  onFolderSelect={onFolderSelect}
                  allTabs={allTabs}
                  onOpenTerminalAtFolder={onOpenTerminalAtFolder}
                  onPaneCwdChange={onPaneCwdChange}
                  onScreenDump={onScreenDump}
                  onConfirm={onConfirm}
                  onNotify={onNotify}
                  onResumeHostSession={onResumeHostSession}
                  onTerminateHostSession={onTerminateHostSession}
                  busyTabIds={busyTabIds}
                  busyPaneIds={busyPaneIds}
                  onPickHostPath={onPickHostPath}
                  onPickLocalPath={onPickLocalPath}
                  onEditHost={onEditHost}
                  onEditLocal={onEditLocal}
                  refreshHosts={refreshHosts}
                  localPicker={localPicker}
                  onLocalPickerClose={onLocalPickerClose}
                  onLocalPickerPick={onLocalPickerPick}
                  remotePickerHost={remotePickerHost}
                  remotePickerSlot={remotePickerSlot}
                  onRemotePickerClose={onRemotePickerClose}
                  onRemotePickerPick={onRemotePickerPick}
                  language={language}
                  t={t}
                  viewportHeight={viewportHeight}
                  onExtractPane={
                    panes.length > 1 && onExtractPaneToTab && (pane.sessionId || pane.hostId)
                      ? () => onExtractPaneToTab(tab.id, pane.id)
                      : null
                  }
                  onSplitPane={onSplitPane ? (dir) => onSplitPane(tab.id, pane.id, dir) : null}
                  onReorderPane={onReorderPane}
                  onPaneDragToSplit={onPaneDragToSplit}
                  onDropTabToPane={onDropTabToPane}
                  onCloseImmediate={onClosePaneImmediate ? () => onClosePaneImmediate(tab.id, pane.id) : null}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── recursive split tree rendering ──────────────────────────────────────────
  // If tab has a splitTree, render recursively. Otherwise fall back to legacy grid.
  const splitTree = tab.splitTree;

  if (splitTree) {
    // Build a paneId→pane lookup for quick access
    const paneMap = new Map(panes.map((p) => [p.id, p]));

    // Recursive renderer — returns a React element for the subtree
    const renderNode = (node, path = 'root', rSig = 0) => {
      if (node.type === 'pane') {
        const pane = paneMap.get(node.paneId);
        if (!pane) return null;
        return (
          <Pane
            key={pane.id}
            pane={pane}
            paneIndex={panes.indexOf(pane)}
            tab={tab}
            hosts={hosts}
            isMobile={isMobile}
            isFocused={pane.id === tab.activePaneId}
            isMultiple={panes.length > 1}
            onFocus={() => onFocusPane?.(tab.id, pane.id)}
            onClose={() => onClosePane?.(tab.id, pane.id)}
            onActivate={(target) => onActivatePane?.(tab.id, pane.id, target)}
            isActive={isActive}
            layoutSignal={`${layoutSignal}:r${rSig}`}
            reloadSignal={reloadSignal}
            settings={settings}
            updateSettings={updateSettings}
            onPaneThemeChange={onPaneThemeChange}
            cwd={cwd}
            onFileSelect={onFileSelect}
            onFolderSelect={onFolderSelect}
            allTabs={allTabs}
            onOpenTerminalAtFolder={onOpenTerminalAtFolder}
            onPaneCwdChange={onPaneCwdChange}
            onScreenDump={onScreenDump}
            onConfirm={onConfirm}
            onNotify={onNotify}
            onResumeHostSession={onResumeHostSession}
            onTerminateHostSession={onTerminateHostSession}
            busyTabIds={busyTabIds}
            busyPaneIds={busyPaneIds}
            onPickHostPath={onPickHostPath}
            onPickLocalPath={onPickLocalPath}
            onEditHost={onEditHost}
            onEditLocal={onEditLocal}
            refreshHosts={refreshHosts}
            localPicker={localPicker}
            onLocalPickerClose={onLocalPickerClose}
            onLocalPickerPick={onLocalPickerPick}
            remotePickerHost={remotePickerHost}
            remotePickerSlot={remotePickerSlot}
            onRemotePickerClose={onRemotePickerClose}
            onRemotePickerPick={onRemotePickerPick}
            language={language}
            t={t}
            viewportHeight={viewportHeight}
            onExtractPane={
              panes.length > 1 && onExtractPaneToTab && (pane.sessionId || pane.hostId)
                ? () => onExtractPaneToTab(tab.id, pane.id)
                : null
            }
            onSplitPane={onSplitPane ? (dir) => onSplitPane(tab.id, pane.id, dir) : null}
            onReorderPane={onReorderPane}
            onPaneDragToSplit={onPaneDragToSplit}
            onDropTabToPane={onDropTabToPane}
            onCloseImmediate={onClosePaneImmediate ? () => onClosePaneImmediate(tab.id, pane.id) : null}
            onEqualizePane={panes.length > 1 ? equalizeCurrentTab : null}
          />
        );
      }

      // split node
      const { direction, children } = node;
      const sizeKey = `${tab.id}:${path}`;
      const defaultSizes = children.map(() => 1 / children.length);
      // Guard against stale cached sizes with wrong child count (rebuild equal in that case)
      const cached = splitSizes[sizeKey];
      const sizes = (cached && cached.length === children.length) ? cached : defaultSizes;
      const isRow = direction === 'row';
      const HANDLE_PX = 5; // resize handle thickness

      return (
        <div style={{
          display: 'flex',
          flexDirection: isRow ? 'row' : 'column',
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
        }}>
          {children.map((child, i) => (
            <SplitFragment key={i}>
              <div style={{
                flex: `${sizes[i]} 1 0`,
                minWidth: isRow ? HANDLE_PX * 2 : 0,
                minHeight: isRow ? 0 : HANDLE_PX * 2,
                overflow: 'hidden',
              }}>
                {renderNode(child, `${path}.${i}`, rSig)}
              </div>
              {i < children.length - 1 && (
                <SplitHandle
                  direction={direction}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    resizeDragRef.current = {
                      sizeKey,
                      index: i,
                      direction,
                      containerEl: e.currentTarget.parentElement,
                      startPos: isRow ? e.clientX : e.clientY,
                      startSizes: [...sizes],
                    };
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setSplitSizes((prev) => {
                      const cur = (prev[sizeKey] && prev[sizeKey].length === children.length)
                        ? prev[sizeKey] : defaultSizes;
                      const next = [...cur];
                      const combined = next[i] + next[i + 1];
                      next[i] = combined / 2;
                      next[i + 1] = combined / 2;
                      return { ...prev, [sizeKey]: next };
                    });
                  }}
                />
              )}
            </SplitFragment>
          ))}
        </div>
      );
    };

    return <div style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}>{renderNode(splitTree, 'root', resizeSignal)}</div>;
  }

  // ── legacy grid fallback (no splitTree) ─────────────────────────────────────
  const gridStyle = {
    display: 'grid',
    width: '100%',
    height: '100%',
    gap: 0,
    ...(layout === 'h' && { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }),
    ...(layout === 'v' && { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' }),
    ...(layout === '2x2' && { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }),
    ...(layout === 'single' && { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }),
  };

  return (
    <div style={gridStyle}>
      {panes.map((pane, idx) => (
        <Pane
          key={pane.id}
          pane={pane}
          paneIndex={idx}
          hasBottomBorder={layout === 'v' ? idx === 0 : layout === '2x2' ? idx < 2 : false}
          tab={tab}
          hosts={hosts}
          isMobile={isMobile}
          isFocused={pane.id === tab.activePaneId}
          isMultiple={panes.length > 1}
          onFocus={() => onFocusPane?.(tab.id, pane.id)}
          onClose={() => onClosePane?.(tab.id, pane.id)}
          onActivate={(target) => onActivatePane?.(tab.id, pane.id, target)}
          isActive={isActive}
          layoutSignal={`${layoutSignal}:r${resizeSignal}`}
          reloadSignal={reloadSignal}
          settings={settings}
          updateSettings={updateSettings}
          onPaneThemeChange={onPaneThemeChange}
          cwd={cwd}
          onFileSelect={onFileSelect}
          onFolderSelect={onFolderSelect}
          allTabs={allTabs}
          onOpenTerminalAtFolder={onOpenTerminalAtFolder}
          onPaneCwdChange={onPaneCwdChange}
          onScreenDump={onScreenDump}
          onConfirm={onConfirm}
          onNotify={onNotify}
          onResumeHostSession={onResumeHostSession}
          onTerminateHostSession={onTerminateHostSession}
          busyTabIds={busyTabIds}
          busyPaneIds={busyPaneIds}
          onPickHostPath={onPickHostPath}
          onPickLocalPath={onPickLocalPath}
            onEditHost={onEditHost}
            onEditLocal={onEditLocal}
            refreshHosts={refreshHosts}
          localPicker={localPicker}
          onLocalPickerClose={onLocalPickerClose}
          onLocalPickerPick={onLocalPickerPick}
          remotePickerHost={remotePickerHost}
          remotePickerSlot={remotePickerSlot}
          onRemotePickerClose={onRemotePickerClose}
          onRemotePickerPick={onRemotePickerPick}
          language={language}
          t={t}
          viewportHeight={viewportHeight}
          /* 분할 → 단독 탭 추출. 단일 pane / 빈 pane 은 비활성. */
          onExtractPane={
            panes.length > 1 && onExtractPaneToTab && (pane.sessionId || pane.hostId)
              ? () => onExtractPaneToTab(tab.id, pane.id)
              : null
          }
          onSplitPane={onSplitPane ? (dir) => onSplitPane(tab.id, pane.id, dir) : null}
          onReorderPane={onReorderPane}
          onPaneDragToSplit={onPaneDragToSplit}
          onDropTabToPane={onDropTabToPane}
          onCloseImmediate={onClosePaneImmediate ? () => onClosePaneImmediate(tab.id, pane.id) : null}
          onEqualizePane={panes.length > 1 ? equalizeCurrentTab : null}
        />
      ))}
    </div>
  );
};

// React.Fragment wrapper that accepts a key prop (avoids array-of-fragment lint issues)
const SplitFragment = ({ children }) => <>{children}</>;

const SplitHandle = ({ direction, onMouseDown, onDoubleClick }) => {
  const isRow = direction === 'row';
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Drag to resize · Double-click to equalize"
      style={{
        flexShrink: 0,
        /* 6px wide/tall hit area; overlaps pane content by 2.5px each side */
        width: isRow ? '6px' : '100%',
        height: isRow ? '100%' : '6px',
        margin: isRow ? '0 -2.5px' : '-2.5px 0',
        cursor: isRow ? 'col-resize' : 'row-resize',
        background: 'transparent',
        position: 'relative',
        zIndex: 20,
        userSelect: 'none',
      }}
    >
      {/* 1px visual line centered in the hit area.
          background 를 borderStrong 으로만 두면 같은 색조 테마(Purple Shade 등)에서
          panel 배경과 거의 같아 경계가 안 보임. text 색을 mix 해 항상 최소 대비를 보장. */}
      <div style={{
        position: 'absolute',
        top: isRow ? 0 : '2.5px',
        bottom: isRow ? 0 : '2.5px',
        left: isRow ? '2.5px' : 0,
        right: isRow ? '2.5px' : 0,
        background: hovered
          ? color.accent
          : `color-mix(in srgb, var(--ui-text, ${color.text}) 22%, transparent)`,
        opacity: hovered ? 0.9 : 1,
        transition: 'background 120ms, opacity 120ms',
        pointerEvents: 'none',
      }} />
    </div>
  );
};

const Pane = ({
  pane, paneIndex = 0, hasBottomBorder = false, tab, hosts, allTabs = [], isMobile = false, isFocused, isMultiple, onFocus, onClose, onActivate,
  isActive, layoutSignal, settings, updateSettings, onPaneThemeChange, cwd,
  onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onPaneCwdChange, onScreenDump,
  onConfirm, onNotify, onResumeHostSession, onTerminateHostSession, busyTabIds, busyPaneIds,
  onPickHostPath = null, onPickLocalPath = null, onEditHost = null, onEditLocal = null, refreshHosts = null,
  localPicker = null, onLocalPickerClose = null, onLocalPickerPick = null,
  remotePickerHost = null, remotePickerSlot = null, onRemotePickerClose = null, onRemotePickerPick = null,
  language, t, viewportHeight,
  onExtractPane = null,
  onSplitPane = null,
  onReorderPane = null,
  onPaneDragToSplit = null,
  onDropTabToPane = null,
  onCloseImmediate = null,
  onEqualizePane = null,
  reloadSignal = 0,
}) => {
  /* per-pane 테마 오버라이드 — pane.themeOverride 가 있으면 그 테마 id 로 settings.theme 만 바꿔
     Terminal/TerminalHeader 에 내려보냄. 전역 settings.theme 자체는 안 건드리므로 다른 pane / 앱 UI
     (TabBar, TerminalHeader chrome, scrollbar 등) 는 그대로 유지. */
  const effectiveThemeId = pane?.themeOverride || settings?.theme;
  const paneSettings = pane?.themeOverride
    ? { ...settings, theme: pane.themeOverride }
    : settings;
  const handlePaneThemeChange = (themeId) => {
    /* 전역과 같은 id 를 고르면 override 해제 (null) — 동기화. */
    const next = themeId && themeId !== settings.theme ? themeId : null;
    onPaneThemeChange?.(pane.id, next);
  };
  const [hover, setHover] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);
  // Declare isEmpty early — used in useEffect dependency arrays below (TDZ guard)
  const isEmpty = !pane.sessionId && !pane.hostId;

  // Global reload signal from settings menu → bump refreshNonce to remount terminal
  const prevReloadSignalRef = useRef(reloadSignal);
  useEffect(() => {
    if (reloadSignal !== prevReloadSignalRef.current && reloadSignal > 0 && !isEmpty) {
      prevReloadSignalRef.current = reloadSignal;
      setRefreshNonce((n) => n + 1);
    }
  }, [reloadSignal, isEmpty]);
  const [terminalStatus, setTerminalStatus] = useState(null);
  const [tabDropZone, setTabDropZone] = useState(null); // null | 'top' | 'bottom' | 'left' | 'right' | 'center'
  const tabDropZoneRef = useRef(null); // mirrors tabDropZone — readable in drop handler without stale closure
  const [paneDragZone, setPaneDragZone] = useState(null); // zone for pane-to-pane drag preview
  const paneDragZoneRef = useRef(null);
  const [isDragTargeted, setIsDragTargeted] = useState(false); // show overlay above xterm canvas during any pane/tab drag
  const [pendingClose, setPendingClose] = useState(false);
  const paneCount = tab?.panes?.length || 1;

  /** Parse pane drag payload from custom MIME or text/plain fallback.
   *  Returns {type:'pane', tabId, paneId} or null. */
  const parsePanePayload = useCallback((dataTransfer) => {
    const raw = dataTransfer.getData('application/x-iterminallist-pane')
      || dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.type === 'pane' && obj.paneId) return obj;
    } catch { /* not JSON — ignore (could be a tab id from tab drag) */ }
    return null;
  }, []);

  const getTabDropZone = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    if (y < h * 0.2) return 'top';
    if (y > h * 0.8) return 'bottom';
    if (x < w * 0.3) return 'left';
    if (x > w * 0.7) return 'right';
    return 'center';
  };

  // Pane-to-pane drag: top/bottom edge (20%) → horizontal split,
  //                    left/right edge (30%) → vertical split,
  //                    middle box → 'center' = swap with target (handled by onReorderPane).
  const getPaneDragZone = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    if (y < h * 0.2) return 'top';
    if (y > h * 0.8) return 'bottom';
    if (x < w * 0.3) return 'left';
    if (x > w * 0.7) return 'right';
    return 'center';
  };

  // 자기 자신 split — cursor 가 가리킨 절반에 기존 pane 이 "남고" 반대편이 새 빈 pane 이 된다.
  // zone 은 다운스트림에서 "새 pane 이 들어갈 위치" 로 해석되므로 cursor 의 반대편 zone 을 반환한다.
  // (center=swap 의미는 자기 자신엔 없으므로 4방향만.)
  const getSelfPaneDragZone = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    if (y < h * 0.2) return 'bottom';
    if (y > h * 0.8) return 'top';
    return x < w * 0.5 ? 'right' : 'left';
  };

  const handleTabDragOver = useCallback((e) => {
    if (!e.dataTransfer.types.includes('application/x-iterminallist-tab')) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    const zone = getTabDropZone(e);
    tabDropZoneRef.current = zone;
    setTabDropZone(zone);
    setIsDragTargeted(true); // ensure overlay is visible even if dragenter was missed
  }, []);

  const handleTabDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      tabDropZoneRef.current = null;
      setTabDropZone(null);
      setIsDragTargeted(false);
    }
  }, []);

  const handleTabDrop = useCallback((e) => {
    const zone = tabDropZoneRef.current; // use last dragover zone — not recalculated at drop coords
    tabDropZoneRef.current = null;
    setTabDropZone(null);
    setIsDragTargeted(false);
    if (!e.dataTransfer.types.includes('application/x-iterminallist-tab')) return;
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-iterminallist-tab')); } catch { return; }
    if (!payload?.tabId || !zone) return;
    if (payload.tabId === tab?.id) return; // same tab, ignore
    e.preventDefault();
    e.stopPropagation();
    onDropTabToPane?.(payload.tabId, tab?.id, pane.id, zone);
  }, [pane.id, tab?.id, onDropTabToPane]);

  const handlePaneDragOver = useCallback((e) => {
    // Tab drags are handled by handleTabDragOver — skip for those
    if (e.dataTransfer.types.includes('application/x-iterminallist-tab')) return;
    const hasCustomMime = e.dataTransfer.types.includes('application/x-iterminallist-pane');
    const hasTextPlain = e.dataTransfer.types.includes('text/plain');
    if (!hasCustomMime && !hasTextPlain) return;
    // Self-drag 판정은 window.__draggingPaneId 글로벌을 신뢰. dataTransfer.getData() 는 dragover
    // 단계에서 브라우저 보안 정책상 빈 문자열을 자주 반환하므로 payload 파싱은 신뢰할 수 없다.
    const isSelfDrag = !!window.__draggingPaneId && window.__draggingPaneId === pane.id;
    if (isSelfDrag && paneCount > 1) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    // 자기 자신 위에선 center=swap 의미가 없으므로 항상 4방향 split zone 만 인정.
    const zone = isSelfDrag ? getSelfPaneDragZone(e) : getPaneDragZone(e);
    paneDragZoneRef.current = zone;
    setPaneDragZone(zone);
    setIsDragTargeted(true);
  }, [pane.id, paneCount]);

  const handlePaneDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      paneDragZoneRef.current = null;
      setPaneDragZone(null);
      setIsDragTargeted(false);
    }
  }, []);

  const handlePaneDrop = useCallback((e) => {
    const zone = paneDragZoneRef.current;
    paneDragZoneRef.current = null;
    setPaneDragZone(null);
    setIsDragTargeted(false);
    const payload = parsePanePayload(e.dataTransfer);
    if (!payload) return;
    const currentTabId = tab?.id;
    if (!currentTabId || payload.tabId !== currentTabId) return;
    e.preventDefault();
    e.stopPropagation();

    if (payload.paneId === pane.id) {
      // 자기 자신에 drop — 어떤 paneCount 든 가리킨 절반에 빈 새 pane 생성.
      if (zone && zone !== 'center' && onSplitPane) {
        const effectiveDir = zone === 'top' ? 'up' : zone === 'bottom' ? 'down' : zone;
        onSplitPane(effectiveDir);
        onEqualizePane?.();
      }
      return;
    }

    // 다른 pane 위 center 영역 = swap. App.jsx 의 reorderPane 이 splitTree leaf 까지 swap.
    if (zone === 'center' && onReorderPane) {
      onReorderPane(currentTabId, payload.paneId, pane.id);
      return;
    }

    if (zone && onPaneDragToSplit) {
      onPaneDragToSplit(currentTabId, payload.paneId, pane.id, zone);
      onEqualizePane?.();
    }
  }, [pane.id, paneCount, tab?.id, onPaneDragToSplit, onReorderPane, onSplitPane, onEqualizePane, parsePanePayload]);

  // 팬 컨테이너에 팬별 CSS 변수 스코프 적용 — TerminalHeader 등 팬 내부 UI 가 이 변수를 씀.
  // :root 는 건드리지 않으므로 좌측 레일·상단 헤더는 글로벌 테마 유지.
  const paneRef = useRef(null);
  const setPaneRef = useCallback((el) => {
    paneRef.current = el;
  }, []);
  useEffect(() => {
    if (!paneRef.current) return;
    const theme = themes[effectiveThemeId] || themes.catppuccin;
    const ui = buildThemeUI(theme);
    for (const [k, v] of Object.entries(ui)) {
      paneRef.current.style.setProperty(`--ui-${k}`, v);
    }
  }, [effectiveThemeId]);
  const isLocal = !!pane.sessionId && !pane.hostId;
  const isPaneBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;

  useEffect(() => {
    setTerminalReady(false);
    setTerminalStatus(null);
  }, [isEmpty, pane.sessionId, pane.id, refreshNonce]);

  // 리모트 호스트 메타 — 훅보다 먼저 계산 (훅 파라미터로 필요)
  const remoteHost = !isLocal && pane.hostId ? (hosts.find((h) => h.id === pane.hostId) || null) : null;
  // 원격 tmux 세션명 — use_remote_tmux 일 때만 유효
  const remoteTmuxSession = !isLocal && remoteHost?.use_remote_tmux
    ? (pane.tmuxSessionName || (() => {
        const base = (remoteHost.remote_tmux_session || 'mobile') + (tab?.tmuxSuffix ? `-${tab.tmuxSuffix}` : '');
        return paneIndex === 0 ? base : `${base}_${paneIndex + 1}`;
      })())
    : null;

  // pane CWD 추적 — tmux #{pane_current_path} 를 마운트/명시적 새로고침 때만 조회한다.
  const { workspaceRelative: paneCwdRel, absolutePath: paneCwdAbs, refresh: refreshPaneCwd } = useActiveTerminalCwd({
    sessionId: isLocal ? (pane.sessionId || null) : null,
    hostId: !isLocal ? (pane.hostId || null) : null,
    tmuxSession: remoteTmuxSession,
    isLocal,
    refreshSignal: refreshNonce,
  });
  // Git context path for sidebar Files/Git tabs:
  //   local: workspace-relative path ('' = root, null = outside workspace)
  //   host:  null — remote git uses separate API, not local git endpoint
  const paneGitContext = isLocal ? paneCwdRel : null;
  // Live pane cwd for FileTree navigation:
  //   local: paneCwdRel ('' = root, null = outside workspace)
  //   host:  paneCwdAbs (latest explicit tmux read) → pane.cwd → tab.cwd → host.last_cwd → host.start_path → null
  const livePaneCwd = isLocal
    ? paneCwdRel
    : (paneCwdAbs ?? pane.cwd ?? tab?.cwd ?? remoteHost?.last_cwd ?? remoteHost?.start_path ?? null);

  // cwd 변할 때마다 부모(App.jsx)에 보고 → 자동 탭 이름 같은 곳에 활용
  useEffect(() => {
    if (!onPaneCwdChange || !pane?.id) return;
    onPaneCwdChange(pane.id, paneCwdRel ?? '', isLocal);
  }, [onPaneCwdChange, pane?.id, paneCwdRel, isLocal]);

  return (
    <div
      ref={setPaneRef}
      // capture phase 로 받아서 xterm.js 가 mouse 이벤트 소비 전에 pane focus 를 보장
      onPointerDownCapture={() => { onFocus?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragEnter={(e) => {
        const types = e.dataTransfer.types;
        if (types.includes('application/x-iterminallist-tab')) {
          setIsDragTargeted(true);
          handleTabDragOver(e);
        } else if (types.includes('application/x-iterminallist-pane') || types.includes('text/plain')) {
          // Skip self-drag: if the global dragging pane id matches this pane, show nothing
          if (window.__draggingPaneId && window.__draggingPaneId === pane.id && paneCount > 1) return;
          setIsDragTargeted(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-iterminallist-tab')) {
          handleTabDragOver(e);
        } else {
          handlePaneDragOver(e);
        }
      }}
      onDragLeave={(e) => {
        handleTabDragLeave(e);
        handlePaneDragLeave(e);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('application/x-iterminallist-tab')) {
          handleTabDrop(e);
        } else {
          handlePaneDrop(e);
        }
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: themes[effectiveThemeId]?.background || color.base,
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
        boxSizing: 'border-box',
        border: 'none',
        borderBottom: hasBottomBorder ? `1px solid var(--ui-border, ${color.border})` : 'none',
        zIndex: isFocused ? 2 : hover ? 1 : 0,
        transition: 'border 120ms ease',
      }}
    >
      <style>{`
        @keyframes iterm-pane-busy-dot {
          0%, 100% { opacity: 0.48; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1); }
        }
        /* 포커스된 pane 이 busy 일 때 — 보더 색이 은은하게 숨쉬기 (75% ↔ 35%). */
        @keyframes iterm-pane-focused-busy-breath {
          0%, 100% { border-color: color-mix(in srgb, var(--ui-accent, #89b4fa) 75%, transparent); }
          50%      { border-color: color-mix(in srgb, var(--ui-accent, #89b4fa) 35%, transparent); }
        }
      `}</style>
      {/* Transparent overlay during any drag — sits above xterm canvas so dragover/drop fires reliably */}
      {isDragTargeted && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'transparent' }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-iterminallist-tab')) {
              handleTabDragOver(e);
            } else {
              handlePaneDragOver(e);
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer.types.includes('application/x-iterminallist-tab')) {
              handleTabDrop(e);
            } else {
              handlePaneDrop(e);
            }
          }}
        />
      )}
      {/* Drop zone split preview — shows resulting layout before tab or pane drop */}
      {(tabDropZone || paneDragZone) && (() => {
        const dropZone = tabDropZone || paneDragZone;
        const isVertical = dropZone === 'top' || dropZone === 'bottom';
        const isCenter = dropZone === 'center';
        const newPanePos = {
          top:    { top: 0, left: 0, right: 0, bottom: '50%' },
          bottom: { bottom: 0, left: 0, right: 0, top: '50%' },
          left:   { left: 0, top: 0, bottom: 0, right: '50%' },
          right:  { right: 0, top: 0, bottom: 0, left: '50%' },
          center: { inset: 0 },
        }[dropZone];
        const keepPos = {
          top:    { bottom: 0, left: 0, right: 0, top: '50%' },
          bottom: { top: 0, left: 0, right: 0, bottom: '50%' },
          left:   { top: 0, right: 0, bottom: 0, left: '50%' },
          right:  { top: 0, left: 0, bottom: 0, right: '50%' },
          center: null,
        }[dropZone];
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 35, pointerEvents: 'none', overflow: 'hidden' }}>
            {/* Dim the side that stays */}
            {keepPos && (
              <div style={{ position: 'absolute', ...keepPos, background: 'rgba(0,0,0,0.22)', transition: 'all 100ms' }} />
            )}
            {/* New pane preview — accent fill + border */}
            <div style={{
              position: 'absolute', ...newPanePos,
              background: `${color.accent}22`,
              border: `2px solid ${color.accent}`,
              boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 100ms',
            }}>
              {isCenter && !isEmpty
                ? <ArrowRightLeft size={22} strokeWidth={1.4} style={{ color: color.accent, opacity: 0.85, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.4))' }} />
                : <Plus size={22} strokeWidth={1.4} style={{ color: color.accent, opacity: 0.75, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.4))' }} />
              }
            </div>
            {/* Divider line at split point */}
            {!isCenter && (
              <div style={{
                position: 'absolute',
                ...(isVertical
                  ? { top: '50%', left: 0, right: 0, height: '2px', transform: 'translateY(-1px)' }
                  : { left: '50%', top: 0, bottom: 0, width: '2px', transform: 'translateX(-1px)' }),
                background: color.accent,
                opacity: 0.9,
              }} />
            )}
          </div>
        );
      })()}
      {/* TerminalHeader — top rail (30px) + optional side panel overlay.
          Absolute overlay covers full pane; rail sits at top with pointer-events. */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 6,
          pointerEvents: 'none',
        }}
      >
        <TerminalHeader
          isFocused={isFocused}
          showFocusEye={isMultiple}
          activeTabType={pane.hostId ? 'host' : 'local'}
          activeHostId={pane.hostId || null}
          gitContextPath={paneGitContext}
          paneInfo={{
            tabName: tab?.name || '',
            tabType: pane.hostId ? 'host' : 'local',
            tabId: tab?.id || null,
            sessionId: pane.sessionId || pane.id,
            paneId: pane.id,
            paneIndex,
            paneCount: tab?.panes?.length || 1,
            tmuxSessionName: pane.tmuxSessionName || null,
            effectiveTmuxSession: pane.hostId ? (() => {
              if (pane.tmuxSessionName) return pane.tmuxSessionName;
              const host = hosts.find((h) => h.id === pane.hostId);
              if (!host?.use_remote_tmux) return null;
              const baseFromHost = host.remote_tmux_session || 'mobile';
              const base = tab?.tmuxSuffix ? `${baseFromHost}-${tab.tmuxSuffix}` : baseFromHost;
              return paneIndex === 0 ? base : `${base}_${paneIndex + 1}`;
            })() : null,
            tmuxSuffix: tab?.tmuxSuffix || null,
            isPersistent: pane.hostId
              ? !!(hosts.find((h) => h.id === pane.hostId)?.use_remote_tmux) || !!pane.tmuxSessionName
              : true,
            host: pane.hostId ? (hosts.find((h) => h.id === pane.hostId) || null) : null,
            tabIcon: pane.hostId ? (tab?.icon || null) : (settings.localIcon || tab?.icon || null),
            tabColorIndex: pane.hostId
              ? (tab?.color_index ?? 0)
              : (settings.localColorIndex ?? tab?.color_index ?? 0),
            paneName: pane.name || null,
            cwd: isLocal ? (paneCwdRel ?? '') : (paneCwdAbs ?? pane.cwd ?? tab?.cwd ?? remoteHost?.last_cwd ?? remoteHost?.start_path ?? null),
            cwdAbsolute: paneCwdAbs || null,
            paneCwdRel: paneCwdRel ?? null,
            takeoverPolicy: 'last-attach-wins',
          }}
          onFileSelect={(path) => onFileSelect?.(path, pane.hostId || null)}
          onFolderSelect={onFolderSelect}
          onOpenTerminalAtFolder={(path) => onOpenTerminalAtFolder?.(path, pane.hostId || null, { tabId: tab?.id, paneId: pane.id })}
          onRefreshTerminal={isEmpty ? null : () => setRefreshNonce((n) => n + 1)}
          onRefreshCwd={refreshPaneCwd}
          onCloseTerminal={isEmpty ? onClose : () => setPendingClose(true)}
          settings={settings}
          updateSettings={updateSettings}
          paneThemeId={effectiveThemeId}
          onPaneThemeChange={handlePaneThemeChange}
          language={language}
          t={t}
          viewportHeight={viewportHeight}
          disabled={isEmpty}
          loading={!isEmpty && !terminalReady}
          terminalKey={pane.sessionId || pane.id}
          paneCwd={livePaneCwd}
          onScreenDump={onScreenDump}
          onExtractPane={onExtractPane}
          isBusy={isPaneBusy}
          sessionStatus={terminalStatus}
          onSplitPane={onSplitPane}
          onEqualizePane={onEqualizePane}
          isMobile={isMobile}
        />
      </div>

      {/* 본문 영역 — top rail 30px 만큼 상단 마진. */}
      <div style={{
        flex: 1,
        position: 'relative',
        marginTop: '30px',
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
      }}>
          {isEmpty ? (
            <EmptyPane
              isVisible={isActive}
              onActivate={onActivate}
              hosts={hosts}
              tab={tab}
              allTabs={allTabs}
              settings={settings}
              t={t}
              onConfirm={onConfirm}
              onNotify={onNotify}
              onResumeHostSession={onResumeHostSession}
              onTerminateHostSession={onTerminateHostSession}
              busyTabIds={busyTabIds}
              onPickHostPath={onPickHostPath ? (h) => onPickHostPath(h, { tabId: tab?.id, paneId: pane.id }) : null}
              onPickLocalPath={onPickLocalPath ? () => onPickLocalPath({ tabId: tab?.id, paneId: pane.id }) : null}
              onEditHost={onEditHost}
              onEditLocal={onEditLocal}
              refreshHosts={refreshHosts}
            />
          ) : (
            <Suspense fallback={null}>
              <Terminal
                key={`${pane.id}:${refreshNonce}`}
                sessionId={pane.sessionId || pane.id}
                hostId={pane.hostId || undefined}
                isMobile={isMobile}
                tmuxSuffix={tab?.tmuxSuffix || null}
                tmuxSessionName={pane.tmuxSessionName || null}
                effectiveTmuxSession={pane.hostId ? (() => {
                  if (pane.tmuxSessionName) return pane.tmuxSessionName;
                  const host = hosts.find((h) => h.id === pane.hostId);
                  const baseFromHost = host?.remote_tmux_session || 'mobile';
                  const base = tab?.tmuxSuffix ? `${baseFromHost}-${tab.tmuxSuffix}` : baseFromHost;
                  return paneIndex === 0 ? base : `${base}_${paneIndex + 1}`;
                })() : null}
                paneIndex={paneIndex}
                paneId={pane.id}
                tabId={tab?.id}
                cwd={pane.cwd ?? cwd}
                settings={paneSettings}
                /* isActive = 탭 활성 여부 (split grid 의 모든 pane 이 동시에 보이므로 visible).
                   isFocused = 같은 탭 내 어느 pane 이 키보드 포커스 받을지 (분할 시 1개만 true).
                   이 둘을 분리하지 않으면 분할 탭의 비-focused pane 이 inactive 로 평가돼
                   WebGL/WS/parse 가 다 꺼지고 클릭해야 살아나는 문제. */
                isActive={isActive}
                isFocused={isFocused}
                layoutSignal={`${layoutSignal}:${pane.id}`}
                onTakeOver={() => setRefreshNonce((n) => n + 1)}
                onReadyChange={setTerminalReady}
                onStatusChange={setTerminalStatus}
                onClosePane={onCloseImmediate || onClose}
              />
            </Suspense>
          )}

          {/* 인라인 폴더 픽커 — slot 이 이 pane 과 매칭될 때만 본문 위에 오버레이.
              부모 div 가 position:relative 라 inset:0 으로 본문 영역만 덮음. */}
          {localPicker?.open
            && localPicker.slot?.tabId === tab?.id
            && localPicker.slot?.paneId === pane.id && (
              <LocalFolderPicker
                inline
                isOpen
                initialPath={localPicker.initial}
                onClose={onLocalPickerClose}
                onPick={onLocalPickerPick}
                t={t}
              />
            )}
          {remotePickerHost
            && remotePickerSlot?.tabId === tab?.id
            && remotePickerSlot?.paneId === pane.id && (
              <RemoteFolderPicker
                inline
                isOpen
                host={remotePickerHost}
                onClose={onRemotePickerClose}
                onPick={onRemotePickerPick}
                t={t}
              />
            )}
      </div>

      {/* 패널 닫기 확인 — 글래스모피즘 오버레이 카드 */}
      {pendingClose && (
        <div
          onClick={() => setPendingClose(false)}
          style={{
            position: 'absolute', inset: 0,
            zIndex: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
            WebkitBackdropFilter: 'blur(var(--glass-blur-overlay, 4px))',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: `color-mix(in srgb, var(--ui-surface0, ${color.surface0}) 80%, transparent)`,
              backdropFilter: 'blur(var(--glass-blur-panel, 20px))',
              WebkitBackdropFilter: 'blur(var(--glass-blur-panel, 20px))',
              border: `1px solid var(--ui-borderStrong, ${color.borderStrong})`,
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
              padding: `${space['5']} ${space['6']}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space['4'],
              minWidth: '220px', maxWidth: '300px',
              fontFamily: font.sans,
            }}
          >
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: `color-mix(in srgb, var(--ui-danger, ${color.danger}) 18%, transparent)`,
              border: `1px solid color-mix(in srgb, var(--ui-danger, ${color.danger}) 40%, transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: `var(--ui-danger, ${color.danger})`,
            }}>
              <LayoutPanelLeft size={18} strokeWidth={1.8} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: `var(--ui-text, ${color.text})`, marginBottom: '4px' }}>
                {t?.('confirmClosePane') || 'Close this pane?'}
              </div>
              <div style={{ fontSize: fontSize['11'], color: `var(--ui-subtext, ${color.subtext})`, lineHeight: 1.5 }}>
                {t?.('confirmClosePaneDesc') || 'The terminal session will end.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: space['2'], width: '100%' }}>
              <button
                type="button"
                onClick={() => setPendingClose(false)}
                style={{
                  flex: 1, height: '32px', borderRadius: '7px',
                  border: `1px solid var(--ui-border, ${color.border})`,
                  background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 70%, transparent)`,
                  color: `var(--ui-subtext, ${color.subtext})`,
                  fontSize: fontSize['12'], fontWeight: fontWeight.medium,
                  cursor: 'pointer', fontFamily: 'inherit',
                  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 120ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `var(--ui-surface1, ${color.surface1})`; e.currentTarget.style.color = `var(--ui-text, ${color.text})`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 70%, transparent)`; e.currentTarget.style.color = `var(--ui-subtext, ${color.subtext})`; }}
              >
                {t?.('cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => { setPendingClose(false); onCloseImmediate?.(); }}
                style={{
                  flex: 1, height: '32px', borderRadius: '7px',
                  border: `1px solid color-mix(in srgb, var(--ui-danger, ${color.danger}) 60%, transparent)`,
                  background: `color-mix(in srgb, var(--ui-danger, ${color.danger}) 22%, transparent)`,
                  color: `var(--ui-danger, ${color.danger})`,
                  fontSize: fontSize['12'], fontWeight: fontWeight.semibold,
                  cursor: 'pointer', fontFamily: 'inherit',
                  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                  transition: 'all 120ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, var(--ui-danger, ${color.danger}) 35%, transparent)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, var(--ui-danger, ${color.danger}) 22%, transparent)`; }}
              >
                {t?.('closePane') || 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 분할 서브탭 — pane 들 가로로 나열. 활성 pane 강조 + 머신 아이콘 + busy dot.
// 모바일/데스크탑 모두 touch-drag reorder (꾹 → 드래그) 가능. X 닫기 버튼은 TerminalHeader 에 있어 생략.
const PaneCtxMenu = forwardRef(({ ctx, pane, hosts, settings, tabBarAccent, t, onRename, onClose, onDismiss,
  canMoveLeft = false, canMoveRight = false, onMoveLeft = null, onMoveRight = null, onSplitPane = null }, ref) => {
  const innerRef = useRef(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      let nx = ctx.x, ny = ctx.y;
      if (nx + rect.width > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8;
      if (nx < 8) nx = 8;
      if (ny + rect.height > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8;
      if (ny < 8) ny = 8;
      setPos({ x: nx, y: ny });
      setMeasured(true);
    }
  }, [ctx.x, ctx.y]);

  const host = pane?.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
  const isLocal = !!pane?.sessionId && !pane?.hostId;
  const isEmpty = !pane?.sessionId && !pane?.hostId;
  const iconValue = host?.icon || (isLocal ? (settings.localIcon || '') : '');
  const FallbackIcon = host ? Server : (isLocal ? Monitor : Plus);
  const label = pane?.name || host?.name || (isLocal ? ((settings.localName || '').trim() || (t?.('thisMachine') || 'Local')) : (t?.('startSession') || 'Empty'));

  return (
    <div ref={(el) => { innerRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }} style={{
      position: 'fixed', top: pos.y, left: pos.x,
      ...glassMenuStyle(),
      zIndex: 200000, minWidth: '160px',
      fontFamily: font.sans, opacity: measured ? 1 : 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderBottom: `1px solid ${glassDividerStyle().background}`, marginBottom: '2px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '18px', height: '18px', flexShrink: 0,
          background: `${tabBarAccent}22`, border: `1px solid ${tabBarAccent}44`,
          borderRadius: '3px', color: tabBarAccent,
        }}>
          <HostIcon value={iconValue} fallback={FallbackIcon} size={10} strokeWidth={1.9} />
        </span>
        <span style={{ fontSize: fontSize['11'], color: color.text, fontWeight: fontWeight.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>
      {(onMoveLeft || onMoveRight) && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onMoveLeft?.(); }} disabled={!canMoveLeft} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: canMoveLeft ? 'pointer' : 'default',
            color: canMoveLeft ? color.text : color.surface2, fontSize: fontSize['11'], fontFamily: font.sans, opacity: canMoveLeft ? 1 : 0.4,
          }}>
            <ChevronLeft size={12} strokeWidth={1.8} />
            {t?.('moveLeft') || 'Move left'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onMoveRight?.(); }} disabled={!canMoveRight} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: canMoveRight ? 'pointer' : 'default',
            color: canMoveRight ? color.text : color.surface2, fontSize: fontSize['11'], fontFamily: font.sans, opacity: canMoveRight ? 1 : 0.4,
          }}>
            <ChevronRight size={12} strokeWidth={1.8} />
            {t?.('moveRight') || 'Move right'}
          </button>
        </>
      )}
      {!isEmpty && onSplitPane && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onSplitPane('right'); }} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
            color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
          }}>
            <SquareSplitHorizontal size={12} strokeWidth={1.8} />
            {t?.('splitRight') || 'Split right'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSplitPane('left'); }} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
            color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
          }}>
            <SquareSplitHorizontal size={12} strokeWidth={1.8} style={{ transform: 'scaleX(-1)' }} />
            {t?.('splitLeft') || 'Split left'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSplitPane('down'); }} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
            color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
          }}>
            <SquareSplitVertical size={12} strokeWidth={1.8} />
            {t?.('splitDown') || 'Split down'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSplitPane('up'); }} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
            color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
          }}>
            <SquareSplitVertical size={12} strokeWidth={1.8} style={{ transform: 'scaleY(-1)' }} />
            {t?.('splitUp') || 'Split up'}
          </button>
        </>
      )}
      {!isEmpty && onRename && (
        <button onClick={(e) => { e.stopPropagation(); onRename(); }} style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
          background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
          color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
        }}>
          <Edit3 size={12} strokeWidth={1.8} />
          {t?.('rename') || 'Rename'}
        </button>
      )}
      {!isEmpty && (
        <button onClick={(e) => { e.stopPropagation(); onClose?.(); }} style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
          background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
          color: color.red, fontSize: fontSize['11'], fontFamily: font.sans,
        }}>
          <Trash2 size={12} strokeWidth={1.8} />
          {t?.('closePane') || 'Close pane'}
        </button>
      )}
    </div>
  );
});

const SubTabBar = ({
  panes, activePaneId, hosts, busyPaneIds = null,
  settings = {}, tabColorIndex, activeThemeId = null, onSelect, onClose, onReorder = null, onRenamePane = null, onSplitPane = null, t,
}) => {
  const scrollRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxRef = useRef(null);
  const ctxCloseRef = useRef(() => setCtxMenu(null));
  ctxCloseRef.current = () => setCtxMenu(null);
  // Full-label tooltip for truncated pane names
  const [labelTip, setLabelTip] = useState(null);
  const labelTipTimer = useRef(null);
  const showLabelTip = (label, el) => {
    if (!label) return;
    const rect = el.getBoundingClientRect();
    setLabelTip({ label, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    clearTimeout(labelTipTimer.current);
    labelTipTimer.current = setTimeout(() => setLabelTip(null), 2000);
  };
  const touchReorder = useTouchDragReorder({
    dataAttr: 'data-pane-id',
    scrollContainerRef: scrollRef,
    onReorder,
  });

  const tabBarAccent = tabColorIndex != null
    ? (color.dotPalette || ['#89b4fa'])[tabColorIndex % (color.dotPalette || ['#89b4fa']).length]
    : color.accent;
  const activeTheme = themes[activeThemeId || settings?.theme] || themes.catppuccin;
  const subUi = buildThemeUI(activeTheme);

  // 메인 TabBar 와 동일 패턴 — 활성 서브탭이 시야 밖이면 자동 스크롤. 모바일에서 pane 많을 때 핵심.
  useEffect(() => {
    if (!activePaneId) return undefined;
    const container = scrollRef.current;
    if (!container) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector(`[data-pane-id="${CSS.escape(activePaneId)}"]`);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const margin = 8;
      if (eRect.left < cRect.left + margin) {
        container.scrollBy({ left: eRect.left - cRect.left - margin, behavior: 'smooth' });
      } else if (eRect.right > cRect.right - margin) {
        container.scrollBy({ left: eRect.right - cRect.right + margin, behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activePaneId, panes.length]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handle = (e) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target) && !e.target?.closest?.('[data-pane-more="true"]')) {
        ctxCloseRef.current();
      }
    };
    const handleKey = (e) => { if (e.key === 'Escape') ctxCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); document.removeEventListener('keydown', handleKey); };
  }, [!!ctxMenu]);

  return (
    <>
      <style>{`
        .iterm-subtabbar-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .iterm-subtabbar-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        @keyframes iterm-subtab-busy-blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        .iterm-subtab-busy-dot { animation: iterm-subtab-busy-blink 1.1s ease-in-out infinite; }
      `}</style>
      {labelTip && createPortal(
        <div style={{
          position: 'fixed',
          top: labelTip.y,
          left: Math.max(8, Math.min(window.innerWidth - 8, labelTip.x)),
          transform: 'translateX(-50%)',
          background: subUi.surface1 || subUi.surface0,
          border: `1px solid ${subUi.border}`,
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '12px',
          fontFamily: font.sans,
          color: subUi.text,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 300000,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {labelTip.label}
        </div>,
        document.body
      )}
      <div
        ref={scrollRef}
        className="iterm-subtabbar-scroll"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: '34px',
          background: `linear-gradient(180deg, ${subUi.mantle}, ${subUi.crust})`,
          borderBottom: `1px solid ${subUi.border}`,
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
          padding: '0 4px 0 6px',
          gap: '0',
          fontFamily: font.sans,
        }}
      >
        {panes.map((pane, idx) => {
          const isFirst = idx === 0;
          const isActive = pane.id === activePaneId;
          const isEmpty = !pane.sessionId && !pane.hostId;
          const isLocal = !!pane.sessionId && !pane.hostId;
          const isBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;
          const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
          const label = pane.manualName ? pane.name
            : (pane.name || host?.name
              || (isLocal ? ((settings.localName || '').trim() || (t?.('thisMachine') || 'Local')) : (t?.('startSession') || 'Empty')));
          const iconValue = host?.icon || (isLocal ? (settings.localIcon || '') : '');
          const FallbackIcon = host ? Server : (isLocal ? Monitor : Plus);
          const paneTheme = themes[pane.themeOverride || settings?.theme] || activeTheme;
          const paneUi = buildThemeUI(paneTheme);
          const paneBorderStrong = paneUi['border-strong'] || paneUi.border;
          const hostAccent = host?.color_index != null
            ? color.dotPalette[(host.color_index ?? 0) % color.dotPalette.length]
            : null;
          const localAccent = isLocal && settings?.localColorIndex != null
            ? color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length]
            : null;
          const paneAccent = hostAccent || localAccent || paneUi.accent || tabBarAccent;
          const tabBg = isActive ? paneUi.base : subUi.mantle;
          const isDragging = touchReorder.draggingId === pane.id;
          const isDragOver = touchReorder.dragOverId === pane.id && touchReorder.draggingId && touchReorder.draggingId !== pane.id;
          const touchProps = onReorder ? touchReorder.getItemProps(pane.id) : null;
          return (
            <div
              key={pane.id}
              title={label}
              data-pane-id={pane.id}
              {...(touchProps || {})}
              onClick={(e) => {
                if (isActive) showLabelTip(label, e.currentTarget);
                onSelect(pane.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '0 8px 0 10px',
                height: 'calc(100% + 1px)',
                minWidth: '140px',
                maxWidth: '200px',
                background: isDragOver ? `color-mix(in srgb, ${color.accent} 14%, ${tabBg})` : tabBg,
                color: isActive ? paneUi.text : paneUi.muted,
                fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
                fontSize: fontSize['12'],
                border: `1px solid ${isActive ? paneBorderStrong : subUi.border}`,
                borderBottom: `1px solid ${tabBg}`,
                boxShadow: isDragOver ? `inset 0 0 0 2px ${color.accent}` : 'none',
                borderRadius: 0,
                boxSizing: 'border-box',
                marginLeft: isFirst ? 0 : '-1px',
                flex: '0 0 150px',
                cursor: 'pointer',
                opacity: isDragging ? 0.4 : 1,
                userSelect: 'none',
                position: 'relative',
                zIndex: isDragOver ? 2 : (isActive ? 1 : 0),
                transition: 'background 150ms, color 150ms, box-shadow 120ms',
              }}
            >
              {idx < 9 && (
                <span
                  aria-hidden
                  style={{
                    fontFamily: font.mono,
                    fontSize: '10px',
                    fontWeight: 600,
                    color: isActive ? paneUi.subtext : paneUi.muted,
                    opacity: isActive ? 0.95 : 0.75,
                    flexShrink: 0,
                    lineHeight: 1,
                    letterSpacing: 0,
                    width: '10px',
                    textAlign: 'center',
                  }}
                >
                  {idx + 1}
                </span>
              )}
              {/* 서브탭은 메인탭보다 한 단계 아래 위계 — 아이콘 박스(테두리/배경) 제거.
                  순수 아이콘 + 색만 입혀 가볍게, 메인탭과 시각적 차별. */}
              <span
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  flexShrink: 0,
                  color: isActive ? paneAccent : `${paneAccent}cc`,
                  opacity: isActive ? 1 : 0.75,
                }}
              >
                <HostIcon value={iconValue} fallback={FallbackIcon} size={13} strokeWidth={1.9} />
                {isBusy && (
                  <span
                    className="iterm-subtab-busy-dot"
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: paneAccent,
                      boxShadow: `0 0 0 1.5px ${subUi.crust}`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  letterSpacing: '0.005em',
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};

// 빈 pane = HomeDashboard 그대로 재사용. 차이는 두 가지뿐:
//  - extraTopSlot 으로 'Open tabs' (다른 탭 흡수) 섹션을 끼움 — 빈 패널 전용.
//  - 콜백을 onActivate({type, ...}) 시그니처로 변환.
const EmptyPane = ({
  onActivate, hosts = [], tab, allTabs = [], settings = {}, t,
  onConfirm, onNotify, onTerminateHostSession, busyTabIds,
  onPickHostPath = null, onPickLocalPath = null, onEditHost = null, onEditLocal = null, refreshHosts = null,
  isVisible = true,
}) => {
  // 현재 탭 자신은 후보에서 제외 — 다른 열린 탭의 활성 pane 을 미러.
  // index 는 상단 탭바와 동일한 1-base 순번 (Ctrl+N 단축키와 짝).
  const otherTabs = (allTabs || [])
    .map((tt, idx) => ({ tab: tt, index: idx + 1 }))
    .filter(({ tab: tt }) =>
      tt && tt.id && tt.id !== tab?.id && (tt.panes || []).some((p) => p.sessionId || p.hostId),
    );
  /* 로컬 카드 메타 — 홈 대시보드 동일 출처(settings.localXxx). */
  const localCard = {
    name: (settings.localName || '').trim() || (t?.('thisMachine') || 'This machine'),
    icon: settings.localIcon || '',
    accent: color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length],
    startPath: settings.localStartPath || '',
  };

  // 다른 탭 흡수 섹션 — HomeDashboard 의 extraTopSlot 으로 넘김.
  const openTabsSlot = otherTabs.length > 0 ? (
    <Section icon={ArrowRightLeft} title={t?.('mirrorOpenTab') || 'Open tabs'}>
      <OpenTabPicker
        tabs={otherTabs}
        hosts={hosts}
        t={t}
        onPick={(tabId) => onActivate?.({ type: 'tab', sourceTabId: tabId })}
        emptySlotCount={(tab?.panes || []).filter((p) => !p.sessionId && !p.hostId).length}
        embedded
      />
    </Section>
  ) : null;

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <HomeDashboard
        isVisible={isVisible}
        hosts={hosts}
        settings={settings}
        localCard={localCard}
        // host/local 열기 — HomeDashboard 시그니처를 onActivate 로 변환.
        onOpenHost={(target) => {
          if (target?.isLocal || target?.id === 'local') {
            onActivate?.({ type: 'local' });
          } else if (target?.id) {
            onActivate?.({ type: 'host', hostId: target.id });
          }
        }}
        onOpenHostAtPath={onPickHostPath || null}
        onEditLocal={onEditLocal || null}
        onPickLocalPath={onPickLocalPath || null}
        // 빈 패널에서는 호스트 추가/편집 진입은 부모 콜백 사용. 없으면 EmptyRow 가 빈 핸들러로 동작.
        onAddHost={() => { /* 호스트 관리는 사이드바 HostManager 에서 — 여기서는 추가 진입 미제공 */ }}
        onEditHost={onEditHost || null}
        // 영속 세션 — 빈 슬롯에 attach (새 탭이 아니라 이 슬롯 채움).
        tabs={allTabs}
        busyTabIds={busyTabIds}
        onJumpTab={() => { /* 빈 패널에서는 점프 대신 Open tabs 섹션을 통한 미러 사용 */ }}
        onResumeHostSession={(host, sessionName) => {
          onActivate?.({ type: 'host', hostId: host.id, tmuxSessionName: sessionName });
        }}
        onTerminateHostSession={onTerminateHostSession}
        onConfirm={onConfirm}
        onNotify={onNotify}
        refreshHosts={refreshHosts}
        embedded
        showUsageStats
        extraTopSlot={openTabsSlot}
        t={t}
      />
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <div style={emptyStyles.section}>
    <div style={emptyStyles.sectionHead}>
      {Icon && <Icon size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
      <span style={emptyStyles.sectionTitle}>{title}</span>
    </div>
    <div>{children}</div>
  </div>
);

const emptyStyles = {
  root: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '20px 20px 24px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: '960px',
    width: '100%',
    margin: '0 auto',
  },
  sectionHead: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '8px',
  },
};

const OpenTabPicker = ({ tabs, hosts = [], onPick, t, embedded = false, emptySlotCount = 0 }) => {
  const palette = color.dotPalette || ['#89b4fa'];
  const [hoverId, setHoverId] = useState(null);
  const innerStyle = embedded
    ? { display: 'flex', flexDirection: 'column', gap: '8px' }
    : mirrorStyles.inner;
  return (
    <div style={embedded ? null : mirrorStyles.outer}>
      <div style={innerStyle}>
        {!embedded && (
          <div style={mirrorStyles.titleRow}>
            <Copy size={12} strokeWidth={2} style={{ color: color.subtext }} />
            <span style={mirrorStyles.title}>
              {t?.('mirrorOpenTab') || 'Mirror an open tab here'}
            </span>
          </div>
        )}
        <div style={mirrorStyles.grid}>
          {tabs.map(({ tab: tb, index }) => {
            const isHost = tb.type === 'host';
            const hostMeta = isHost ? hosts.find((h) => h.id === tb.hostId) : null;
            const accent = tb.color_index != null
              ? palette[tb.color_index % palette.length]
              : color.accent;
            const paneCount = (tb.panes || []).filter((p) => p.sessionId || p.hostId).length;
            const disabled = paneCount > emptySlotCount;
            return (
              <HostRow
                key={tb.id}
                id={tb.id}
                accentColor={accent}
                leadingBadge={null}
                disabled={disabled}
                icon={
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
                    <HostIcon
                      value={tb.icon || (hostMeta?.icon || '')}
                      fallback={isHost ? Server : TerminalIcon}
                      size={20}
                    />
                    {index <= 9 && (
                      <span style={{
                        position: 'absolute',
                        top: '-6px',
                        left: '-6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '14px',
                        height: '14px',
                        padding: '0 3px',
                        fontSize: '9px',
                        fontWeight: 700,
                        color: color.base,
                        fontFamily: font.mono,
                        background: accent,
                        borderRadius: '3px',
                        lineHeight: 1,
                        pointerEvents: 'none',
                      }}>
                        {index}
                      </span>
                    )}
                  </div>
                }
                name={tb.name}
                subtitle={
                  <>
                    <span style={{ ...SUB_LINE, opacity: disabled ? 0.35 : 1 }}>
                      {isHost
                        ? (hostMeta ? `${hostMeta.ssh_user}@${hostMeta.hostname}` : tb.hostId)
                        : (t?.('thisMachine') || 'This machine')}
                    </span>
                    <span style={{ ...SUB_LINE, color: color.faint, opacity: disabled ? 0.35 : 1 }}>
                      {paneCount > 1
                        ? `${paneCount} ${t?.('panesInTab') || 'panes'}`
                        : (tb.cwd || '')}
                    </span>
                  </>
                }
                isHovered={disabled ? false : hoverId === tb.id}
                onHover={disabled ? null : setHoverId}
                onClick={disabled ? null : () => onPick(tb.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const mirrorStyles = {
  outer: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0 20px 16px',
  },
  inner: {
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingTop: '4px',
  },
  titleRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  title: {
    fontSize: '11px',
    fontWeight: 600,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '8px',
  },
};

export default PaneGrid;
