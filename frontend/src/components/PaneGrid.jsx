import { Suspense, lazy, useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Server, Terminal as TerminalIcon, Monitor, Copy, Plug, History, ArrowRightLeft, Settings as SettingsIcon,
  MoreHorizontal, Edit3, Trash2, ChevronLeft, ChevronRight, GripVertical,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import RightPanel from './RightPanel';
import { HostRow } from './HomeDashboard';
import HomeSessions from './HomeSessions';
import HostIcon from '../utils/hostIcons';
import useActiveTerminalCwd from '../hooks/useActiveTerminalCwd';
import useHostReorder from '../hooks/useHostReorder';
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
 * 탭 내부의 1–4 pane. 각 pane = (Terminal/Empty) + 자체 RightPanel.
 * RightPanel 패널은 absolute overlay 라 터미널 폭을 안 밀어냄.
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
  onExtractPaneToTab, // (tabId, paneId) → 분할 pane 을 새 단독 탭으로 분리 (detach)
  onReorderPane,      // (tabId, fromPaneId, toPaneId) → 분할 pane 순서 변경 (subTabs 컨텍스트 메뉴)
  onPaneCwdChange,    // (paneId, workspaceRel, isLocal) → 부모로 cwd 변화 보고 (자동 탭명 등)
  onPaneThemeChange,  // (paneId, themeId|null) → pane 별 테마 오버라이드 설정/해제
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
  language = 'en',
  t,
  viewportHeight,
  onRenamePane,
}) => {
  const panes = tab?.panes || [];
  if (panes.length === 0) return null;

  const layout = tab.layout || 'single';
  // sub-tabs 모드: 모바일은 자동, 데스크탑은 사용자가 viewMode='tabs' 토글로 명시.
  // panes.length > 1 일 때만 의미 있음 (단일 pane 은 grid/tabs 차이 없음).
  const useSubTabs = panes.length > 1 && (isMobile || tab.viewMode === 'tabs');

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
          onSelect={(paneId) => onFocusPane?.(tab.id, paneId)}
          onClose={(paneId) => onClosePane?.(tab.id, paneId)}
          onReorder={onReorderPane ? (fromId, toId) => onReorderPane(tab.id, fromId, toId) : null}
          onRenamePane={onRenamePane ? (paneId) => onRenamePane(tab.id, paneId) : null}
          isMobile={isMobile}
          t={t}
        />
        {/* display:grid; gridTemplateRows:1fr → 단일 자식(Pane) 이 부모 높이를 100% 채움.
            grid item 의 기본 align/justify=stretch 라 명시적 height 없이도 늘어남.
            (단순 position:relative 컨테이너 면 자식 Pane 이 explicit 높이를 못 받아
             xterm 의 intrinsic 24행 크기로 고정되며 모바일 화면의 ~2/3 만 채움.) */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'grid', gridTemplateRows: '1fr' }}>
          <Pane
            key={activePane.id}
            pane={activePane}
            tab={tab}
            hosts={hosts}
            isMobile={isMobile}
            isFocused={true}
            isMultiple={false}    /* 모바일에선 X 버튼 안 띄움 (서브탭에서 처리) */
            onFocus={() => onFocusPane?.(tab.id, activePane.id)}
            onClose={() => onClosePane?.(tab.id, activePane.id)}
            onActivate={(target) => onActivatePane?.(tab.id, activePane.id, target)}
            isActive={isActive}
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
            language={language}
            t={t}
            viewportHeight={viewportHeight}
            /* 빈 pane 은 추출 의미 없어 disabled. panes.length > 1 일 때만 의미 있음. */
            onExtractPane={
              panes.length > 1 && onExtractPaneToTab && (activePane.sessionId || activePane.hostId)
                ? () => onExtractPaneToTab(tab.id, activePane.id)
                : null
            }
          />
        </div>
      </div>
    );
  }

  const gridStyle = {
    display: 'grid',
    width: '100%',
    height: '100%',
    // gap 제거 — 기존 2px 회색 띠가 pane border 와 어긋나서 "안쪽" 느낌 만들었음.
    // 이제 pane 자체 border 가 분할선 역할 (포커스 시 accent, 평소엔 subtle gray).
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
          tab={tab}
          hosts={hosts}
          isMobile={isMobile}
          isFocused={pane.id === tab.activePaneId}
          isMultiple={panes.length > 1}
          onFocus={() => onFocusPane?.(tab.id, pane.id)}
          onClose={() => onClosePane?.(tab.id, pane.id)}
          onActivate={(target) => onActivatePane?.(tab.id, pane.id, target)}
          isActive={isActive}
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
          language={language}
          t={t}
          viewportHeight={viewportHeight}
          /* 분할 → 단독 탭 추출. 단일 pane / 빈 pane 은 비활성. */
          onExtractPane={
            panes.length > 1 && onExtractPaneToTab && (pane.sessionId || pane.hostId)
              ? () => onExtractPaneToTab(tab.id, pane.id)
              : null
          }
        />
      ))}
    </div>
  );
};

const Pane = ({
  pane, paneIndex = 0, tab, hosts, allTabs = [], isMobile = false, isFocused, isMultiple, onFocus, onClose, onActivate,
  isActive, layoutSignal, settings, updateSettings, onPaneThemeChange, cwd,
  onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onPaneCwdChange, onScreenDump,
  onConfirm, onNotify, onResumeHostSession, onTerminateHostSession, busyTabIds, busyPaneIds,
  onPickHostPath = null, onPickLocalPath = null, onEditHost = null, onEditLocal = null, refreshHosts = null,
  language, t, viewportHeight,
  onExtractPane = null,
}) => {
  /* per-pane 테마 오버라이드 — pane.themeOverride 가 있으면 그 테마 id 로 settings.theme 만 바꿔
     Terminal/RightPanel 에 내려보냄. 전역 settings.theme 자체는 안 건드리므로 다른 pane / 앱 UI
     (TabBar, RightPanel chrome, scrollbar 등) 는 그대로 유지. */
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

  // 팬 컨테이너에 팬별 CSS 변수 스코프 적용 — RightPanel 등 팬 내부 UI 가 이 변수를 씀.
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
  const isEmpty = !pane.sessionId && !pane.hostId;
  const isLocal = !!pane.sessionId && !pane.hostId;
  const isPaneBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;

  // pane 마다 자기 cwd 추적
  const { workspaceRelative: paneCwdRel } = useActiveTerminalCwd({
    sessionId: isLocal ? pane.sessionId : null,
    isLocal,
  });
  const paneGitContext = paneCwdRel ?? '';

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
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        background: themes[effectiveThemeId]?.background || color.base,
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
        // 보더/강조 모두 제거 — pane 끼리 딱 붙어서 한 화면처럼 보이도록.
        border: 'none',
        zIndex: isFocused ? 2 : hover ? 1 : 0,
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
      {/* 본문 영역 — RightPanel 활동바 30px 만큼 우측 마진 (rail 영역 침범 안 함, 데스크탑/모바일 동일). */}
      <div style={{
        flex: 1,
        position: 'relative',
        minWidth: 0,
        overflow: 'hidden',
        marginRight: '30px',
      }}>
        {isPaneBusy && (
          <span
            className="iterm-pane-busy-dot"
            aria-hidden
            title={t?.('terminalBusy') || 'Terminal is active'}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--ui-accent, #89b4fa)',
              boxShadow: '0 0 0 2px var(--ui-base, rgba(0,0,0,.55)), 0 0 14px var(--ui-accent, #89b4fa)',
              // 사이드바 wrapper(zIndex 6) 보다 낮게 — 사이드바가 도트 위로 깔리도록.
              zIndex: 4,
              pointerEvents: 'none',
              animation: 'iterm-pane-busy-dot 1.15s ease-in-out infinite',
            }}
          />
        )}
        {isEmpty ? (
          <EmptyPane
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
              /* preflight/폴링 용 effective tmux 세션명 — backend host_manager.effective_tmux_session 동기.
                 host 모드에서만 의미. resume 면 그 이름 그대로, 아니면 base+suffix+pane idx. */
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
              isActive={isActive && isFocused}
              layoutSignal={`${layoutSignal}:${pane.id}`}
              /* takeover 시: refreshNonce++ 로 Terminal 통째 remount → 새 WS → tmux attach -d
                 → 저쪽 클라이언트가 같은 [detached ...] 토큰을 받아 우리와 같은 오버레이로 전환. */
              onTakeOver={() => setRefreshNonce((n) => n + 1)}
            />
          </Suspense>
        )}
      </div>

      {/* RightPanel — 항상 노출. zIndex 가 pane X(5) 보다 높아야 패널 열렸을 때
          pane X 가 패널을 뚫고 올라와 미스클릭 유발하는 걸 막음. */}
      <div
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0,
          zIndex: 6,
        }}
      >
        <RightPanel
          isFocused={isFocused}
          showFocusEye={isMultiple && !isMobile}
          activeTabType={pane.hostId ? 'host' : 'local'}
          activeHostId={pane.hostId || null}
          gitContextPath={paneGitContext}
          /* Info 패널 컨텍스트 — 세션/탭/호스트 메타데이터를 한 객체로 묶어 전달.
             RightPanel 이 파편적으로 props 받지 않게 정리. */
          paneInfo={{
            tabName: tab?.name || '',
            tabType: pane.hostId ? 'host' : 'local',
            sessionId: pane.sessionId || pane.id,
            paneId: pane.id,
            paneIndex,
            paneCount: tab?.panes?.length || 1,
            tmuxSessionName: pane.tmuxSessionName || null,
            tmuxSuffix: tab?.tmuxSuffix || null,
            /* 영속 여부 — local 은 항상 true, host 는 use_remote_tmux 따름.
               Resume 으로 attach 한 탭(`pane.tmuxSessionName`) 은 명시적으로 영속. */
            isPersistent: pane.hostId
              ? !!(hosts.find((h) => h.id === pane.hostId)?.use_remote_tmux) || !!pane.tmuxSessionName
              : true,
            host: pane.hostId ? (hosts.find((h) => h.id === pane.hostId) || null) : null,
            cwd: cwd || null,
            paneCwdRel: paneCwdRel || null,
            /* takeover 모델 알림용 — PC ↔ 모바일 동시 attach 안 되는 정책을 Info 패널에서도 안내. */
            takeoverPolicy: 'last-attach-wins',
          }}
          onFileSelect={(path) => onFileSelect?.(path, pane.hostId || null)}
          onFolderSelect={onFolderSelect}
          onOpenTerminalAtFolder={(path) => onOpenTerminalAtFolder?.(path, pane.hostId || null)}
          onRefreshTerminal={isEmpty ? null : () => setRefreshNonce((n) => n + 1)}
          /* pane 닫기 — 항상 노출. closePane 이 케이스별 분기:
             - 단일 pane (빈 picker 든 활성 세션이든) = closeTab 으로 위임 → 탭 닫힘
             - 다중 pane = 해당 pane 만 제거 */
          onCloseTerminal={onClose}
          settings={settings}
          updateSettings={updateSettings}
          paneThemeId={effectiveThemeId}
          onPaneThemeChange={handlePaneThemeChange}
          language={language}
          t={t}
          viewportHeight={viewportHeight}
          disabled={isEmpty}
          /* Terminal.jsx 가 등록한 sessionId 와 동일한 키 — local 은 sessionId, host 는 pane.id */
          terminalKey={pane.sessionId || pane.id}
          /* FileTree 시작 경로 — host 면 절대경로, local 이면 워크스페이스 상대경로.
             탭별로 트리 루트를 좁혀서 다른 프로젝트가 섞여 보이지 않게 함. */
          paneCwd={cwd || null}
          onScreenDump={onScreenDump}
          /* 분할 pane → 새 단독 탭으로 detach. null 이면 버튼 안 띄움. */
          onExtractPane={onExtractPane}
        />
      </div>

      {/* 활성 pane 테두리 — isMultiple 이면 accent 실선으로 대체 (위 outline 스타일이 이미 그 역할) */}
    </div>
  );
};

// 분할 서브탭 — pane 들 가로로 나열. 활성 pane 강조 + 머신 아이콘 + busy dot.
// 모바일/데스크탑 모두 touch-drag reorder (꾹 → 드래그) 가능. X 닫기 버튼은 RightPanel 에 있어 생략.
const PaneCtxMenu = forwardRef(({ ctx, pane, hosts, settings, tabBarAccent, t, onRename, onClose, onDismiss,
  canMoveLeft = false, canMoveRight = false, onMoveLeft = null, onMoveRight = null }, ref) => {
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
      background: color.surface0, border: `1px solid ${color.borderStrong}`,
      borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      padding: '3px', zIndex: 200000, minWidth: '160px',
      fontFamily: font.sans, opacity: measured ? 1 : 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderBottom: `1px solid ${color.border}`, marginBottom: '2px' }}>
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
          <button onClick={onMoveLeft} disabled={!canMoveLeft} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: canMoveLeft ? 'pointer' : 'default',
            color: canMoveLeft ? color.text : color.surface2, fontSize: fontSize['11'], fontFamily: font.sans, opacity: canMoveLeft ? 1 : 0.4,
          }}>
            <ChevronLeft size={12} strokeWidth={1.8} />
            {t?.('moveLeft') || 'Move left'}
          </button>
          <button onClick={onMoveRight} disabled={!canMoveRight} style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
            background: 'transparent', border: 'none', borderRadius: '4px', cursor: canMoveRight ? 'pointer' : 'default',
            color: canMoveRight ? color.text : color.surface2, fontSize: fontSize['11'], fontFamily: font.sans, opacity: canMoveRight ? 1 : 0.4,
          }}>
            <ChevronRight size={12} strokeWidth={1.8} />
            {t?.('moveRight') || 'Move right'}
          </button>
        </>
      )}
      {!isEmpty && onRename && (
        <button onClick={onRename} style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
          background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer',
          color: color.text, fontSize: fontSize['11'], fontFamily: font.sans,
        }}>
          <Edit3 size={12} strokeWidth={1.8} />
          {t?.('rename') || 'Rename'}
        </button>
      )}
      {!isEmpty && (
        <button onClick={onClose} style={{
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
  settings = {}, tabColorIndex, onSelect, onClose, onReorder = null, onRenamePane = null, t,
}) => {
  const scrollRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxRef = useRef(null);
  const ctxCloseRef = useRef(() => setCtxMenu(null));
  ctxCloseRef.current = () => setCtxMenu(null);
  const touchReorder = useTouchDragReorder({
    dataAttr: 'data-pane-id',
    scrollContainerRef: scrollRef,
    onReorder,
  });

  const tabBarAccent = tabColorIndex != null
    ? (color.dotPalette || ['#89b4fa'])[tabColorIndex % (color.dotPalette || ['#89b4fa']).length]
    : color.accent;

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
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', handleKey); };
  }, [!!ctxMenu]);

  return (
    <>
      <style>{`
        .iterm-subtabbar-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .iterm-subtabbar-scroll::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      `}</style>
      <div
        ref={scrollRef}
        className="iterm-subtabbar-scroll"
        style={{
          display: 'flex',
          height: '32px',
          background: `${tabBarAccent}18`,
          borderBottom: `1px solid ${color.border}`,
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
          padding: '0 4px',
        }}
      >
        {panes.map((pane, idx) => {
          const isActive = pane.id === activePaneId;
          const isEmpty = !pane.sessionId && !pane.hostId;
          const isLocal = !!pane.sessionId && !pane.hostId;
          const isBusy = !!busyPaneIds && busyPaneIds.has(pane.id) && !isEmpty;
          const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
          const label = pane.manualName ? pane.name
            : (pane.name || host?.name
              || (isLocal ? ((settings.localName || '').trim() || (t?.('thisMachine') || 'Local')) : (t?.('startSession') || 'Empty')));
          // 머신 아이콘 — host.icon 또는 settings.localIcon. fallback 은 Server/Monitor/Plus.
          const iconValue = host?.icon || (isLocal ? (settings.localIcon || '') : '');
          const FallbackIcon = host ? Server : (isLocal ? Monitor : Plus);
          const isDragging = touchReorder.draggingId === pane.id;
          const isDragOver = touchReorder.dragOverId === pane.id && touchReorder.draggingId && touchReorder.draggingId !== pane.id;
          const touchProps = onReorder ? touchReorder.getItemProps(pane.id) : null;
          return (
            <div
              key={pane.id}
              {...(touchProps || {})}
              onClick={() => onSelect(pane.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 10px',
                margin: isActive ? '3px 2px' : undefined,
                height: isActive ? undefined : '100%',
                background: isActive ? color.surface1 : 'transparent',
                border: isDragOver ? `2px solid ${color.accent}` : (isActive ? `1px solid ${color.border}` : 'none'),
                borderRadius: isActive ? '6px' : undefined,
                color: isActive ? color.text : color.subtext,
                fontSize: fontSize['11'],
                fontWeight: fontWeight.medium,
                cursor: 'pointer',
                flexShrink: 0,
                minWidth: 0,
                maxWidth: '160px',
                fontFamily: font.sans,
                opacity: isDragging ? 0.4 : (isActive ? 1 : 0.55),
                transition: 'background 0.15s, border-radius 0.15s, opacity 0.15s',
              }}
            >
              {idx + 1 <= 9 && (
                <span
                  aria-hidden
                  style={{
                    fontFamily: font.mono,
                    fontSize: '10px',
                    fontWeight: 600,
                    color: isActive ? color.subtext : color.muted,
                    opacity: isActive ? 0.95 : 0.75,
                    flexShrink: 0,
                    lineHeight: 1,
                    width: '10px',
                    textAlign: 'center',
                  }}
                >
                  {idx + 1}
                </span>
              )}
              <span style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                flexShrink: 0,
                color: isActive ? color.text : tabBarAccent,
              }}>
                <HostIcon value={iconValue} fallback={FallbackIcon} size={14} strokeWidth={1.8} />
                {isBusy && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '-2px',
                      right: '-2px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: tabBarAccent,
                      boxShadow: `0 0 0 1px ${color.crust}`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {label}
              </span>
              <button
                data-pane-more="true"
                onClick={(e) => { e.stopPropagation(); setCtxMenu(ctxMenu?.paneId === pane.id ? null : { paneId: pane.id, x: e.clientX, y: e.clientY }); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '18px', height: '18px', flexShrink: 0,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: isActive ? color.subtext : color.surface2,
                  borderRadius: '3px', padding: 0,
                }}
              >
                <MoreHorizontal size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {ctxMenu && createPortal(
          <PaneCtxMenu
            ctx={ctxMenu}
            ref={ctxRef}
            pane={panes.find((p) => p.id === ctxMenu.paneId)}
            hosts={hosts}
            settings={settings}
            tabBarAccent={tabBarAccent}
            t={t}
            onRename={onRenamePane ? () => {
              const pane = panes.find((p) => p.id === ctxMenu.paneId);
              if (pane) onRenamePane(pane.id);
              setCtxMenu(null);
            } : null}
            canMoveLeft={panes.findIndex((p) => p.id === ctxMenu.paneId) > 0}
            canMoveRight={panes.findIndex((p) => p.id === ctxMenu.paneId) < panes.length - 1}
            onMoveLeft={onReorder && panes.findIndex((p) => p.id === ctxMenu.paneId) > 0 ? () => {
              const idx = panes.findIndex((p) => p.id === ctxMenu.paneId);
              onReorder(panes[idx].id, panes[idx - 1].id);
              setCtxMenu(null);
            } : null}
            onMoveRight={onReorder && panes.findIndex((p) => p.id === ctxMenu.paneId) < panes.length - 1 ? () => {
              const idx = panes.findIndex((p) => p.id === ctxMenu.paneId);
              onReorder(panes[idx].id, panes[idx + 1].id);
              setCtxMenu(null);
            } : null}
            onClose={() => { onClose(ctxMenu.paneId); setCtxMenu(null); }}
            onDismiss={() => setCtxMenu(null)}
          />,
          document.body,
        )}
      </div>
    </>
  );
};

// 빈 pane = 메인 홈 대시보드 그대로 재사용. 호스트 카드 클릭 시 onActivate 호출.
// onPickHostPath(host) → 폴더 픽커 띄워 cwd 선택 후 활성화 (홈과 동일).
// onEditHost(host) → 호스트 설정 모달 열기 (홈과 동일).
const EmptyPane = ({
  onActivate, hosts = [], tab, allTabs = [], settings = {}, t,
  onConfirm, onNotify, onResumeHostSession, onTerminateHostSession, busyTabIds,
  onPickHostPath = null, onPickLocalPath = null, onEditHost = null, onEditLocal = null, refreshHosts = null,
}) => {
  const [hoverId, setHoverId] = useState(null);
  // 서버 sort_index = SSoT. HomeDashboard / HostManager 와 동일한 hook → 한 곳에서 옮기면 다 동기.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);
  // 현재 탭 자신은 후보에서 제외 — 다른 열린 탭의 활성 pane 을 미러.
  // index 는 상단 탭바와 동일한 1-base 순번 (Ctrl+N 단축키와 짝).
  const otherTabs = (allTabs || [])
    .map((tt, idx) => ({ tab: tt, index: idx + 1 }))
    .filter(({ tab: tt }) =>
      tt && tt.id && tt.id !== tab?.id && (tt.panes || []).some((p) => p.sessionId || p.hostId),
    );

  /* 로컬 카드 메타 — 홈 대시보드 동일 출처(settings.localXxx). */
  const localAccent = color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length];
  const localName = (settings.localName || '').trim() || (t?.('thisMachine') || 'This machine');
  const localSubtitle = settings.localStartPath
    ? `localhost · /${settings.localStartPath}`
    : 'localhost';

  return (
    <div onClick={(e) => e.stopPropagation()} style={emptyStyles.root}>
      {/* 1) 기본 연결 — 로컬 + 저장된 호스트. 가장 자주 쓰는 액션. */}
      <Section icon={Plug} title={t?.('connections') || 'Connections'}>
        <div style={emptyStyles.grid}>
            <HostRow
              id="local"
              draggable={false}
              icon={<HostIcon value={settings.localIcon || ''} fallback={Monitor} size={20} />}
              name={localName}
              subtitle={
                <>
                  <span style={SUB_LINE} title="localhost">localhost</span>
                  <span
                    style={{ ...SUB_LINE, color: color.faint }}
                    title={(settings.localStartPath || '').trim() || (t?.('noStartPath') || 'No start path')}
                  >
                    {(settings.localStartPath || '').trim() || (t?.('noStartPath') || 'No start path')}
                  </span>
                </>
              }
              accentColor={localAccent}
              isHovered={hoverId === 'local'}
              onHover={setHoverId}
              onClick={() => onActivate?.({ type: 'local' })}
              onPickPath={onPickLocalPath || null}
              pickPathTitle={t?.('pickStartPath') || 'Pick start path'}
              onEdit={onEditLocal || null}
              editTitle={t?.('localSettings') || 'Local settings'}
            />
          {orderedHosts.map((h) => {
            const accent = color.dotPalette[(h.color_index ?? 0) % color.dotPalette.length];
            return (
              <HostRow
                key={h.id}
                id={h.id}
                {...rowPropsFor(h)}
                icon={<HostIcon value={h.icon || ''} fallback={Server} size={20} />}
                name={h.name}
                subtitle={
                  <>
                    <span style={SUB_LINE} title={`${h.ssh_user || ''}@${h.hostname || ''}`}>{h.ssh_user || ''}@{h.hostname || ''}</span>
                    {/* 경로 라인은 참고용 — 항상 faint 로 호스트 이름과 시각 위계 차이 둠. */}
                    <span
                      style={{ ...SUB_LINE, color: color.faint }}
                      title={h.start_path || (t?.('noStartPath') || 'No start path')}
                    >
                      {h.start_path || (t?.('noStartPath') || 'No start path')}
                    </span>
                  </>
                }
                accentColor={accent}
                isHovered={hoverId === h.id}
                onHover={setHoverId}
                onClick={() => onActivate?.({ type: 'host', hostId: h.id })}
                onPickPath={onPickHostPath ? () => onPickHostPath(h) : null}
                pickPathTitle={t?.('pickStartPath') || 'Pick start path'}
                onEdit={onEditHost ? () => onEditHost(h) : null}
                editTitle={t?.('hostSettings') || 'Host settings'}
              />
            );
          })}
        </div>
      </Section>

      {/* 2) 열린 탭 미러 — 다른 탭을 이 자리로 흡수. (이어할 수 있는 세션 위로 스왑됨) */}
      {otherTabs.length > 0 && (
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
      )}

      {/* 3) 이어할 수 있는 세션 — 원격 호스트의 살아있는 tmux 세션 (현재 탭 컴패니언 제외). */}
      {hosts.some((h) => h.use_remote_tmux) && (
        <Section icon={History} title={t?.('resumableSessions') || 'Resumable'}>
          <HomeSessions
            tabs={allTabs}
            hosts={hosts}
            busyTabIds={busyTabIds}
            hideOpen
            hideHeader
            onJumpTab={() => {}}
            onResumeHostSession={(host, sessionName) => {
              onResumeHostSession?.(host, sessionName);
              // 새 탭이 열림 — 이 빈 pane 은 그대로 유지 (사용자가 다시 선택 가능).
            }}
            onTerminateHostSession={onTerminateHostSession}
            onConfirm={onConfirm}
            onNotify={onNotify}
            t={t}
          />
        </Section>
      )}
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
    padding: `0 20px 16px`,
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
  numberBadgeOverlay: {
    position: 'absolute',
    top: '-5px',
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
    background: color.accent,
    borderRadius: '3px',
    lineHeight: 1,
    pointerEvents: 'none',
  },
};

export default PaneGrid;
