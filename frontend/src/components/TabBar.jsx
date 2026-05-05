import { memo, useState, useEffect, useRef } from 'react';
import {
  X, Terminal as TerminalIcon, Server,
  Settings as SettingsIcon, MoreHorizontal,
  SquareSplitHorizontal, SquareSplitVertical,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight } = tokens;

const TabBar = ({
  tabs = [],
  activeTabId,
  onSelect,
  onClose,
  onHome,
  onOpenHosts,
  onOpenKeys,
  onOpenSettings,
  onSplit,
  onDuplicate,
  canSplit = false,
  t,
}) => {
  const [contextMenu, setContextMenu] = useState(null);  // {tabId, x, y}

  const isHome = activeTabId === null;

  return (
    <div style={styles.bar}>
      <style>{`
        .tabbar-list::-webkit-scrollbar { display: none; }
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
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
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
            t={t}
          />
        ))}
      </div>

      {/* right action group */}
      <div style={styles.actionGroup}>
        {canSplit && (
          <>
            <ActionBtn
              icon={SquareSplitHorizontal}
              onClick={() => onSplit?.('h')}
              title={`${t?.('splitHorizontal') || 'Split right'} (Ctrl+\\)`}
            />
            <ActionBtn
              icon={SquareSplitVertical}
              onClick={() => onSplit?.('v')}
              title={`${t?.('splitVertical') || 'Split down'} (Ctrl+Shift+\\)`}
            />
            <div style={{ width: 1, alignSelf: 'stretch', background: color.border, margin: '0 4px' }} />
          </>
        )}
        <ActionBtn icon={SettingsIcon} onClick={onOpenSettings} title={t?.('settings') || 'Settings'} />
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

const Tab = memo(({ tab, isActive, onSelect, onClose, onContextMenu, onMore, t }) => {
  const Icon = tab.type === 'host' ? Server : TerminalIcon;
  const dotColor = tab.color_index != null
    ? color.dotPalette?.[tab.color_index % (color.dotPalette?.length || 8)] || color.accent
    : color.accent;

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        ...styles.tab,
        background: isActive ? color.base : color.surface0,
        color: isActive ? color.text : color.subtext,
        border: `1px solid ${isActive ? color.borderStrong : color.border}`,
      }}
      onClick={onSelect}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = color.surface1;
        const moreBtn = e.currentTarget.querySelector('[data-more]');
        if (moreBtn) moreBtn.style.opacity = '1';
        const closeBtn = e.currentTarget.querySelector('[data-close]');
        if (closeBtn) closeBtn.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = color.surface0;
        const moreBtn = e.currentTarget.querySelector('[data-more]');
        if (moreBtn) moreBtn.style.opacity = isActive ? '0.6' : '0';
        const closeBtn = e.currentTarget.querySelector('[data-close]');
        if (closeBtn) closeBtn.style.opacity = isActive ? '0.85' : '0.5';
      }}
    >
      <div style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: dotColor,
        flexShrink: 0,
        opacity: isActive ? 1 : 0.55,
      }} />

      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: isActive ? color.text : color.subtext }}>
        <HostIcon value={tab.icon || ''} fallback={Icon} size={12} strokeWidth={1.8} />
      </span>
      <span style={styles.tabName}>{tab.name}</span>

      <button
        data-more="true"
        onClick={(e) => { e.stopPropagation(); onMore(e); }}
        style={{ ...styles.miniBtn, opacity: isActive ? 0.6 : 0, color: color.subtext }}
        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; e.currentTarget.style.opacity = isActive ? '0.6' : '0'; }}
        title={t?.('more') || 'More'}
      >
        <MoreHorizontal size={11} strokeWidth={2} />
      </button>

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

const ActionBtn = ({ icon: Icon, onClick, title, tone }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      // 큰 클릭 영역 — 시각적 호버 박스는 inner span 이 담당해 우측 활동바와 균형 맞춤.
      width: '32px',
      height: '32px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: tone === 'danger' ? color.danger : color.subtext,
      padding: 0,
    }}
    onMouseEnter={(e) => {
      const inner = e.currentTarget.firstElementChild;
      if (inner) inner.style.background = color.surface0;
      if (tone !== 'danger') e.currentTarget.style.color = color.text;
    }}
    onMouseLeave={(e) => {
      const inner = e.currentTarget.firstElementChild;
      if (inner) inner.style.background = 'transparent';
      e.currentTarget.style.color = tone === 'danger' ? color.danger : color.subtext;
    }}
  >
    <span
      style={{
        width: '24px',
        height: '24px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        borderRadius: '5px',
        transition: 'background 150ms',
      }}
    >
      <Icon size={15} strokeWidth={1.8} />
    </span>
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
    gap: '2px',
    paddingLeft: '6px',
    // 우측 활동바 actBtn 의 마진 (=(36-32)/2=2) 과 같게 — Settings 버튼 중심선이 활동바 버튼 중심선과 일치.
    paddingRight: '2px',
    borderLeft: `1px solid ${color.border}`,
    flexShrink: 0,
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
