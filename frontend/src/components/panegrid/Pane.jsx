/**
 * 단일 pane — (Terminal / 빈 화면 EmptyPane) + 자체 TerminalHeader 오버레이 + 폴더 픽커.
 * 분할 그리드의 잎 노드. PaneGrid.jsx 에서 로직 변경 없이 추출.
 */
import { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react';
import { Plus, ArrowRightLeft, LayoutPanelLeft } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import themes from '../../styles/themes';
import { buildThemeUI } from '../../styles/themeUI';
import TerminalHeader from '../TerminalHeader';
import LocalFolderPicker from '../LocalFolderPicker';
import RemoteFolderPicker from '../RemoteFolderPicker';
import useActiveTerminalCwd from '../../hooks/useActiveTerminalCwd';
import EmptyPane from './EmptyPane';

const Terminal = lazy(() => import('../Terminal'));
const { color, font, fontSize, fontWeight, space } = tokens;

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
  isBroadcasting = false,
  onBroadcastToggle = null,
  registerTerminal = null,
  onBroadcastData = null,
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
    hostId: !isLocal && remoteHost ? (pane.hostId || null) : null,
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
      // CommandInput 모달이 이 pane 위에 띄울 수 있도록 — querySelector('[data-pane-id]') 로 rect 추적.
      data-pane-id={pane.id}
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
          isBroadcasting={isBroadcasting}
          onBroadcastToggle={onBroadcastToggle}
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
            <>
            {isBroadcasting && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                border: '2px solid #f59e0b',
                borderRadius: '4px',
                pointerEvents: 'none',
                boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.15)',
              }} />
            )}

            <Suspense fallback={null}>
              <Terminal
                key={`${pane.id}:${refreshNonce}`}
                ref={(handle) => registerTerminal?.(pane.id, handle)}
                onBroadcast={(data) => onBroadcastData?.(pane.id, data)}
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
            </>
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

export default Pane;
