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
import BroadcastBadge from './BroadcastBadge';
import useActiveTerminalCwd from '../../hooks/useActiveTerminalCwd';
import useAppConfig from '../../hooks/useAppConfig';
import useServerIdentity from '../../hooks/useServerIdentity';
import { killPaneSession, restartCwdFor } from '../../utils/restartSession';
import EmptyPane from './EmptyPane';
import PaneAddressLabel from './PaneAddressLabel';
import { derivePaneLabel, isEmptyPane } from '../../utils/paneLabel';
import { buildSshAddr, formatServerAddr, formatSessionTarget, formatSessionTargetLabel } from '../../utils/sessionTarget';
import { copyToClipboard } from '../../utils/clipboard';

const Terminal = lazy(() => import('../Terminal'));
const VncPane = lazy(() => import('../vnc/VncPane'));
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
  isBroadcastExcluded = false,
  onToggleBroadcastExclude = null,
  onReadyChange = null,  // (paneId, ready) → 터미널 접속 완료 여부를 PaneGrid 로 보고
  registerPaneActions = null,  // (paneId, {restart}) → PaneGrid calls these from menus
  onRestartPane = null,        // (paneId) → 확인창을 거쳐 재시작. PaneGrid 가 구현.
  activeFilePath = null,
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
  // VNC pane — mode:'vnc' 로 활성화된 원격 데스크톱. TerminalHeader 없이 전체 영역 사용.
  const isVnc = pane.mode === 'vnc';
  // 전체 주소(`탭.pane`) — 다른 탭에서 이 pane 을 부를 때 쓴다. 같은 탭 안에서는
  // pane 번호만으로 충분하다(itl 이 호출자의 탭을 기준점으로 삼는다).
  const tabNumber = (() => {
    const tabIndex = allTabs.findIndex((tt) => tt.id === tab?.id);
    return tabIndex >= 0 ? tabIndex + 1 : null;
  })();
  const paneAddress = tabNumber != null ? `${tabNumber}.${paneIndex + 1}` : null;
  // 주소 배지 접힘 — 설정에 저장해 새로고침·재분할 후에도 유지된다(pane 마다 다시 접게
  // 만들면 매번 같은 동작을 반복하게 된다). 기본은 펼침: 이름이 안 보이면 붙인 의미가 없다.
  const isAddressExpanded = settings?.paneAddressExpanded !== false;
  const toggleAddressExpanded = useCallback(
    () => updateSettings?.({ paneAddressExpanded: !isAddressExpanded }),
    [updateSettings, isAddressExpanded],
  );

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

  // 접속 완료 여부를 위로 보고 — TabBar 의 브로드캐스트/빠른입력/자동맞춤 버튼은
  // 터미널이 붙기 전엔 눌러봐야 아무 데도 못 보내므로 그동안 비활성화된다.
  // 빈 pane 은 보낼 터미널 자체가 없으므로 "준비됨" 으로 쳐서 다른 pane 을 막지 않는다.
  // 언마운트 시 not-ready 로 되돌린다 — 안 그러면 닫힌 pane 의 id 가 부모의 ready 집합에 남는다.
  useEffect(() => {
    onReadyChange?.(pane.id, isEmpty || terminalReady);
    return () => onReadyChange?.(pane.id, false);
  }, [onReadyChange, pane.id, isEmpty, terminalReady]);

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

  /* Clicking the pane number (top-right) copies this pane's **LLM-friendly handle** (+toast).
     The reader is an LLM in another terminal, so it carries only what is **runnable there**:
     the tmux session name, the command that attaches to it, and the working directory. The
     pane number (2.2) means something only inside this app and shifts when a pane closes. */
  // Local tmux socket name — module-cached, so many panes still make one request.
  const { tmux_socket: tmuxSocket } = useAppConfig();
  // Where this server runs — goes into the handle so a local session says which machine.
  const serverIdentity = useServerIdentity();

  const handleCopyPaneTarget = useCallback(() => {
    const tmuxSession = isLocal ? (pane.sessionId || '') : (pane.tmuxSessionName || '');
    const cwd = paneCwdAbs || pane.cwd || '';
    const addr = isLocal
      ? formatServerAddr({
        hostname: serverIdentity.hostname,
        ip: serverIdentity.ip,
        ipKind: serverIdentity.ip_kind,
      })
      : (buildSshAddr(remoteHost) || pane.hostId || '');
    const target = formatSessionTarget({
      server: addr,
      tmuxSession,
      cwd,
      // Local sessions live on the app's own socket — the name alone cannot be attached to.
      socket: isLocal ? (tmuxSocket || '') : '',
      remote: !isLocal,
    });
    if (!target) return;
    // 클립보드에는 붙여넣어 바로 쓸 수 있는 긴 핸들이 그대로 들어간다. 토스트는 **무엇을**
    // 복사했는지만 한 줄로 — 같은 문자열을 다시 띄우면 폰 화면 절반이 글자로 덮인다.
    const label = formatSessionTargetLabel({ server: addr, tmuxSession });
    copyToClipboard(target).then((ok) => onNotify?.(ok
      ? `${t?.('copied') || 'Copied'}${label ? ` · ${label}` : ''}`
      : (t?.('clipboardError') || 'Copy failed')));
  }, [isLocal, remoteHost, pane, paneCwdAbs, tmuxSocket, serverIdentity, onNotify, t]);

  // cwd 변할 때마다 부모(App.jsx)에 보고 → 자동 탭/pane 이름 갱신에 활용.
  // 원격은 workspace 상대경로가 없으므로 절대경로(paneCwdAbs)도 함께 보내 basename 으로 쓰게 한다.
  useEffect(() => {
    if (!onPaneCwdChange || !pane?.id) return;
    onPaneCwdChange(pane.id, paneCwdRel ?? '', isLocal, paneCwdAbs ?? null);
  }, [onPaneCwdChange, pane?.id, paneCwdRel, paneCwdAbs, isLocal]);

  // ── 세션 재시작 ────────────────────────────────────────────────────────────
  // tmux 를 죽인 *뒤에* remount 한다. 순서가 뒤집히면 아직 살아있는 세션에 재부착돼
  // 아무 일도 안 일어난다. 재생성은 재접속이 create=1 로 알아서 하고, 시작 디렉토리는
  // 이 mount 에 한해 restartCwd 로 덮어쓴다.
  const [restartCwd, setRestartCwd] = useState(null);
  const restartingRef = useRef(false);
  /* 재시작 중임을 Terminal 에 알리는 표식. **kill 보다 먼저** 세워야 한다 — 세션이 죽는
     순간 열려 있던 소켓이 끊기고, 그 진단이 "셸이 exit 했다"(= pane 자동 닫기)와 똑같은
     모양이기 때문이다. 표식이 없으면 우리가 일부러 죽인 세션을 두고 pane 을 닫아버린다.

     **푸는 것은 시계가 아니라 성공이다.** 새 셸이 실제로 붙으면(terminalReady) 즉시 내린다.
     Terminal 쪽 시간 창은 "영영 안 붙는 경우" 를 위한 안전망일 뿐, 주 메커니즘이 아니다 —
     인과를 시간으로 재지 말라는 규칙(CLAUDE.md "원격 세션 소멸") 을 여기서도 지킨다. */
  const [restartAt, setRestartAt] = useState(0);
  useEffect(() => {
    if (restartAt && terminalReady) setRestartAt(0);
  }, [restartAt, terminalReady]);
  const restartSession = useCallback(async () => {
    if (isEmpty) return { ok: false, error: 'empty pane' };
    if (restartingRef.current) return { ok: false, error: 'already restarting' };
    restartingRef.current = true;
    setRestartAt(Date.now());
    const nextCwd = restartCwdFor({ isLocal, paneCwdRel, paneCwdAbs });
    const result = await killPaneSession({
      isLocal,
      sessionId: pane.sessionId,
      hostId: pane.hostId,
      remoteTmuxSession,
    });
    if (result.ok) {
      setRestartCwd(nextCwd);
      setRefreshNonce((n) => n + 1);
    }
    restartingRef.current = false;
    return result;
  }, [isEmpty, isLocal, paneCwdRel, paneCwdAbs, pane.sessionId, pane.hostId, remoteTmuxSession]);

  useEffect(() => {
    if (!registerPaneActions || !pane?.id) return undefined;
    registerPaneActions(pane.id, { restart: restartSession });
    return () => registerPaneActions(pane.id, null);
  }, [registerPaneActions, pane?.id, restartSession]);

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
          Absolute overlay covers full pane; rail sits at top with pointer-events.
          VNC pane 에서는 렌더하지 않는다 — 터미널 전용 크롬(파일·폴더·재시작)이 VNC 에
          의미 없고, 30px rail 없이 캔버스가 전체 영역을 채운다. */}
      {!isVnc && (
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 6,
          pointerEvents: 'none',
        }}
      >
        {/* onCloseTerminal: 단일 pane(=곧 탭)·빈 pane 은 closeTab(유지/종료 선택 모달)으로 위임해
            오버레이+탭모달 이중 확인을 없앤다. 멀티 pane 만 인라인 오버레이로 해당 pane 세션 kill. */}
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
          onRestartSession={isEmpty || !onRestartPane ? null : () => onRestartPane(pane.id)}
          onRefreshCwd={refreshPaneCwd}
          onCloseTerminal={(isEmpty || paneCount <= 1) ? onClose : () => setPendingClose(true)}
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
          activeFilePath={activeFilePath}
          isMobile={isMobile}
        />
      </div>
      )}

      {/* 본문 영역 — top rail 30px 만큼 상단 마진. VNC pane 은 rail 이 없으므로 0. */}
      <div style={{
        flex: 1,
        position: 'relative',
        marginTop: isVnc ? 0 : '30px',
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
          ) : isVnc ? (
            <Suspense fallback={null}>
              <VncPane
                key={`vnc-${pane.id}-${pane.hostId}-${pane.display}`}
                hostId={pane.hostId}
                display={pane.display}
                paneId={pane.id}
                isActive={isActive}
                isFocused={isFocused}
                settings={settings}
                t={t}
                onReadyChange={setTerminalReady}
                updateSettings={updateSettings}
              />
            </Suspense>
          ) : (
            <>
            {/* 브로드캐스트 대상 pane 만 앰버 테두리. 제외된 pane 은 테두리 없이 배지만. */}
            {isBroadcasting && !isBroadcastExcluded && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                border: '2px solid #f59e0b',
                borderRadius: '4px',
                pointerEvents: 'none',
                boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.15)',
              }} />
            )}
            {/* pane 번호 + 이름 — `itl send 3` 의 주소. **분할 여부와 무관하게 항상 단다.**
                예전엔 `isMultiple` 일 때만 뜨게 했다("단일이면 부를 이름이 필요 없다"). 그런데
                tmux 세션 핸들 복사가 이 배지에만 걸려 있어서, 단일 pane 탭에서는 복사할 방법이
                통째로 사라졌다 — "열려있던(분할) 창은 되는데 새로 연 창은 안 된다" 의 정체다.
                주소는 단일 pane 에서도 유효하다(`itl send 1.1`). 예외 없음.
                이름을 함께 다는 이유: 분할 화면(데스크탑)엔 서브탭바가 없어서 여기 말고는
                pane 이름이 나올 자리가 없다. 모바일 서브탭바와 같은 규칙(derivePaneLabel). */}
            <PaneAddressLabel
              paneNumber={paneIndex + 1}
              tabNumber={tabNumber}
              paneLabel={isEmptyPane(pane) ? null : derivePaneLabel(pane, { hosts, settings, t })}
              fullAddress={paneAddress}
              isProminent={isFocused || hover}
              onCopy={handleCopyPaneTarget}
              copyLabel={t?.('copyPaneTarget') || 'Copy tmux session (with attach command)'}
              isExpanded={isAddressExpanded}
              onToggleExpand={toggleAddressExpanded}
              expandLabel={t?.('showPaneName') || 'Show pane name'}
              collapseLabel={t?.('hidePaneName') || 'Show address only'}
            />
            {isBroadcasting && onToggleBroadcastExclude && (
              <BroadcastBadge
                isExcluded={isBroadcastExcluded}
                onToggle={onToggleBroadcastExclude}
                t={t}
              />
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
                // 재시작 직후 mount 에서만 살아있는 cwd 로 새 세션을 연다.
                // 세션이 이미 있으면 백엔드가 cwd 쿼리를 무시하므로 남아 있어도 무해하다.
                cwd={restartCwd ?? pane.cwd ?? cwd}
                /* 탐색기에서 끌어온 경로를 셸용 절대 경로로 환산하는 데 쓴다.
                   트리 경로가 로컬은 워크스페이스 상대, 원격은 절대라 두 표현이 다 필요하다. */
                paneCwdInfo={{ isLocal, cwdAbs: paneCwdAbs || '', cwdRel: paneCwdRel || '' }}
                /* 방금 우리가 죽인 세션을 "셸이 끝났다" 로 오진해 pane 을 닫지 않게. */
                restartAt={restartAt}
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
                onRefresh={() => setRefreshNonce((n) => n + 1)}
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
                {/* 이 오버레이는 멀티 pane 에서만 뜬다(단일 pane 은 탭 닫기로 위임) → 항상 kill. */}
                {t?.('confirmClosePaneDesc') || "This pane's session ends — it can't be reopened from Home."}
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
