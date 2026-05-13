import { memo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Terminal as TerminalIcon, Server, Monitor,
  Settings as SettingsIcon, MoreHorizontal,
  SquareSplitHorizontal, SquareSplitVertical, Grid2x2, Square,
  ChevronLeft, ChevronRight, Edit3,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
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
  onSplit,
  onDuplicate,
  onReorder,
  /* (tabId) → 해당 탭의 viewMode 토글 (grid ↔ tabs). panes.length > 1 인 탭에서만 의미. */
  onToggleViewMode,
  canSplit = false,
  isMobile = false,
  t,
}) => {
  const [contextMenu, setContextMenu] = useState(null);  // {tabId, x, y}
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);

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
          background: isHome ? color.surface1 : 'transparent',
          border: `1px solid ${isHome ? color.accentBorder : 'transparent'}`,
          color: isHome ? color.accent : color.subtext,
        }}
        onClick={onHome}
        title={t?.('home') || 'Home'}
        onMouseEnter={(e) => { if (!isHome) e.currentTarget.style.background = color.surface0; }}
        onMouseLeave={(e) => { if (!isHome) e.currentTarget.style.background = 'transparent'; }}
      >
        <TerminalIcon size={13} strokeWidth={2} />
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
            isEvenWidth={tabs.length > 0 && tabs.length <= 3}
            isDragging={activeDraggingId === tab.id}
            isDragOver={activeDragOverId === tab.id && activeDraggingId && activeDraggingId !== tab.id}
            touchProps={isMobile ? touchReorder.getItemProps(tab.id) : null}
            isMobile={isMobile}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
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

      {/* right action group — Settings only; split actions live in per-tab More menu */}
      <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, borderLeft: isMobile ? 'none' : `1px solid ${color.border}` }}>
        <div style={{
          width: '30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <RailIconBtn icon={SettingsIcon} onClick={onOpenSettings} title={t?.('settings') || 'Settings'} compact />
        </div>
      </div>
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
        canToggleViewMode={ctxPaneCount > 1 && !!onToggleViewMode}
        canMoveLeft={ctxIdx > 0 && !!onReorder}
        canMoveRight={ctxIdx >= 0 && ctxIdx < tabs.length - 1 && !!onReorder}
        canSplit={isCtxActive && canSplit && !!onSplit}
        onSplit={onSplit ? (dir) => { onSplit(dir); setContextMenu(null); } : null}
        onClose={() => setContextMenu(null)}
        onCloseTab={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
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
  isEvenWidth = false,
  isMobile = false,
  touchProps = null, // useTouchDragReorder.getItemProps(tab.id) — 모바일 드래그/터치 핸들러 일괄.
  onSelect, onClose, onContextMenu, onMore,
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
        background: isActive ? color.base : color.crust,
        color: isActive ? color.text : color.muted,
        fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
        border: `1px solid ${isDragOver ? color.accent : (isActive ? color.borderStrong : color.border)}`,
        // 하단 라인은 TabBar 자체 borderBottom 하나만 쓰게 한다.
        // inactive tab 의 개별 bottom border 가 보이면 바닥선 위에 떠 보인다.
        borderBottom: isDragOver ? `1px solid ${color.accent}` : `1px solid ${isActive ? color.base : color.crust}`,
        flex: isEvenWidth ? '1 1 0' : styles.tab.flex,
        maxWidth: isEvenWidth ? 'none' : styles.tab.maxWidth,
        marginLeft: isFirst ? 0 : styles.tab.marginLeft,
        opacity: isDragging ? 0.4 : 1,
        cursor: isMobile ? 'pointer' : 'grab',
      }}
      onClick={onSelect}
      /* 휠 클릭(가운데 버튼)으로 즉시 탭 닫기 — 브라우저 기본 동작(자동 스크롤/링크 새 탭) 차단. */
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          onClose?.();
        }
      }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }}
      onMouseEnter={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.subtext; }
      }}
      onMouseLeave={(e) => {
        if (isMobile) return;
        if (!isActive) { e.currentTarget.style.background = color.crust; e.currentTarget.style.color = color.muted; }
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
      <span style={styles.tabName}>{tab.name}</span>

      {/* More 버튼 — 활성 탭에서만 노출해 비활성 탭의 가로 공간 낭비를 줄인다. */}
      {isActive && (
        <button
          data-more="true"
          onClick={(e) => { e.stopPropagation(); onMore(e); }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          style={{
            ...styles.miniBtn,
            ...(isMobile ? styles.miniBtnMobile : null),
            opacity: 1,
            color: color.subtext,
          }}
          onMouseEnter={(e) => { if (isMobile) return; e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
          onMouseLeave={(e) => { if (isMobile) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
          title={t?.('more') || 'More'}
        >
          <MoreHorizontal size={isMobile ? 14 : 11} strokeWidth={2} />
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
        background: color.surface0,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: '6px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        padding: '3px',
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
        <MenuItem onClick={onDuplicateTab}>
          {t?.('duplicateTab') || 'Duplicate (same path)'}
        </MenuItem>
      )}
      {canToggleViewMode && onToggleViewMode && (
        <MenuItem onClick={onToggleViewMode}>
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
      <MenuItem onClick={onCloseTab} danger>{t?.('closeTab') || 'Close tab'}</MenuItem>
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
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = color.surface1; }}
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
    height: '38px',
    background: color.crust,
    borderBottom: 'none',
    fontFamily: font.sans,
    overflow: 'hidden',
    flexShrink: 0,
    // 화면 양끝에 너무 붙지 않도록 좌우에 미세한 breathing room 을 둔다.
    padding: '0 4px 0 6px',
    gap: '0',
  },
  barMobile: {
    /* 모바일은 상단 호흡공간을 공격적으로 줄임 — 네이티브 앱 헤더 톤.
       좌우 2px inset 으로 화면 끝에 붙는 느낌만 완화. */
    height: '30px',
    padding: '0 2px 0 4px',
    gap: '2px',
  },
  tabMobile: {
    /* 모바일 — touch hit-area 는 유지하되 가로/세로 모두 컴팩트하게.
       단축번호 뱃지가 빠지므로 leading 패딩을 더 줄임. 많이 열려도 인디케이터 다 보이게 minWidth ↓. */
    height: '100%',
    minWidth: '54px',
    maxWidth: '180px',
    fontSize: fontSize['13'],
    paddingLeft: '7px',
    paddingRight: '4px',
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
    margin: '7px 7px 0 0',
  },
  brandBtnMobile: {
    /* 모바일은 더 공격적으로 — 20px 정사각, 좌측 inset 2 만. */
    width: '20px',
    height: '20px',
    margin: '5px 5px 5px 0',
    borderRadius: '3px',
  },
  tabList: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '0',
    overflowX: 'auto',
    overflowY: 'hidden',
    flex: '0 1 auto',
    paddingTop: '0',
    paddingBottom: '0',
    paddingRight: '0',
    boxSizing: 'border-box',
    scrollbarWidth: 'none',           // Firefox
    msOverflowStyle: 'none',           // IE/Edge legacy
  },
  tabListMobile: {
    gap: '0',
    paddingTop: '0',
    paddingBottom: '0',
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
    // 우측 RightPanel.activityBar (36px, border-box, borderLeft 포함) 와 borderLeft 가
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

export default TabBar;
