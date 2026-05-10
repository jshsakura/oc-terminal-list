import { memo, useState, useEffect, useRef } from 'react';
import {
  X, Terminal as TerminalIcon, Server,
  Settings as SettingsIcon, MoreHorizontal,
  SquareSplitHorizontal, SquareSplitVertical, Anchor,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import RailIconBtn from './common/RailIconBtn';

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
  canSplit = false,
  isMobile = false,
  t,
}) => {
  const [contextMenu, setContextMenu] = useState(null);  // {tabId, x, y}
  const [draggingTabId, setDraggingTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);

  const isHome = activeTabId === null;

  return (
    <div style={styles.bar}>
      <style>{`
        .tabbar-list::-webkit-scrollbar { display: none; }
        @keyframes iterm-tab-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.35); opacity: 0.55; }
        }
      `}</style>
      {/* brand = home button — 홈 활성 시 활성 탭과 동일한 base 배경으로 */}
      <button
        style={{
          ...styles.brandBtn,
          background: isHome ? color.base : 'transparent',
          border: `1px solid ${isHome ? color.borderStrong : 'transparent'}`,
        }}
        onClick={onHome}
        title={t?.('home') || 'Home'}
        onMouseEnter={(e) => { if (!isHome) e.currentTarget.style.background = color.surface0; }}
        onMouseLeave={(e) => { if (!isHome) e.currentTarget.style.background = 'transparent'; }}
      >
        <TerminalIcon size={13} strokeWidth={2} />
      </button>

      {/* tabs */}
      <div
        className="tabbar-list"
        style={styles.tabList}
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
            isActive={tab.id === activeTabId}
            isBusy={!!busyTabIds && busyTabIds.has(tab.id)}
            isDragging={draggingTabId === tab.id}
            isDragOver={dragOverTabId === tab.id && draggingTabId && draggingTabId !== tab.id}
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

      {/* right action group — 모바일에선 가로/세로 분할이 의미 없음 (sub-tab 으로
          전환되거나 화면이 너무 좁음) → 분할 버튼 숨김. 설정만 노출. */}
      <div style={{ ...styles.actionGroup, ...(isMobile ? styles.actionGroupMobile : null) }}>
        {canSplit && !isMobile && (
          <>
            <RailIconBtn
              icon={SquareSplitHorizontal}
              onClick={() => onSplit?.('h')}
              title={`${t?.('splitHorizontal') || 'Split right'} (Ctrl+\\)`}
            />
            <RailIconBtn
              icon={SquareSplitVertical}
              onClick={() => onSplit?.('v')}
              title={`${t?.('splitVertical') || 'Split down'} (Ctrl+Shift+\\)`}
            />
          </>
        )}
        <RailIconBtn icon={SettingsIcon} onClick={onOpenSettings} title={t?.('settings') || 'Settings'} />
      </div>

      {contextMenu && (
        <TabContextMenu
          ctx={contextMenu}
          t={t}
          onClose={() => setContextMenu(null)}
          onCloseTab={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
          onDuplicateTab={onDuplicate ? () => { onDuplicate(contextMenu.tabId); setContextMenu(null); } : null}
        />
      )}
    </div>
  );
};

const Tab = memo(({
  tab, index, isActive, isBusy = false, isDragging = false, isDragOver = false,
  isMobile = false,
  onSelect, onClose, onContextMenu, onMore,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  t,
}) => {
  const Icon = tab.type === 'host' ? Server : TerminalIcon;
  const dotColor = tab.color_index != null
    ? color.dotPalette?.[tab.color_index % (color.dotPalette?.length || 8)] || color.accent
    : color.accent;

  // 모바일 long-press → context menu (실수 닫기 방지: X 버튼 대신 의도된 제스처)
  const longPressTimerRef = useRef(null);
  const onTouchStartLP = (e) => {
    if (!isMobile) return;
    const touch = e.touches?.[0];
    const x = touch?.clientX ?? 0;
    const y = touch?.clientY ?? 0;
    longPressTimerRef.current = setTimeout(() => {
      onContextMenu?.({ preventDefault: () => {}, clientX: x, clientY: y });
      longPressTimerRef.current = null;
    }, 450);
  };
  const cancelLP = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div
      draggable={!isMobile /* 모바일은 드래그 비활성 — 탭 누르려다 잘못 끌리는 사고 방지 */}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStartLP}
      onTouchEnd={cancelLP}
      onTouchMove={cancelLP}
      onTouchCancel={cancelLP}
      style={{
        ...styles.tab,
        ...(isMobile ? styles.tabMobile : null),
        background: isActive ? color.base : color.surface0,
        color: isActive ? color.text : color.subtext,
        border: `1px solid ${isDragOver ? color.accent : (isActive ? color.borderStrong : color.border)}`,
        opacity: isDragging ? 0.4 : 1,
        cursor: isMobile ? 'pointer' : 'grab',
      }}
      onClick={onSelect}
      onMouseEnter={(e) => {
        if (isMobile) return;
        if (!isActive) e.currentTarget.style.background = color.surface1;
        const moreBtn = e.currentTarget.querySelector('[data-more]');
        if (moreBtn) moreBtn.style.opacity = '1';
        const closeBtn = e.currentTarget.querySelector('[data-close]');
        if (closeBtn) closeBtn.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (isMobile) return;
        if (!isActive) e.currentTarget.style.background = color.surface0;
        const moreBtn = e.currentTarget.querySelector('[data-more]');
        if (moreBtn) moreBtn.style.opacity = isActive ? '0.6' : '0';
        const closeBtn = e.currentTarget.querySelector('[data-close]');
        if (closeBtn) closeBtn.style.opacity = isActive ? '0.85' : '0.5';
      }}
    >
      {index != null && index <= 9 && (
        <span
          title={`${t?.('switchToTab') || 'Switch to tab'} (Ctrl+${index})`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '15px',
            height: '15px',
            padding: '0 3px',
            fontSize: '9.5px',
            fontWeight: 600,
            color: isActive ? color.text : color.muted,
            fontFamily: font.mono,
            background: isActive ? color.surface1 : 'transparent',
            border: `1px solid ${isActive ? color.borderStrong : color.border}`,
            borderRadius: '3px',
            flexShrink: 0,
            letterSpacing: '0',
            lineHeight: 1,
          }}
          aria-hidden
        >
          {index}
        </span>
      )}
      <div style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: dotColor,
        flexShrink: 0,
        opacity: isActive ? 1 : 0.55,
        boxShadow: isBusy ? `0 0 0 2px ${dotColor}55` : 'none',
        animation: isBusy ? 'iterm-tab-pulse 0.9s ease-in-out infinite' : 'none',
      }} />

      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: isActive ? color.text : color.subtext }}>
        <HostIcon value={tab.icon || ''} fallback={Icon} size={12} strokeWidth={1.8} />
      </span>
      <span style={styles.tabName}>{tab.name}</span>
      {tab.isPersistent && (
        <span
          title={t?.('persistentSession') || 'tmux persistent — work survives disconnect'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            color: color.muted,
            opacity: isActive ? 0.85 : 0.55,
          }}
          aria-hidden
        >
          <Anchor size={10} strokeWidth={2} />
        </span>
      )}

      {/* More 버튼 — 모바일은 항상 노출 + 큰 hit-area; 데스크톱은 hover/active 시. */}
      <button
        data-more="true"
        onClick={(e) => { e.stopPropagation(); onMore(e); }}
        style={{
          ...styles.miniBtn,
          ...(isMobile ? styles.miniBtnMobile : null),
          opacity: isMobile ? 1 : (isActive ? 0.6 : 0),
          color: color.subtext,
        }}
        onMouseEnter={(e) => { if (isMobile) return; e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { if (isMobile) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; e.currentTarget.style.opacity = isActive ? '0.6' : '0'; }}
        title={t?.('more') || 'More'}
      >
        <MoreHorizontal size={isMobile ? 14 : 11} strokeWidth={2} />
      </button>

      {/* X 닫기 — 데스크톱에만. 모바일은 More→메뉴로만 닫게 해 실수 방지. */}
      {!isMobile && (
        <button
          data-close="true"
          style={{ ...styles.miniBtn, opacity: isActive ? 0.85 : 0.5, color: color.subtext }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.danger; e.currentTarget.style.color = '#fff'; e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; e.currentTarget.style.opacity = isActive ? '0.85' : '0.5'; }}
          title={t?.('closeTab') || 'Close tab'}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      )}

    </div>
  );
});

const TabContextMenu = ({ ctx, t, onClose, onCloseTab, onDuplicateTab }) => {
  const ref = useRef(null);
  useEffect(() => {
    const handle = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose(); });
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: ctx.y,
        left: ctx.x,
        background: color.surface0,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: '6px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        padding: '3px',
        zIndex: 1000,
        minWidth: '120px',
        fontFamily: font.sans,
      }}
    >
      {onDuplicateTab && (
        <MenuItem onClick={onDuplicateTab}>
          {t?.('duplicateTab') || 'Duplicate (same path)'}
        </MenuItem>
      )}
      <MenuItem onClick={onCloseTab} danger>{t?.('closeTab') || 'Close tab'}</MenuItem>
    </div>
  );
};

const MenuItem = ({ onClick, children, danger }) => (
  <button
    onClick={onClick}
    style={{
      width: '100%',
      textAlign: 'left',
      padding: '5px 8px',
      background: 'transparent',
      border: 'none',
      borderRadius: '3px',
      cursor: 'pointer',
      color: danger ? color.danger : color.text,
      fontSize: '11.5px',
      fontFamily: 'inherit',
      transition: 'background 120ms',
      lineHeight: 1.3,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    {children}
  </button>
);

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    height: '38px',
    background: color.crust,
    borderBottom: `1px solid ${color.border}`,
    fontFamily: font.sans,
    overflow: 'hidden',
    flexShrink: 0,
    // 우측 padding 0 — Settings 버튼 중심이 우측 활동바(36px) 중심과 동일선이 되게.
    padding: '0 0 0 6px',
    gap: '6px',
  },
  tabMobile: {
    /* 모바일 — 더 큰 hit-area, 압축하지 않고 가로 스크롤로 처리 */
    height: '34px',
    minWidth: '140px',
    maxWidth: '220px',
    fontSize: fontSize['13'],
    paddingLeft: '12px',
    paddingRight: '4px',
  },
  miniBtnMobile: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
  },
  brandBtn: {
    width: '28px',
    height: '28px',
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
    borderRadius: '6px',
    margin: '4px 6px 4px 2px',
  },
  tabList: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflowX: 'auto',
    overflowY: 'hidden',
    flex: 1,
    paddingTop: '5px',
    paddingBottom: '5px',
    scrollbarWidth: 'none',           // Firefox
    msOverflowStyle: 'none',           // IE/Edge legacy
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '0 6px 0 10px',
    height: '28px',
    minWidth: 0,
    maxWidth: '200px',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
    userSelect: 'none',
    flexShrink: 0,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    borderRadius: '6px',
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
