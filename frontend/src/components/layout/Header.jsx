import { PanelLeftClose, PanelLeft, ChevronsUp, ChevronsDown, Menu, Plus, Settings as SettingsIcon, Power } from 'lucide-react';
import AppStyles from '../../styles/AppStyles';
import Button from '../common/Button';

const Header = ({ 
  isSidebarOpen, 
  toggleSidebar, 
  sessions, 
  activeSessionId, 
  isMobile, 
  currentTheme, 
  t,
  handleNewSession,
  setIsSettingsOpen,
  handleLogoutRequest,
  setIsMenuOpen,
  isMenuOpen
}) => {
  const styles = AppStyles;
  
  // Safety check for currentTheme
  if (!currentTheme || !currentTheme.ui) return null;

  const isLightTheme = currentTheme.background === '#ffffff' || currentTheme.background === '#fdf6e3' || currentTheme.background === '#fbf1c7';

  return (
    <div style={{
      ...styles.header,
      backgroundColor: currentTheme.ui.glassBg || (isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(30, 30, 46, 0.7)'),
      backdropFilter: isLightTheme ? 'blur(12px)' : 'blur(8px) saturate(140%)',
      WebkitBackdropFilter: isLightTheme ? 'blur(12px)' : 'blur(8px) saturate(140%)',
      borderBottom: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`,
      boxShadow: currentTheme.ui.shadow || (isLightTheme ? '0 1px 10px rgba(0,0,0,0.04)' : '0 2px 15px rgba(0,0,0,0.4)'),
      height: '40px',
      minHeight: '40px',
      maxHeight: '40px',
      position: 'relative',
      zIndex: 100,
    }}>
      <div style={styles.headerLeft}>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleSidebar} 
          theme={currentTheme}
          title={isSidebarOpen ? t('closeSidebar') : t('sessions')}
          icon={isSidebarOpen ? PanelLeftClose : PanelLeft}
        />

        <h1 style={{
          ...styles.title,
          color: currentTheme.ui.text,
          fontSize: isMobile ? '14px' : '16px',
          fontWeight: '800',
          letterSpacing: '-0.02em',
          margin: 0,
          marginLeft: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          Terminal List
        </h1>
      </div>

      <div style={styles.headerRight}>
        {/* Page Up/Down Buttons (Visible on both mobile and desktop if session active) */}
        {activeSessionId && (
          <div style={{ display: 'flex', gap: '4px', marginRight: '8px' }}>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => window.terminalSessions?.[activeSessionId]?.sendData('\x1b[5~')} 
              theme={currentTheme}
              icon={ChevronsUp}
              title="Page Up"
            />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => window.terminalSessions?.[activeSessionId]?.sendData('\x1b[6~')} 
              theme={currentTheme}
              icon={ChevronsDown}
              title="Page Down"
            />
          </div>
        )}

        {isMobile ? (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsMenuOpen(!isMenuOpen)} 
            theme={currentTheme}
            icon={Menu}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSettingsOpen(true)} 
              theme={currentTheme}
              icon={SettingsIcon}
              title={t('settings')}
            />
            
            <div style={{ width: '1px', height: '16px', backgroundColor: currentTheme.ui.border, margin: '0 4px', opacity: 0.5 }} />
            
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleLogoutRequest}
              theme={currentTheme}
              style={{ color: currentTheme.red }}
              icon={Power}
              title={t('logout')}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Header;
