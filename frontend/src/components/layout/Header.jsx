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
  authState,
  handleNewSession,
  setIsSettingsOpen,
  handleLogoutRequest,
  hoveredDropdownItem,
  setHoveredDropdownItem
}) => {
  const styles = AppStyles;

  return (
    <div style={{
      ...styles.header,
      backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bgSecondary,
      backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`,
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
      height: '40px',
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
          color: currentTheme.ui.accent,
          letterSpacing: '0.5px',
          fontSize: '14px',
          fontWeight: '800',
        }}>{t('appName')}</h1>
      </div>

      <div style={styles.headerRight}>
        {sessions.length > 0 && (
          <div style={{
            ...styles.sessionInfo,
            color: currentTheme.ui.text,
            backgroundColor: currentTheme.ui.cardBg || currentTheme.ui.bgTertiary,
            borderColor: 'transparent',
            borderRadius: currentTheme.ui.radiusSmall,
            height: '26px',
            marginRight: '8px',
            padding: '0 12px',
            boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.2)',
          }}>
            <span style={{ color: currentTheme.ui.accent, fontWeight: '800' }}>
              {sessions.findIndex((s) => s.id === activeSessionId) + 1}
            </span>
            <span style={{ color: currentTheme.ui.textSecondary, fontSize: '10px', margin: '0 6px' }}> / </span>
            <span style={{ color: currentTheme.ui.textSecondary, fontWeight: '600' }}>
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

            <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsMenuOpen(!isMenuOpen)} 
                theme={currentTheme}
                style={{
                  backgroundColor: isMenuOpen ? currentTheme.ui.accentMuted : 'transparent',
                }}
                icon={Menu}
              />

              {isMenuOpen && (
                <>
                  <div style={styles.menuOverlay} onClick={() => setIsMenuOpen(false)} />
                  <div style={{
                    ...styles.dropdown,
                    backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bgSecondary,
                    backdropFilter: 'blur(25px) saturate(180%)',
                    borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
                    borderRadius: currentTheme.ui.radius,
                    boxShadow: '0 15px 40px rgba(0,0,0,0.6)',
                    padding: '8px',
                    marginTop: '6px',
                    border: `1px solid ${currentTheme.ui.borderLight || 'rgba(255,255,255,0.1)'}`,
                  }}>
                    <div style={{ ...styles.dropdownItem, borderBottom: 'none', padding: '12px 16px' }}>
                      <span style={{ ...styles.dropdownLabel, color: currentTheme.ui.textSecondary, fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>{t('user')}</span>
                      <span style={{ ...styles.dropdownValue, color: currentTheme.ui.accent, fontWeight: '800' }}>{authState.username}</span>
                    </div>
                    <div style={{ height: '1px', backgroundColor: currentTheme.ui.borderLight, margin: '4px 12px' }} />
                    <button
                      onClick={() => { handleNewSession(); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('new')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.ui.text,
                        backgroundColor: hoveredDropdownItem === 'new' ? currentTheme.ui.cardBg : 'transparent',
                        borderRadius: currentTheme.ui.radiusSmall,
                        padding: '10px 12px',
                        fontWeight: '600',
                      }}
                    >
                      <Plus size={18} strokeWidth={2.5} />
                      <span>{t('newSession')}</span>
                    </button>
                    <button
                      onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('settings')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.ui.text,
                        backgroundColor: hoveredDropdownItem === 'settings' ? currentTheme.ui.cardBg : 'transparent',
                        borderRadius: currentTheme.ui.radiusSmall,
                        padding: '10px 12px',
                        fontWeight: '600',
                      }}
                    >
                      <SettingsIcon size={18} strokeWidth={2.5} />
                      <span>{t('settings')}</span>
                    </button>
                    <div style={{ height: '1px', backgroundColor: currentTheme.ui.borderLight, margin: '4px 12px' }} />
                    <button
                      onClick={() => { handleLogoutRequest(); setIsMenuOpen(false); }}
                      onMouseEnter={() => setHoveredDropdownItem('logout')}
                      onMouseLeave={() => setHoveredDropdownItem(null)}
                      style={{
                        ...styles.dropdownButton,
                        color: currentTheme.red,
                        backgroundColor: hoveredDropdownItem === 'logout' ? 'rgba(243, 139, 168, 0.1)' : 'transparent',
                        borderRadius: currentTheme.ui.radiusSmall,
                        padding: '10px 12px',
                        fontWeight: '700',
                      }}
                    >
                      <Power size={18} strokeWidth={2.5} />
                      <span>{t('logout')}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
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
