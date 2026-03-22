import { PanelLeftClose, PanelLeft, ChevronsDown, Menu, Plus, Settings as SettingsIcon, Power } from 'lucide-react';
import AppStyles from '../../styles/AppStyles';
import Button from '../common/Button';

const Header = ({ 
  isSidebarOpen, 
  toggleSidebar, 
  sessions, 
  activeSessionId, 
  isMobile, 
  scrollBtnClicked, 
  handleScrollToBottom, 
  isMenuOpen, 
  setIsMenuOpen, 
  currentTheme, 
  t, 
  handleNewSession,
  setIsSettingsOpen,
  handleLogoutRequest
}) => {
  const styles = AppStyles;

  return (
    <div style={{
      ...styles.header,
      backgroundColor: currentTheme.ui.bgSecondary,
      borderBottom: `1px solid ${currentTheme.ui.border}`,
      height: '40px',
      boxShadow: 'none',
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
      </div>

      <div style={styles.headerRight}>
        {sessions.length > 0 && (
          <div style={{
            ...styles.sessionInfo,
            color: currentTheme.ui.text,
            backgroundColor: currentTheme.ui.bgTertiary,
            border: `1px solid ${currentTheme.ui.border}`,
            borderRadius: currentTheme.ui.radiusSmall,
            height: '26px',
            marginRight: isMobile ? '4px' : '8px',
            padding: isMobile ? '0 8px' : '0 12px',
          }}>
            <span style={{ color: currentTheme.ui.accent, fontWeight: '800', fontSize: isMobile ? '11px' : 'inherit' }}>
              {sessions.findIndex((s) => s.id === activeSessionId) + 1}
            </span>
            <span style={{ color: currentTheme.ui.textSecondary, fontSize: '10px', margin: isMobile ? '0 2px' : '0 6px' }}> / </span>
            <span style={{ color: currentTheme.ui.textSecondary, fontWeight: '600', fontSize: isMobile ? '11px' : 'inherit' }}>
              {sessions.length}
            </span>
          </div>
        )}
        
        {isMobile ? (
          <>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleScrollToBottom} 
              disabled={sessions.length === 0}
              theme={currentTheme}
              style={{
                backgroundColor: scrollBtnClicked ? currentTheme.ui.accentMuted : 'transparent',
                color: sessions.length === 0 ? currentTheme.ui.textSecondary + '60' : currentTheme.ui.iconColor,
              }}
              icon={ChevronsDown}
            />

            <Button 
              variant="ghost" 
              size="icon" 
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
              }} 
              theme={currentTheme}
              style={{
                backgroundColor: isMenuOpen ? currentTheme.ui.bgTertiary : 'transparent',
              }}
              icon={Menu}
            />
          </>
        ) : (
          <div style={styles.desktopButtons}>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleScrollToBottom} 
              disabled={sessions.length === 0}
              theme={currentTheme}
              icon={ChevronsDown}
              title={t('scrollToBottom')}
            />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleNewSession} 
              theme={currentTheme}
              icon={Plus}
              title={t('newSession')}
            />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSettingsOpen(true)} 
              theme={currentTheme}
              icon={SettingsIcon}
              title={t('settings')}
            />
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
