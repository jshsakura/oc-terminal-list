import { PanelLeftClose, PanelLeft, PanelRightClose, PanelRight, Menu, Plus, Settings as SettingsIcon, Power, Terminal as TerminalIcon, Columns2, X, GitBranch, Square, Rows2, LayoutGrid } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, space } = tokens;

const Header = ({
  isSidebarOpen,
  toggleSidebar,
  sessions,
  activeSessionId,
  isMobile,
  t,
  handleNewSession,
  setIsSettingsOpen,
  handleLogoutRequest,
  setIsMenuOpen,
  isMenuOpen,
  paneCount = 1,
  maxPanes = 4,
  onAddPane,
  onClosePane,
  onSetLayout,
  isChangesPanelOpen = false,
  toggleChangesPanel,
  changesCount = 0,
}) => {
  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <IconButton
          onClick={toggleSidebar}
          title={isSidebarOpen ? t('closeSidebar') : t('sessions')}
          icon={isSidebarOpen ? PanelLeftClose : PanelLeft}
        />
        <div style={styles.brand}>
          <div style={styles.brandIcon}>
            <TerminalIcon size={13} strokeWidth={2} />
          </div>
          <span style={styles.brandText}>Terminal List</span>
        </div>
      </div>

      <div style={styles.right}>
        {!isMobile && (
          <>
            <LayoutGroup
              paneCount={paneCount}
              onSetLayout={onSetLayout}
              t={t}
            />
            {paneCount < maxPanes && (
              <IconButton
                onClick={onAddPane}
                title={`${t('splitTerminal') || 'Split'} (+empty)`}
                icon={Plus}
              />
            )}
            {paneCount > 1 && (
              <IconButton
                onClick={onClosePane}
                title={t('unsplitTerminal') || 'Close pane'}
                icon={X}
              />
            )}
            <Divider />
            <ChangesToggle
              open={isChangesPanelOpen}
              onClick={toggleChangesPanel}
              count={changesCount}
              title={t('changes') || 'Changes'}
            />
            <Divider />
          </>
        )}
        <IconButton
          onClick={handleNewSession}
          title={t('newSession')}
          icon={Plus}
        />
        <Divider />
        {isMobile ? (
          <IconButton
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title={t('menu') || 'Menu'}
            icon={Menu}
          />
        ) : (
          <>
            <IconButton
              onClick={() => setIsSettingsOpen(true)}
              title={t('settings')}
              icon={SettingsIcon}
            />
            <IconButton
              onClick={handleLogoutRequest}
              title={t('logout')}
              icon={Power}
              tone="danger"
            />
          </>
        )}
      </div>
    </header>
  );
};

const IconButton = ({ onClick, title, icon: Icon, tone }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      ...styles.iconBtn,
      color: tone === 'danger' ? color.danger : color.subtext,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.color = tone === 'danger' ? color.danger : color.text;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = tone === 'danger' ? color.danger : color.subtext;
    }}
  >
    <Icon size={14} strokeWidth={2} />
  </button>
);

const Divider = () => (
  <div style={{ width: '1px', height: '14px', background: color.border, margin: `0 ${space['1']}` }} />
);

// 1/2/3/4 pane 즉시 전환 버튼들 — 각 누르면 부족한 만큼 새 로컬 세션 자동 생성
const LayoutGroup = ({ paneCount, onSetLayout, t }) => {
  const items = [
    { n: 1, icon: Square,    title: t('layout1') || '1 pane' },
    { n: 2, icon: Rows2,     title: t('layout2') || '2 panes' },
    { n: 4, icon: LayoutGrid, title: t('layout4') || '4 panes' },
  ];
  return (
    <div style={{
      display: 'inline-flex',
      gap: '2px',
      background: color.surface0,
      border: `1px solid ${color.border}`,
      borderRadius: '4px',
      padding: '1px',
      marginRight: '4px',
    }}>
      {items.map(({ n, icon: Icon, title }) => {
        const active = paneCount === n;
        return (
          <button
            key={n}
            onClick={() => onSetLayout?.(n)}
            title={title}
            style={{
              width: '24px',
              height: '22px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: active ? color.accent : 'transparent',
              color: active ? color.crust : color.subtext,
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'background 120ms ease, color 120ms ease',
              padding: 0,
            }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; } }}
          >
            <Icon size={12} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
};

const ChangesToggle = ({ open, onClick, count, title }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: space['1'],
      height: '26px',
      padding: `0 ${space['2']}`,
      background: open ? color.surface0 : 'transparent',
      color: open ? color.text : color.subtext,
      border: `1px solid ${open ? color.border : 'transparent'}`,
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      fontFamily: 'inherit',
      transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
    }}
    onMouseEnter={(e) => { if (!open) { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.text; } }}
    onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; } }}
  >
    <GitBranch size={13} strokeWidth={2} />
    <span>{title}</span>
    {count > 0 && (
      <span style={{
        fontSize: '10px',
        color: color.accent,
        background: color.accentSubtle,
        border: `1px solid ${color.accentBorder}`,
        borderRadius: '999px',
        padding: '0 5px',
        fontFamily: 'inherit',
      }}>
        {count}
      </span>
    )}
  </button>
);

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '36px',
    minHeight: '36px',
    padding: `0 ${space['2']}`,
    background: color.crust,
    borderBottom: `1px solid ${color.border}`,
    fontFamily: font.sans,
    position: 'relative',
    zIndex: 100,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: space['0.5'],
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1.5'],
    paddingLeft: space['1'],
  },
  brandIcon: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: '4px',
    color: color.accent,
  },
  brandText: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    color: color.text,
    letterSpacing: '0.01em',
  },
  iconBtn: {
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease',
    padding: 0,
  },
};

export default Header;
