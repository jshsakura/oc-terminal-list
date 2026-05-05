import { Suspense, lazy, useState, useEffect } from 'react';
import { X, Plus, Server, Terminal as TerminalIcon } from 'lucide-react';
import { tokens } from '../styles/tokens';
import RightPanel from './RightPanel';
import HomeDashboard from './HomeDashboard';
import useActiveTerminalCwd from '../hooks/useActiveTerminalCwd';

const Terminal = lazy(() => import('./Terminal'));

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * 탭 내부의 1–4 pane. 각 pane = (Terminal/Empty) + 자체 RightPanel.
 * RightPanel 패널은 absolute overlay 라 터미널 폭을 안 밀어냄.
 */
const PaneGrid = ({
  tab,
  hosts = [],
  isActive = true,
  isMobile = false,
  onFocusPane,
  onClosePane,
  onActivatePane,
  onPaneCwdChange,    // (paneId, workspaceRel, isLocal) → 부모로 cwd 변화 보고 (자동 탭명 등)
  layoutSignal,
  settings,
  updateSettings,
  cwd,
  onFileSelect,
  onFolderSelect,
  onOpenTerminalAtFolder,
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
            cwd={cwd}
            onFileSelect={onFileSelect}
            onFolderSelect={onFolderSelect}
            onOpenTerminalAtFolder={onOpenTerminalAtFolder}
            onPaneCwdChange={onPaneCwdChange}
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
          cwd={cwd}
          onFileSelect={onFileSelect}
          onFolderSelect={onFolderSelect}
          onOpenTerminalAtFolder={onOpenTerminalAtFolder}
          onPaneCwdChange={onPaneCwdChange}
          language={language}
          t={t}
          viewportHeight={viewportHeight}
        />
      ))}
    </div>
  );
};

const Pane = ({
  pane, paneIndex = 0, tab, hosts, isFocused, isMultiple, onFocus, onClose, onActivate,
  isActive, layoutSignal, settings, updateSettings, cwd,
  onFileSelect, onFolderSelect, onOpenTerminalAtFolder, onPaneCwdChange,
  language, t, viewportHeight,
}) => {
  const [hover, setHover] = useState(false);
  // RightPanel 의 재접속 버튼이 누를 때마다 ++ → Terminal key 가 바뀌어 통째로 remount.
  const [refreshNonce, setRefreshNonce] = useState(0);
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
      // capture phase 로 받아서 xterm.js 가 mouse 이벤트 소비 전에 pane focus 를 보장
      onPointerDownCapture={() => { onFocus?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        background: color.base,
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* 본문 영역 — RightPanel 활동바 폭(36px)만큼 우측 패딩 */}
      <div style={{
        flex: 1,
        position: 'relative',
        minWidth: 0,
        overflow: 'hidden',
        marginRight: '36px',
      }}>
        {/* pane X — 활성 pane 은 항상, 빈 pane 은 멀티팬일 때만 (단일 빈 pane = 탭 자체 picker 라 X 의미 없음) */}
        {(!isEmpty || isMultiple) && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title={t?.('closeTerminal') || 'Close terminal'}
            style={{
              position: 'absolute',
              top: '6px', right: '6px',
              zIndex: 5,
              width: '22px', height: '22px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: color.surface1,
              border: `1px solid ${color.border}`,
              borderRadius: '5px',
              color: color.subtext,
              cursor: 'pointer',
              padding: 0,
              opacity: hover || isFocused ? 1 : 0.45,
              transition: 'background 150ms, color 150ms, opacity 150ms, border-color 150ms',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = color.danger;
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.borderColor = color.danger;
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = color.surface1;
              e.currentTarget.style.color = color.subtext;
              e.currentTarget.style.borderColor = color.border;
              e.currentTarget.style.opacity = (hover || isFocused) ? '1' : '0.45';
            }}
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        )}

        {isEmpty ? (
          <EmptyPane onActivate={onActivate} hosts={hosts} t={t} />
        ) : (
          <Suspense fallback={null}>
            <Terminal
              key={`${pane.id}:${refreshNonce}`}
              sessionId={pane.sessionId || pane.id}
              hostId={pane.hostId || undefined}
              paneIndex={paneIndex}
              paneId={pane.id}
              tabId={tab?.id}
              cwd={cwd}
              settings={settings}
              isActive={isActive && isFocused}
              layoutSignal={`${layoutSignal}:${pane.id}`}
            />
          </Suspense>
        )}
      </div>

      {/* RightPanel — 항상 노출 */}
      <div
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0,
          zIndex: 4,
        }}
      >
        <RightPanel
          activeTabType={pane.hostId ? 'host' : 'local'}
          activeHostId={pane.hostId || null}
          gitContextPath={paneGitContext}
          onFileSelect={onFileSelect}
          onFolderSelect={onFolderSelect}
          onOpenTerminalAtFolder={onOpenTerminalAtFolder}
          onRefreshTerminal={isEmpty ? null : () => setRefreshNonce((n) => n + 1)}
          settings={settings}
          updateSettings={updateSettings}
          language={language}
          t={t}
          viewportHeight={viewportHeight}
          disabled={isEmpty}
        />
      </div>

      {/* 활성 pane 테두리 — 모든 absolute 레이어 위 (pointer-events 무시) */}
      {isFocused && isMultiple && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: `inset 0 0 0 2px ${color.accent}`,
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
const EmptyPane = ({ onActivate, hosts = [], t }) => (
  <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%', overflow: 'auto' }}>
    <HomeDashboard
      hosts={hosts}
      t={t}
      onOpenHost={(host) => {
        if (host?.isLocal || host?.id === 'local') onActivate?.({ type: 'local' });
        else onActivate?.({ type: 'host', hostId: host.id });
      }}
      onAddHost={() => {}}      // pane 안에서는 추가 안 받음 (홈에서)
      onEditHost={() => {}}
    />
  </div>
);

export default PaneGrid;
