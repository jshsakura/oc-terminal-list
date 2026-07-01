import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Terminal as TerminalIcon, Settings as SettingsIcon } from 'lucide-react';
import { tokens } from '../styles/tokens';
import RailIconBtn from './common/RailIconBtn';
import useTouchDragReorder from '../hooks/useTouchDragReorder';
import useEdgeAutoScroll from '../hooks/useEdgeAutoScroll';
import useEvent from '../hooks/useEvent';
import { styles } from './tabBar/tabBarStyles';
import { Tab } from './tabBar/TabBarTab';
import { TabContextMenu, SettingsSubMenu } from './tabBar/TabBarMenus';

const { color } = tokens;

const TabBar = ({
  tabs = [],
  activeTabId,
  busyTabIds,
  onSelect,
  onClose,
  onHome,
  onOpenHosts,
  onOpenKeys,
  onOpenSettings,
  onReloadTerminals = null,
  onEqualizePanes = null,
  onSplit,
  onDuplicate,
  onReorder,
  /* (tabId) → 해당 탭의 viewMode 토글 (grid ↔ tabs). panes.length > 1 인 탭에서만 의미. */
  onToggleViewMode,
  onCloseImmediate = null,
  canSplit = false,
  isMobile = false,
  t,
}) => {
  const [contextMenu, setContextMenu] = useState(null);  // {tabId, x, y}
  const [pendingCloseTabId, setPendingCloseTabId] = useState(null);
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const [settingsMenu, setSettingsMenu] = useState(null); // {x, y}
  const settingsBtnRef = useRef(null);
  const settingsMenuClosedAtRef = useRef(0);

  const handleSettingsClick = useCallback(() => {
    if (settingsMenu) {
      setSettingsMenu(null);
      settingsMenuClosedAtRef.current = Date.now();
      return;
    }
    if (Date.now() - settingsMenuClosedAtRef.current < 300) return;
    if (settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setSettingsMenu({ x: rect.right, y: rect.bottom + 4 });
    }
  }, [settingsMenu]);

  // 모바일 터치 드래그 — TabBar scroll 컨테이너에 ref 를 걸고 훅에 넘김 (드래그 모드 시 가로 스크롤 락).
  const tabListRef = useRef(null);
  const touchReorder = useTouchDragReorder({
    dataAttr: 'data-tab-id',
    scrollContainerRef: tabListRef,
    onReorder,
  });
  // 데스크탑 HTML5 드래그 중 컨테이너 가장자리에서 자동 가로 스크롤.
  const edgeAutoScroll = useEdgeAutoScroll({ containerRef: tabListRef });
  // 데스크탑 HTML5 드래그 상태와 통합 — 한 군데에서만 active id/over id 를 신뢰.
  const activeDraggingId = draggingTabId || touchReorder.draggingId;
  const activeDragOverId = dragOverTabId || touchReorder.dragOverId;

  const isHome = activeTabId === null;

  // 활성 탭이 스크롤 컨테이너 밖에 있으면 자동으로 보이게 — 새로고침 후 뒤쪽 탭이 활성인데
  // 화면엔 앞쪽만 보이는 모바일 케이스를 처리. nearest 옵션이라 이미 보이는 경우 스크롤 안 함.
  useEffect(() => {
    if (!activeTabId) return undefined;
    const container = tabListRef.current;
    if (!container) return undefined;
    // rAF 로 layout 확정 후 측정 — mount 직후 width 0 인 race 회피.
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
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
  }, [activeTabId, tabs.length]);

  // 모든 Tab 핸들러를 useEvent 로 안정화 — Tab 의 memo() 가 부모 state 변화마다 깨지던 문제 해결.
  // 핸들러 안에서는 항상 최신 state/props 가 보이므로 deps 신경 안 써도 됨.
  const handleSelectTab = useEvent((tabId) => {
    if (pendingCloseTabId === tabId) return;
    onSelect?.(tabId);
  });
  const handleCloseTab = useEvent((tabId) => { onClose?.(tabId); });
  const handleRequestClose = useEvent((tabId) => { setPendingCloseTabId(tabId); });
  const handleConfirmClose = useEvent((tabId) => { setPendingCloseTabId(null); onCloseImmediate?.(tabId); });
  const handleCancelClose = useEvent(() => { setPendingCloseTabId(null); });
  const handleContextMenuTab = useEvent((tabId, e) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  });
  const handleMore = useEvent((tabId, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ tabId, x: rect.left, y: rect.bottom + 4 });
  });
  const handleDragStart = useEvent((tabId, e) => {
    setDraggingTabId(tabId);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tabId);
      e.dataTransfer.setData('application/x-iterminallist-tab', JSON.stringify({ type: 'tab', tabId }));
    } catch {}
  });
  const handleDragEnd = useEvent(() => {
    setDraggingTabId(null);
    setDragOverTabId(null);
    edgeAutoScroll.stop();
  });
  const handleDragOver = useEvent((tabId, e) => {
    if (!draggingTabId || draggingTabId === tabId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    if (dragOverTabId !== tabId) setDragOverTabId(tabId);
  });
  const handleDragLeave = useEvent((tabId) => {
    if (dragOverTabId === tabId) setDragOverTabId(null);
  });
  const handleDrop = useEvent((tabId, e) => {
    e.preventDefault();
    const fromId = (() => { try { return e.dataTransfer.getData('text/plain'); } catch { return null; } })()
      || draggingTabId;
    setDraggingTabId(null);
    setDragOverTabId(null);
    edgeAutoScroll.stop();
    if (fromId && fromId !== tabId) onReorder?.(fromId, tabId);
  });
  // 컨테이너 레벨 dragover — 자식 탭 핸들러는 자기 tabId 만 신경 쓰므로,
  // 가장자리 자동 스크롤은 부모에서 clientX 만 받아 처리.
  const handleContainerDragOver = useEvent((e) => {
    if (!draggingTabId) return;
    edgeAutoScroll.update(e.clientX);
  });
  const handleContainerDragLeave = useEvent((e) => {
    // 컨테이너 밖으로 빠져나갈 때만 정지 (자식으로 넘어가는 leave 는 무시).
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related)) return;
    edgeAutoScroll.stop();
  });

  return (
    <div style={{ ...styles.bar, ...(isMobile ? styles.barMobile : null) }}>
      <style>{`
        .tabbar-list::-webkit-scrollbar { display: none; }
        /* busy 표시 — 우상단 작은 dot 만. 글로우/배경 tint/보더 변경 없음.
           dot 이 1.1s 주기로 부드럽게 깜빡이며 활동 중임을 신호. 정지 시 dot 사라짐. */
        @keyframes iterm-tab-busy-blink {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
        .iterm-tab-busy-dot { animation: iterm-tab-busy-blink 1.1s ease-in-out infinite; }
      `}</style>
      {/* brand = home button — 홈 활성 시 활성 탭과 동일하게 강조 */}
      <button
        style={{
          ...styles.brandBtn,
          ...(isMobile ? styles.brandBtnMobile : null),
          background: isHome ? 'var(--ui-surface1)' : 'transparent',
          border: `1px solid ${isHome ? color.accentBorder : 'transparent'}`,
          color: isHome ? color.accent : color.subtext,
        }}
        onClick={onHome}
        title={t?.('home') || 'Home'}
        onMouseEnter={(e) => { if (!isHome) e.currentTarget.style.background = 'var(--ui-surface0)'; }}
        onMouseLeave={(e) => { if (!isHome) e.currentTarget.style.background = 'transparent'; }}
      >
        <TerminalIcon
          size={13}
          strokeWidth={2}
          style={{
            filter: `drop-shadow(0 0 4px ${color.accent}99) drop-shadow(0 0 8px ${color.accent}44)`,
            transition: 'filter 200ms',
          }}
        />
      </button>

      <div
        ref={tabListRef}
        className="tabbar-list"
        style={{ ...styles.tabList, ...(isMobile ? styles.tabListMobile : null) }}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onWheel={(e) => {
          // 세로 휠 → 가로 스크롤로 전환 (Jupyter 처럼)
          if (e.deltaY !== 0 && e.deltaX === 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        {tabs.map((tab, idx) => (
          <Tab
            key={tab.id}
            tab={tab}
            index={idx + 1}
            isFirst={idx === 0}
            isActive={tab.id === activeTabId}
            isBusy={!!busyTabIds && busyTabIds.has(tab.id)}
            isDragging={activeDraggingId === tab.id}
            isDragOver={activeDragOverId === tab.id && activeDraggingId && activeDraggingId !== tab.id}
            touchProps={isMobile && onReorder ? touchReorder.getItemProps(tab.id) : null}
            isMobile={isMobile}
            isPendingClose={pendingCloseTabId === tab.id}
            /* 모두 useEvent 로 안정화된 dispatcher — Tab 의 memo() 가 유효해짐 */
            onSelect={handleSelectTab}
            onClose={handleCloseTab}
            onRequestClose={handleRequestClose}
            onConfirmClose={handleConfirmClose}
            onCancelClose={handleCancelClose}
            onContextMenu={handleContextMenuTab}
            onMore={handleMore}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            t={t}
          />
        ))}
      </div>

      {/* right action group — Settings menu */}
      <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, borderLeft: '1px solid var(--ui-border)' }}>
        <div ref={settingsBtnRef} style={{ width: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RailIconBtn icon={SettingsIcon} onClick={handleSettingsClick} active={!!settingsMenu} title={t?.('settings') || 'Settings'} compact />
        </div>
      </div>
      {settingsMenu && createPortal(
        <SettingsSubMenu
          anchor={settingsMenu}
          t={t}
          isMobile={isMobile}
          onClose={() => { setSettingsMenu(null); settingsMenuClosedAtRef.current = Date.now(); }}
          onSettings={() => { setSettingsMenu(null); settingsMenuClosedAtRef.current = Date.now(); onOpenSettings?.(); }}
          onReload={onReloadTerminals ? () => { setSettingsMenu(null); settingsMenuClosedAtRef.current = Date.now(); onReloadTerminals(); } : null}
          onEqualize={onEqualizePanes ? () => { setSettingsMenu(null); settingsMenuClosedAtRef.current = Date.now(); onEqualizePanes(); } : null}
        />,
        document.body
      )}
{/* context menu — 포탈로 최상단 렌더링 */}
{contextMenu && createPortal(
  (() => {
    const ctxTab = tabs.find((tt) => tt.id === contextMenu.tabId);
    const ctxPaneCount = ctxTab?.panes?.length || 1;
    const ctxViewMode = ctxTab?.viewMode || 'grid';
    const ctxIdx = tabs.findIndex((tt) => tt.id === contextMenu.tabId);
    const isCtxActive = contextMenu.tabId === activeTabId;
    return (
      <TabContextMenu
        ctx={contextMenu}
        t={t}
        viewMode={ctxViewMode}
        canToggleViewMode={false}
        canMoveLeft={ctxIdx > 0 && !!onReorder}
        canMoveRight={ctxIdx >= 0 && ctxIdx < tabs.length - 1 && !!onReorder}
        canSplit={isCtxActive && canSplit && !!onSplit}
        onSplit={onSplit ? (dir) => { onSplit(dir); setContextMenu(null); } : null}
        onClose={() => setContextMenu(null)}
        onCloseTab={() => { setPendingCloseTabId(contextMenu.tabId); setContextMenu(null); }}
        onDuplicateTab={onDuplicate ? () => { onDuplicate(contextMenu.tabId); setContextMenu(null); } : null}
        onToggleViewMode={() => { onToggleViewMode?.(contextMenu.tabId); setContextMenu(null); }}
        onMoveLeft={() => {
          if (ctxIdx > 0) onReorder?.(contextMenu.tabId, tabs[ctxIdx - 1].id);
          setContextMenu(null);
        }}
        onMoveRight={() => {
          if (ctxIdx >= 0 && ctxIdx < tabs.length - 1) onReorder?.(contextMenu.tabId, tabs[ctxIdx + 1].id);
          setContextMenu(null);
        }}
      />
    );
  })(),
  document.body
)}
    </div>
  );
};

export default TabBar;
