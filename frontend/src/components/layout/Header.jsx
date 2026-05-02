import { PanelLeftClose, PanelLeft, Menu, Plus, Settings as SettingsIcon, Power, Terminal as TerminalIcon } from 'lucide-react';
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
          <span style={styles.brandText}>iTerminaLlist</span>
        </div>
      </div>

      <div style={styles.right}>
        <IconButton
          onClick={handleNewSession}
          title={t('newSession')}
          icon={Plus}
        />
        <Divider />
        {isMobile ? (
          <IconButton
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="Menu"
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
