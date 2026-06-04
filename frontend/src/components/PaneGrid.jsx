import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '../styles/tokens';
import useSnippets from '../hooks/useSnippets';
import SnippetPalette from './SnippetPalette';
import Pane from './panegrid/Pane';
import SubTabBar from './panegrid/SubTabBar';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

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

  // ── Broadcast ─────────────────────────────────────────────────────────────
  // broadcastActive: 이 탭의 모든 터미널 pane 에 동시 입력. pane 2개 이상일 때 의미있음.
  const [broadcastActive, setBroadcastActive] = useState(false);
  const broadcastActiveRef = useRef(false);
  useEffect(() => { broadcastActiveRef.current = broadcastActive; }, [broadcastActive]);
  // 탭이 바뀌거나 pane 수가 1이 되면 broadcast 자동 해제
  useEffect(() => {
    if (panes.length < 2) setBroadcastActive(false);
  }, [panes.length]);
  // termRefMap: paneId → Terminal imperative handle ({ sendData })
  const termRefMap = useRef({});
  // panesRef: handleBroadcast 에서 최신 panes 를 참조하기 위한 stable ref
  const panesRef = useRef(panes);
  useEffect(() => { panesRef.current = panes; }, [panes]);
  // stable fan-out 콜백 — broadcastActiveRef + panesRef 를 통해 최신 상태 읽음
  const handleBroadcast = useCallback((fromPaneId, data) => {
    if (!broadcastActiveRef.current) return;
    for (const p of panesRef.current) {
      if (p.id !== fromPaneId) termRefMap.current[p.id]?.sendData?.(data);
    }
  }, []);
  // Terminal imperative handle 등록/해제 — Pane 으로 내려보내 ref 콜백에서 호출.
  const registerTerminal = useCallback((paneId, handle) => {
    if (handle) termRefMap.current[paneId] = handle;
    else delete termRefMap.current[paneId];
  }, []);
  // pane 2개 이상일 때만 토글 가능. 그 외엔 null → 헤더 버튼 숨김.
  const broadcastToggle = panes.length >= 2 ? () => setBroadcastActive((v) => !v) : null;

  // ── Snippet Palette ────────────────────────────────────────────────────────
  const [snippetOpen, setSnippetOpen] = useState(false);
  const { snippets, create: createSnippet, remove: deleteSnippet } = useSnippets(true);

  // Ctrl+Shift+P → 팔레트 열기 (pane 이 활성 상태일 때만)
  useEffect(() => {
    if (!isActive) return undefined;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setSnippetOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive]);

  // 스니펫 실행 — 포커스된 pane 의 터미널로 전송
  const handleRunSnippet = useCallback((command) => {
    const focusedPane = panesRef.current.find((p) => p.id === tab?.activePaneId) || panesRef.current[0];
    if (!focusedPane) return;
    termRefMap.current[focusedPane.id]?.sendData?.(command + '\n');
  }, [tab?.activePaneId]);

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
                  isBroadcasting={broadcastActive}
                  onBroadcastToggle={broadcastToggle}
                  registerTerminal={registerTerminal}
                  onBroadcastData={handleBroadcast}
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
            isBroadcasting={broadcastActive}
            onBroadcastToggle={broadcastToggle}
            registerTerminal={registerTerminal}
            onBroadcastData={handleBroadcast}
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
    <>
    {snippetOpen && createPortal(
      <SnippetPalette
        isOpen={snippetOpen}
        onClose={() => setSnippetOpen(false)}
        snippets={snippets}
        onCreate={createSnippet}
        onDelete={deleteSnippet}
        onRun={handleRunSnippet}
        t={t}
      />,
      document.body
    )}
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
          isBroadcasting={broadcastActive}
          onBroadcastToggle={broadcastToggle}
          registerTerminal={registerTerminal}
          onBroadcastData={handleBroadcast}
        />
      ))}
    </div>
    </>
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

export default PaneGrid;
