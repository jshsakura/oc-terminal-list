import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Terminal as TerminalIcon, Server, Monitor,
  Settings as SettingsIcon, MoreHorizontal,
  SquareSplitHorizontal, SquareSplitVertical, Grid2x2, Square,
  ChevronLeft, ChevronRight, Edit3,
  Copy, X, Check, LayoutGrid, List, RefreshCw,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import { glassMenuItemHover, glassMenuStyle } from '../styles/glass';
import HostIcon from '../utils/hostIcons';
import RailIconBtn from './common/RailIconBtn';
import useTouchDragReorder from '../hooks/useTouchDragReorder';

const { color, font, fontSize, fontWeight } = tokens;

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
  // 데스크탑 HTML5 드래그 상태와 통합 — 한 군데에서만 active id/over id 를 신뢰.
  const activeDraggingId = draggingTabId || touchReorder.draggingId;
  const activeDragOverId = dragOverTabId || touchReorder.dragOverId;

  const isHome = activeTabId === null;

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
            touchProps={null}
            isMobile={isMobile}
            isPendingClose={pendingCloseTabId === tab.id}
            onSelect={() => { if (pendingCloseTabId === tab.id) return; onSelect(tab.id); }}
            onClose={() => onClose(tab.id)}
            onRequestClose={() => setPendingCloseTabId(tab.id)}
            onConfirmClose={() => { setPendingCloseTabId(null); onCloseImmediate?.(tab.id); }}
            onCancelClose={() => setPendingCloseTabId(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
            onMore={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({ tabId: tab.id, x: rect.left, y: rect.bottom + 4 });
            }}
            onDragStart={(e) => {
              setDraggingTabId(tab.id);
              try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.setData('application/x-iterminallist-tab', JSON.stringify({ type: 'tab', tabId: tab.id }));
              } catch {}
            }}
            onDragEnd={() => { setDraggingTabId(null); setDragOverTabId(null); }}
            onDragOver={(e) => {
              if (!draggingTabId || draggingTabId === tab.id) return;
              e.preventDefault();
              try { e.dataTransfer.dropEffect = 'move'; } catch {}
              if (dragOverTabId !== tab.id) setDragOverTabId(tab.id);
            }}
            onDragLeave={() => { if (dragOverTabId === tab.id) setDragOverTabId(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const fromId = (() => { try { return e.dataTransfer.getData('text/plain'); } catch { return null; } })()
                || draggingTabId;
              setDraggingTabId(null);
              setDragOverTabId(null);
              if (fromId && fromId !== tab.id) onReorder?.(fromId, tab.id);
            }}
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

const Tab = memo(({
  tab, index, isFirst = false, isActive, isBusy = false, isDragging = false, isDragOver = false,
  isMobile = false,
  touchProps = null, // useTouchDragReorder.getItemProps(tab.id) — 모바일 드래그/터치 핸들러 일괄.
  isPendingClose = false,
  onSelect, onClose, onRequestClose, onConfirmClose, onCancelClose, onContextMenu, onMore,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  t,
}) => {
  const isHostTab = tab.type === 'host' || tab.hostId;
  const isLocalTab = tab.type === 'local';
  const Icon = isHostTab ? Server : (isLocalTab ? Monitor : TerminalIcon);
  const dotColor = tab.color_index != null
    ? color.dotPalette?.[tab.color_index % (color.dotPalette?.length || 8)] || color.accent
    : color.accent;

  return (
    <div
      // 모바일은 HTML5 draggable 대신 useTouchDragReorder 의 터치 이벤트를 spread.
      // 모바일 컨텍스트 메뉴는 우측 More 버튼으로 접근 (long-press 는 이제 드래그 진입).
      draggable={!isMobile}
      {...(touchProps || {})}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      style={{
        ...styles.tab,
        ...(isMobile ? styles.tabMobile : null),
        background: isActive ? 'var(--ui-base)' : 'var(--ui-mantle)',
        color: isActive ? color.text : color.muted,
        fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
        border: `1px solid ${isDragOver ? color.accent : (isActive ? 'var(--ui-border-strong)' : 'var(--ui-border)')}`,
        // 하단 라인은 TabBar 자체 borderBottom 하나만 쓰게 한다.
        // inactive tab 의 개별 bottom border 가 보이면 바닥선 위에 떠 보인다.
        borderBottom: isDragOver ? `1px solid ${color.accent}` : `1px solid ${isActive ? 'var(--ui-base)' : 'var(--ui-mantle)'}`,
        flex: isMobile ? styles.tabMobile.flex : styles.tab.flex,
        maxWidth: isMobile ? styles.tabMobile.maxWidth : styles.tab.maxWidth,
        marginLeft: isFirst ? 0 : styles.tab.marginLeft,
        opacity: isDragging ? 0.4 : 1,
        cursor: isMobile ? 'pointer' : 'grab',
      }}
      onClick={onSelect}
      /* 휠 클릭(가운데 버튼)으로 탭 닫기 확인 트리거 */
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          onRequestClose?.();
        }
      }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }}
      onMouseEnter={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = 'var(--ui-surface0)'; e.currentTarget.style.color = color.subtext; }
      }}
      onMouseLeave={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = 'var(--ui-mantle)'; e.currentTarget.style.color = color.muted; }
      }}
    >
      {/* Ctrl+N 번호 — 박스 없이 모노 숫자만. 알림 뱃지 느낌 없이 식별만. */}
      {index != null && index <= 9 && (
        <span
          aria-hidden
          title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
          style={{
            fontFamily: font.mono,
            fontSize: '10px',
            fontWeight: 600,
            color: isActive ? color.subtext : color.muted,
            opacity: isActive ? 0.95 : 0.75,
            flexShrink: 0,
            lineHeight: 1,
            letterSpacing: 0,
            width: '10px',
            textAlign: 'center',
          }}
        >
          {index}
        </span>
      )}

      {/* 호스트 아이콘 타일 — dot 색 tint. busy 시 타일 자체는 변화 없음, 우상단 dot 만 깜빡. */}
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          flexShrink: 0,
          background: isActive ? `${dotColor}26` : `${dotColor}12`,
          border: `1px solid ${isActive ? `${dotColor}77` : `${dotColor}33`}`,
          borderRadius: '4px',
          color: isActive ? color.text : dotColor,
          opacity: isActive ? 1 : 0.85,
        }}
      >
        <HostIcon value={tab.icon || ''} fallback={Icon} size={11} strokeWidth={1.9} />
        {isBusy && (
          <span
            className="iterm-tab-busy-dot"
            aria-hidden
            style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: dotColor,
              /* crust outline 으로 탭/이웃 탭과 분리해 어디서든 또렷이. 부드러운 opacity 박동. */
              boxShadow: `0 0 0 1.5px ${color.crust}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </span>
      {isPendingClose ? (
        /* 인라인 close 확인 — 탭 이름 자리를 차지 */
        <>
          <span style={{ flex: 1, fontSize: '10px', color: color.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1 }}>
            {t?.('closeTab') || 'Close?'}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onConfirmClose?.(); }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ ...styles.miniBtn, background: color.accent, color: color.crust, border: 'none', flexShrink: 0 }}
            title={t?.('confirm') || 'Confirm'}
          >
            <Check size={10} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancelClose?.(); }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ ...styles.miniBtn, background: 'transparent', color: color.subtext, flexShrink: 0 }}
            title={t?.('cancel') || 'Cancel'}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </>
      ) : (
        <span style={styles.tabName} title={tab.name}>{tab.name}</span>
      )}

      {/* More 버튼 — 활성 탭에서만 노출, close 확인 중에는 숨김 */}
      {isActive && !isPendingClose && (
        <button
          data-more="true"
          onClick={(e) => { e.stopPropagation(); onMore(e); }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          style={{
            ...styles.miniBtn,
            opacity: 1,
            color: color.subtext,
          }}
          onMouseEnter={(e) => { if (isMobile) return; e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
          onMouseLeave={(e) => { if (isMobile) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
          title={t?.('more') || 'More'}
        >
          <MoreHorizontal size={11} strokeWidth={2} />
        </button>
      )}

    </div>
  );
});

const TabContextMenu = ({
  ctx, t, onClose, onCloseTab, onDuplicateTab, onRenameTab = null,
  canToggleViewMode = false, viewMode = 'grid', onToggleViewMode = null,
  canMoveLeft = false, canMoveRight = false, onMoveLeft = null, onMoveRight = null,
  canSplit = false, onSplit = null,
}) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => {
      if (e.target?.closest?.('[data-more="true"]')) return;
      if (!ref.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = ctx.x;
      let nextY = ctx.y;

      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextX < margin) nextX = margin;

      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;

      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [ctx.x, ctx.y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(),
        zIndex: 200000,
        minWidth: '140px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
      }}
    >
      {(onMoveLeft || onMoveRight) && (
        <>
          <MenuItem onClick={onMoveLeft} disabled={!canMoveLeft} icon={ChevronLeft}>
            {t?.('moveLeft') || 'Move left'}
          </MenuItem>
          <MenuItem onClick={onMoveRight} disabled={!canMoveRight} icon={ChevronRight}>
            {t?.('moveRight') || 'Move right'}
          </MenuItem>
        </>
      )}
      {onRenameTab && (
        <MenuItem onClick={onRenameTab} icon={Edit3}>
          {t?.('rename') || 'Rename'}
        </MenuItem>
      )}
      {onDuplicateTab && (
        <MenuItem onClick={onDuplicateTab} icon={Copy}>
          {t?.('duplicateTab') || 'Duplicate (same path)'}
        </MenuItem>
      )}
      {canToggleViewMode && onToggleViewMode && (
        <MenuItem onClick={onToggleViewMode} icon={viewMode === 'tabs' ? LayoutGrid : List}>
          {viewMode === 'tabs'
            ? (t?.('switchToGridView') || 'Switch to split view')
            : (t?.('switchToTabsView') || 'Switch to tabs view')}
        </MenuItem>
      )}
      {canSplit && onSplit && (
        <>
          <MenuItem onClick={() => onSplit('right')} icon={SquareSplitHorizontal}>
            {`${t?.('splitRight') || 'Split right'} (Ctrl+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('left')} icon={SquareSplitHorizontal}>
            {t?.('splitLeft') || 'Split left'}
          </MenuItem>
          <MenuItem onClick={() => onSplit('down')} icon={SquareSplitVertical}>
            {`${t?.('splitDown') || 'Split down'} (Ctrl+Shift+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('up')} icon={SquareSplitVertical}>
            {t?.('splitUp') || 'Split up'}
          </MenuItem>
          <MenuItem onClick={() => onSplit('2x2')} icon={Grid2x2}>
            {t?.('layout2x2') || '2 × 2 grid'}
          </MenuItem>
        </>
      )}
      <MenuItem onClick={onCloseTab} danger icon={X}>{t?.('closeTab') || 'Close tab'}</MenuItem>
    </div>
  );
};

const MenuItem = ({ onClick, children, danger, disabled = false, icon: Icon = null }) => (
  <button
    onClick={disabled ? undefined : (e) => { e.stopPropagation(); onClick?.(); }}
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
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? color.muted : (danger ? color.danger : color.text),
      fontSize: '11.5px',
      fontFamily: 'inherit',
      transition: 'background 120ms',
      lineHeight: 1.3,
      opacity: disabled ? 0.5 : 1,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = glassMenuItemHover(); }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    {Icon && <Icon size={12} strokeWidth={1.8} />}
    {children}
  </button>
);

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    height: '34px',
    background: `linear-gradient(180deg, var(--ui-mantle, ${color.crust}), var(--ui-crust, ${color.crust}))`,
    borderBottom: '1px solid var(--ui-border)',
    fontFamily: font.sans,
    overflow: 'hidden',
    flexShrink: 0,
    // 화면 양끝에 너무 붙지 않도록 좌우에 미세한 breathing room 을 둔다.
    padding: '0 4px 0 6px',
    gap: '0',
  },
  barMobile: {
    /* 모바일도 데스크탑 탭바처럼 유지한다. 탭을 억지로 압축/드래그하지 않고
       중앙 탭 스트립만 자연스럽게 좌우 스크롤한다. */
    height: '34px',
    padding: '0 4px 0 6px',
    gap: '0',
  },
  tabMobile: {
    height: 'calc(100% + 1px)',
    minWidth: '128px',
    maxWidth: '190px',
    flex: '0 0 150px',
    fontSize: fontSize['12'],
    paddingLeft: '10px',
    paddingRight: '8px',
    gap: '5px',
    borderRadius: 0,
  },
  miniBtnMobile: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
  },
  brandBtn: {
    /* 데스크탑 — 슬림한 24px 정사각, 좌우 마진 최소. */
    width: '24px',
    height: '24px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: color.accent,
    cursor: 'pointer',
    transition: 'background 150ms',
    padding: 0,
    borderRadius: '3px',
    margin: '5px 7px 0 0',
  },
  brandBtnMobile: {
    width: '24px',
    height: '24px',
    margin: '5px 7px 0 0',
    borderRadius: '3px',
  },
  tabList: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '0',
    overflowX: 'auto',
    overflowY: 'hidden',
    flex: '1 1 auto',
    paddingTop: '0',
    paddingBottom: '0',
    paddingRight: '0',
    boxSizing: 'border-box',
    scrollbarWidth: 'none',           // Firefox
    msOverflowStyle: 'none',           // IE/Edge legacy
  },
  tabListMobile: {
    gap: '0',
    flex: '1 1 auto',
    paddingTop: '0',
    paddingBottom: '0',
    WebkitOverflowScrolling: 'touch',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '0 8px 0 10px',
    height: 'calc(100% + 1px)',
    /* 탭 많을 때 인디케이터를 다 보이게 — flex-shrink 1 + 작은 minWidth 로 자동 압축.
       이름은 tabName 의 ellipsis 가 처리. 너무 좁아지면 결국 아이콘 타일 + 점 정도만 남아도 OK. */
    minWidth: '46px',
    maxWidth: '200px',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
    userSelect: 'none',
    flex: '1 1 auto',
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    borderRadius: 0,
    boxSizing: 'border-box',
    marginLeft: '-1px',
  },
  tabName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    letterSpacing: '0.005em',
  },
  miniBtn: {
    width: '17px',
    height: '17px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    color: 'inherit',
    padding: 0,
    transition: 'background 150ms, color 150ms, opacity 150ms',
  },
  actionGroup: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    // 우측 TerminalHeader.activityBar (36px, border-box, borderLeft 포함) 와 borderLeft 가
    // 같은 x 에 오게 — box-sizing: border-box + 명시 width.
    // 데스크탑 (split×2 + settings = 3 버튼) 은 더 넓게, 모바일 (settings 1) 은 36 고정.
    boxSizing: 'border-box',
    paddingLeft: '2px',
    paddingRight: '2px',
    borderLeft: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  actionGroupMobile: {
    width: '36px',         // 우측 rail 폭과 동일 → borderLeft 같은 x
    paddingLeft: '1px',    // border 1 + padL 1 + button 32 + padR 2 = 36
  },
  closeGroup: {
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '4px',
    paddingRight: '4px',
    flexShrink: 0,
  },
};

const SettingsSubMenu = ({ anchor, t, isMobile = false, onClose, onSettings, onReload, onEqualize }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onCloseRef.current(); };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const m = 8;
      let nx = anchor.x - rect.width;
      let ny = anchor.y;
      if (nx < m) nx = m;
      if (nx + rect.width > window.innerWidth - m) nx = window.innerWidth - rect.width - m;
      if (ny + rect.height > window.innerHeight - m) ny = window.innerHeight - rect.height - m;
      setPos({ x: nx, y: ny });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  const iconSize = isMobile ? 15 : 12;
  const item = (Icon, label, action) => (
    <button
      type="button"
      onClick={action}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        width: '100%',
        minHeight: isMobile ? '42px' : '28px',
        padding: isMobile ? '0 12px' : '5px 8px',
        background: 'transparent', border: 'none', borderRadius: '3px',
        cursor: 'pointer', color: color.text,
        fontSize: isMobile ? '13px' : '11.5px', fontFamily: font.sans,
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={iconSize} strokeWidth={1.8} />
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{
      position: 'fixed', top: pos.y, left: pos.x,
      ...glassMenuStyle(),
      zIndex: 200000,
      minWidth: isMobile ? '190px' : '160px',
      fontFamily: font.sans,
      opacity: measured ? 1 : 0,
      transition: 'opacity 120ms',
    }}>
      {item(SettingsIcon, t?.('settings') || 'Settings', onSettings)}
      {onEqualize && item(LayoutGrid, t?.('equalizePane') || 'Equalize panes', onEqualize)}
      {onReload && item(RefreshCw, t?.('reloadTerminals') || 'Reload terminals', onReload)}
    </div>
  );
};

export default TabBar;
