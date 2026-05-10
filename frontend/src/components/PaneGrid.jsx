import { Suspense, lazy, useState, useEffect, useRef } from 'react';
import {
  X, Plus, Server, Terminal as TerminalIcon, Monitor, Copy, Plug, Anchor,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import themes from '../styles/themes';
import { buildThemeUI } from '../styles/themeUI';
import RightPanel from './RightPanel';
import { HostRow } from './HomeDashboard';
import HomeSessions from './HomeSessions';
import HostIcon from '../utils/hostIcons';
import useActiveTerminalCwd from '../hooks/useActiveTerminalCwd';

const Terminal = lazy(() => import('./Terminal'));

const { color, font, fontSize, fontWeight, radius, space } = tokens;

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
  language = 'en',
  t,
  viewportHeight,
}) => {
  const panes = tab?.panes || [];
  if (panes.length === 0) return null;

  const layout = tab.layout || 'single';
  const useSubTabs = isMobile && panes.length > 1;

  // 모바일 분할: 서브탭 바 + 활성 pane 만 fullscreen
  if (useSubTabs) {
    const activePane = panes.find((p) => p.id === tab.activePaneId) || panes[0];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <SubTabBar
          panes={panes}
          activePaneId={activePane.id}
          hosts={hosts}
          onSelect={(paneId) => onFocusPane?.(tab.id, paneId)}
          onClose={(paneId) => onClosePane?.(tab.id, paneId)}
          t={t}
        />
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <Pane
            key={activePane.id}
            pane={activePane}
            tab={tab}
            hosts={hosts}
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
            language={language}
            t={t}
            viewportHeight={viewportHeight}
          />
        </div>
      </div>
    );
  }

  const gridStyle = {
    display: 'grid',
    width: '100%',
    height: '100%',
    gap: '2px',
    background: color.border,
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
          language={language}
          t={t}
          viewportHeight={viewportHeight}
        />
      ))}
    </div>
  );
};

const Pane = ({
  pane, paneIndex = 0, tab, hosts, allTabs = [], isFocused, isMultiple, onFocus, onClose, onActivate,
  isActive, layoutSignal, settings, updateSettings, onPaneThemeChange, cwd,
  onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onPaneCwdChange, onScreenDump,
  onConfirm, onNotify, onResumeHostSession, onTerminateHostSession, busyTabIds,
  language, t, viewportHeight,
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
      ref={paneRef}
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
      }}
    >
      {/* 본문 영역 — RightPanel 활동바 폭(36px)만큼 우측 마진 (rail 영역 침범 안 함). */}
      <div style={{
        flex: 1,
        position: 'relative',
        minWidth: 0,
        overflow: 'hidden',
        marginRight: '36px',
      }}>
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
          />
        ) : (
          <Suspense fallback={null}>
            <Terminal
              key={`${pane.id}:${refreshNonce}`}
              sessionId={pane.sessionId || pane.id}
              hostId={pane.hostId || undefined}
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
              cwd={cwd}
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
        />
      </div>

      {/* 활성 pane 테두리 — 모든 absolute 레이어 위 (pointer-events 무시) */}
      {isFocused && isMultiple && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            outline: `2px dashed ${color.text}`,
            outlineOffset: '-2px',
            opacity: 0.4,
            zIndex: 20,
          }}
        />
      )}
    </div>
  );
};

// 모바일 서브탭 — pane 들 가로로 나열. 활성 pane 강조 + X 닫기
const SubTabBar = ({ panes, activePaneId, hosts, onSelect, onClose, t }) => (
  <div style={{
    display: 'flex',
    height: '32px',
    background: color.crust,
    borderBottom: `1px solid ${color.border}`,
    overflowX: 'auto',
    flexShrink: 0,
  }}>
    {panes.map((pane, idx) => {
      const isActive = pane.id === activePaneId;
      const isEmpty = !pane.sessionId && !pane.hostId;
      const host = pane.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
      const label = host?.name || (pane.sessionId ? (t?.('thisMachine') || 'Local') : (t?.('startSession') || 'Empty'));
      const Icon = pane.hostId ? Server : TerminalIcon;
      return (
        <div
          key={pane.id}
          onClick={() => onSelect(pane.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 10px',
            background: isActive ? color.base : color.surface0,
            borderRight: `1px solid ${color.border}`,
            color: isActive ? color.text : color.subtext,
            fontSize: fontSize['11'],
            fontWeight: fontWeight.medium,
            cursor: 'pointer',
            flexShrink: 0,
            minWidth: 0,
            maxWidth: '160px',
            fontFamily: font.sans,
          }}
        >
          {isEmpty ? <Plus size={11} strokeWidth={2} /> : <Icon size={11} strokeWidth={1.8} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {idx + 1}. {label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(pane.id); }}
            title={t?.('closePane') || 'Close pane'}
            style={{
              width: '16px', height: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: 'none', borderRadius: '3px',
              cursor: 'pointer',
              color: color.muted,
              padding: 0,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.danger; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.muted; }}
          >
            <X size={10} strokeWidth={2.4} />
          </button>
        </div>
      );
    })}
  </div>
);

// 빈 pane = 메인 홈 대시보드 그대로 재사용. 호스트 카드 클릭 시 onActivate 호출.
const EmptyPane = ({
  onActivate, hosts = [], tab, allTabs = [], settings = {}, t,
  onConfirm, onNotify, onResumeHostSession, onTerminateHostSession, busyTabIds,
}) => {
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
            subtitle={localSubtitle}
            accentColor={localAccent}
            onClick={() => onActivate?.({ type: 'local' })}
          />
          {hosts.map((h) => {
            const accent = color.dotPalette[(h.color_index ?? 0) % color.dotPalette.length];
            return (
              <HostRow
                key={h.id}
                id={h.id}
                draggable={false}
                icon={<HostIcon value={h.icon || ''} fallback={Server} size={20} />}
                name={h.name}
                subtitle={`${h.ssh_user || ''}@${h.hostname || ''}`}
                accentColor={accent}
                onClick={() => onActivate?.({ type: 'host', hostId: h.id })}
              />
            );
          })}
        </div>
      </Section>

      {/* 2) 열린 탭 미러 — 다른 탭을 이 자리로 흡수. (이어할 수 있는 세션 위로 스왑됨) */}
      {otherTabs.length > 0 && (
        <Section icon={Copy} title={t?.('mirrorOpenTab') || 'Open tabs'}>
          <OpenTabPicker
            tabs={otherTabs}
            hosts={hosts}
            t={t}
            onPick={(tabId) => onActivate?.({ type: 'tab', sourceTabId: tabId })}
            embedded
          />
        </Section>
      )}

      {/* 3) 이어할 수 있는 세션 — 원격 호스트의 살아있는 tmux 세션 (현재 탭 컴패니언 제외). */}
      {hosts.some((h) => h.use_remote_tmux) && (
        <Section icon={Anchor} title={t?.('resumableSessions') || 'Resumable'}>
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

const OpenTabPicker = ({ tabs, hosts = [], onPick, t, embedded = false }) => {
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
            return (
              <HostRow
                key={tb.id}
                id={tb.id}
                accentColor={accent}
                leadingBadge={
                  index <= 9 ? (
                    <span
                      title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
                      style={mirrorStyles.numberBadge}
                      aria-hidden
                    >
                      {index}
                    </span>
                  ) : null
                }
                icon={
                  <HostIcon
                    value={tb.icon || (hostMeta?.icon || '')}
                    fallback={isHost ? Server : TerminalIcon}
                    size={20}
                  />
                }
                name={tb.name}
                subtitle={
                  isHost
                    ? (hostMeta ? `${hostMeta.ssh_user}@${hostMeta.hostname}` : tb.hostId)
                    : (t?.('thisMachine') || 'This machine')
                }
                isHovered={hoverId === tb.id}
                onHover={setHoverId}
                onClick={() => onPick(tb.id)}
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
  numberBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    fontSize: '11px',
    fontWeight: 700,
    color: color.subtext,
    fontFamily: font.mono,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: '4px',
    flexShrink: 0,
    lineHeight: 1,
  },
};

export default PaneGrid;
