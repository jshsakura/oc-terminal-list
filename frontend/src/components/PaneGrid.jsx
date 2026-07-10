import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw } from 'lucide-react';
import { tokens } from '../styles/tokens';
import useSnippets from '../hooks/useSnippets';
import SnippetPalette from './SnippetPalette';
import Pane from './panegrid/Pane';
import SubTabBar from './panegrid/SubTabBar';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

// splitTree 하위의 pane(leaf) 개수. (테스트용 export)
export const countLeaves = (node) => (
  node?.type === 'pane' ? 1 : (node?.children || []).reduce((sum, c) => sum + countLeaves(c), 0)
);

/**
 * 한 분할 노드의 기본 비율 — 모든 pane 이 같은 "면적"을 갖도록 자식을 leaf 개수로 가중한다.
 *
 * 자식을 1/n 로 나누면 중첩 트리에서 leaf 가 균등해지지 않는다
 * (4분할 중 한 칸을 또 2분할하면 그 둘은 나머지의 절반).
 * leaf 개수로 가중하면 부모 축 길이를 leaf 수에 비례해 나눠 갖게 되어,
 * 방향(row/column)이 섞여 있어도 최종 leaf 면적이 모두 같아진다.
 *
 * 이게 *기본값* 이라는 점이 핵심 — splitSizes 는 저장되지 않아 새로고침하면 항상 여기로
 * 돌아온다. 예전엔 기본값이 1/n 이라 균등 분할 후 새로고침하면 다시 불균등해졌다.
 */
export const balancedRatios = (children = []) => {
  if (!children.length) return [];
  const total = children.reduce((sum, c) => sum + countLeaves(c), 0);
  if (!total) return children.map(() => 1 / children.length);
  return children.map((c) => countLeaves(c) / total);
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
  /* Broadcast 토글은 TabBar(설정 버튼 옆)로 올라갔다. equalizeRef 와 같은 방식으로
     토글 함수를 ref 에 노출하고, 켜짐 여부는 콜백으로 부모에 보고한다. */
  broadcastRef = null,
  onBroadcastChange = null,
  onReadyChange = null,  // (tabId, ready) → 이 탭의 모든 pane 이 접속 완료됐는지 부모에 보고
  activeFilePath = null,  // 열려 있는 에디터 파일 경로 — FileTree 업로드 목적지 폴백용
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
  // 브로드캐스트에서 뺀 pane 들 — 5분할 중 한 곳만 빼고 보내는 용도.
  // 제외된 pane 은 입력을 받지도, 자기 입력을 남에게 보내지도 않는다.
  const [broadcastExcluded, setBroadcastExcluded] = useState(() => new Set());
  const broadcastExcludedRef = useRef(broadcastExcluded);
  useEffect(() => { broadcastExcludedRef.current = broadcastExcluded; }, [broadcastExcluded]);
  const toggleBroadcastExclude = useCallback((paneId) => setBroadcastExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(paneId)) next.delete(paneId); else next.add(paneId);
    return next;
  }), []);
  // 브로드캐스트를 끄면 제외 목록도 초기화 — 다시 켤 때 전원 참여가 기본.
  useEffect(() => {
    if (!broadcastActive) setBroadcastExcluded((prev) => (prev.size ? new Set() : prev));
  }, [broadcastActive]);
  // 사라진 pane 의 id 는 제외 목록에서 정리.
  useEffect(() => {
    setBroadcastExcluded((prev) => {
      if (!prev.size) return prev;
      const live = new Set(panes.map((p) => p.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [panes]);
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
    const excluded = broadcastExcludedRef.current;
    // 제외된 pane 에서 친 입력은 자기 자신에게만 남는다.
    if (excluded.has(fromPaneId)) return;
    for (const p of panesRef.current) {
      if (p.id !== fromPaneId && !excluded.has(p.id)) termRefMap.current[p.id]?.sendData?.(data);
    }
  }, []);
  // Terminal imperative handle 등록/해제 — Pane 으로 내려보내 ref 콜백에서 호출.
  const registerTerminal = useCallback((paneId, handle) => {
    if (handle) termRefMap.current[paneId] = handle;
    else delete termRefMap.current[paneId];
  }, []);

  // ── pane 액션 레지스트리 (현재는 세션 재시작) ──────────────────────────────
  // 재시작은 pane 안에서만 알 수 있는 것(sessionId/원격 tmux 세션명/살아있는 cwd/remount)에
  // 의존하므로 Pane 이 구현하고, 메뉴가 있는 여기서는 등록된 함수를 부르기만 한다.
  const paneActionsRef = useRef({});
  const registerPaneActions = useCallback((paneId, actions) => {
    if (actions) paneActionsRef.current[paneId] = actions;
    else delete paneActionsRef.current[paneId];
  }, []);

  // tmux 를 죽이면 그 안에서 돌던 프로세스도 함께 끝난다 — 되돌릴 수 없으니 한 번 확인받는다.
  const handleRestartPane = useCallback((paneId) => {
    const run = async () => {
      const result = await paneActionsRef.current[paneId]?.restart?.();
      if (result && !result.ok) {
        onNotify?.(t?.('restartSessionFailed') || 'Failed to restart the session.');
      }
    };
    if (!onConfirm) { run(); return; }
    onConfirm({
      title: t?.('restartSession') || 'Restart session',
      titleIcon: RotateCw,
      message: t?.('restartSessionConfirm')
        || 'This ends the current tmux session and reopens it at the same path. Every running process is terminated.',
      confirmText: t?.('restartSession') || 'Restart',
      danger: true,
      onConfirm: run,
    });
  }, [onConfirm, onNotify, t]);
  // pane 2개 이상일 때만 토글 가능. 그 외엔 null → TabBar 버튼 숨김.
  const broadcastToggle = panes.length >= 2 ? () => setBroadcastActive((v) => !v) : null;

  // 활성 탭의 broadcast 토글/상태를 부모(App→TabBar)에 노출.
  // 비활성 탭이 자기 상태를 덮어쓰지 않도록 isActive 일 때만 보고한다.
  useEffect(() => {
    if (!isActive) return;
    if (broadcastRef) broadcastRef.current = broadcastToggle;
    onBroadcastChange?.(broadcastActive);
  }, [isActive, broadcastRef, onBroadcastChange, broadcastActive, panes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── pane 접속 완료 집계 ────────────────────────────────────────────────────
  // TabBar 액션 버튼의 disabled 판단에 쓰인다.
  const [readyPaneIds, setReadyPaneIds] = useState(() => new Set());
  const handlePaneReady = useCallback((paneId, ready) => setReadyPaneIds((prev) => {
    if (prev.has(paneId) === ready) return prev;
    const next = new Set(prev);
    if (ready) next.add(paneId); else next.delete(paneId);
    return next;
  }), []);
  // 포커스된 pane 하나만 본다. "모든 pane 이 준비" 로 두면 배경 pane 하나가
  // (모바일 서브탭 전환처럼 remount 로) 잠깐 not-ready 가 되는 순간 탭 전체 액션이
  // 잠겨버리고, 되돌아오지 않으면 영영 잠긴다. 기본 전송 대상도 포커스 pane 이다.
  // 탭 id 와 함께 보고 — 부모가 탭별로 보관하므로 탭을 바꿔도 값이 새어나가지 않는다.
  const focusedPaneId = panes.find((p) => p.id === tab.activePaneId)?.id || panes[0]?.id || null;
  const tabReady = !!focusedPaneId && readyPaneIds.has(focusedPaneId);
  useEffect(() => {
    onReadyChange?.(tab.id, tabReady);
  }, [onReadyChange, tab.id, tabReady]);

  // ── Snippet Palette ────────────────────────────────────────────────────────
  const [snippetOpen, setSnippetOpen] = useState(false);
  const { snippets, create: createSnippet, remove: deleteSnippet } = useSnippets(true);

  // Ctrl+Shift+S → 스니펫 팔레트 (pane 이 활성 상태일 때만)
  //
  // 예전엔 Ctrl+Shift+P 였는데 App 의 커맨드 팔레트와 같은 키다. 둘은 각자 window 에
  // keydown 을 걸고 있어 preventDefault 로는 서로를 막지 못하므로(stopImmediatePropagation
  // 이 필요) 한 번 누르면 두 팔레트가 동시에 열렸다. Ctrl+Shift+P 는 커맨드 팔레트(VS Code
  // 관례)에 양보하고 스니펫을 옮긴다.
  useEffect(() => {
    if (!isActive) return undefined;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
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

  // 저장된 크기를 버리면 renderNode 의 기본값(balancedRatios)으로 돌아간다 —
  // 그 기본값이 이미 모든 pane 을 같은 면적으로 만든다.
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

  // 레이아웃 분기(subTabs / splitTree / legacy grid) 셋 다 공통으로 얹는 오버레이.
  // 예전엔 legacy grid 분기에만 있어서 splitTree 탭·모바일 서브탭에선 Ctrl+Shift+P 로
  // snippetOpen 만 켜지고 팔레트가 렌더되지 않았다.
  const overlays = snippetOpen ? createPortal(
    <SnippetPalette
      isOpen={snippetOpen}
      onClose={() => setSnippetOpen(false)}
      snippets={snippets}
      onCreate={createSnippet}
      onDelete={deleteSnippet}
      onRun={handleRunSnippet}
      t={t}
    />,
    document.body,
  ) : null;

  // 모바일 분할: 서브탭 바 + 활성 pane 만 fullscreen
  if (useSubTabs) {
    const activePane = panes.find((p) => p.id === tab.activePaneId) || panes[0];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        {overlays}
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
          onRestartPane={handleRestartPane}
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
                  isBroadcastExcluded={broadcastExcluded.has(pane.id)}
                  onToggleBroadcastExclude={() => toggleBroadcastExclude(pane.id)}
                  onReadyChange={handlePaneReady}
                  registerPaneActions={registerPaneActions}
                  registerTerminal={registerTerminal}
                  onBroadcastData={handleBroadcast}
                  activeFilePath={activeFilePath}
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
            isBroadcastExcluded={broadcastExcluded.has(pane.id)}
            onToggleBroadcastExclude={() => toggleBroadcastExclude(pane.id)}
            onReadyChange={handlePaneReady}
            registerPaneActions={registerPaneActions}
            registerTerminal={registerTerminal}
            onBroadcastData={handleBroadcast}
            activeFilePath={activeFilePath}
          />
        );
      }

      // split node
      const { direction, children } = node;
      const sizeKey = `${tab.id}:${path}`;
      const defaultSizes = balancedRatios(children);
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

    return (
      <div style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0, position: 'relative' }}>
        {overlays}
        {renderNode(splitTree, 'root', resizeSignal)}
      </div>
    );
  }

  // ── legacy grid fallback (no splitTree) ─────────────────────────────────────
  const gridStyle = {
    display: 'grid',
    width: '100%',
    height: '100%',
    gap: 0,
    // Broadcast 배너를 pane 영역 우측 상단에 절대배치하기 위한 기준. 그리드 아이템 배치엔 영향 없음.
    position: 'relative',
    ...(layout === 'h' && { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }),
    ...(layout === 'v' && { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' }),
    ...(layout === '2x2' && { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }),
    ...(layout === 'single' && { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }),
  };

  return (
    <>
    {overlays}
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
          isBroadcastExcluded={broadcastExcluded.has(pane.id)}
          onToggleBroadcastExclude={() => toggleBroadcastExclude(pane.id)}
          onReadyChange={handlePaneReady}
          registerPaneActions={registerPaneActions}
          registerTerminal={registerTerminal}
          onBroadcastData={handleBroadcast}
          activeFilePath={activeFilePath}
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
