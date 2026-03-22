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
          fontSize: isMobile ? '12px' : '14px',
          fontWeight: '800',
          padding: isMobile ? '0 4px' : '0 8px',
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
            marginRight: isMobile ? '4px' : '8px',
            padding: isMobile ? '0 8px' : '0 12px',
            boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.2)',
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

            <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(!isMenuOpen);
                }} 
                theme={currentTheme}
                style={{
                  backgroundColor: isMenuOpen ? currentTheme.ui.accentMuted : 'transparent',
                  zIndex: 10002,
                }}
                icon={Menu}
              />

              {isMenuOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 10000 }}>
                  <div 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 10000 }} 
                    onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); }} 
                  />
                  <div style={{
                    position: 'absolute',
                    top: '48px',
                    right: '8px',
                    width: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bgSecondary,
                    backdropFilter: 'blur(25px) saturate(180%)',
                    borderRadius: '16px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                    padding: '8px',
                    border: `1px solid ${currentTheme.ui.borderLight || 'rgba(255,255,255,0.1)'}`,
                    zIndex: 10001,
                  }}>
                    <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: currentTheme.ui.textSecondary, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>{t('user')}</span>
                      <span style={{ color: currentTheme.ui.accent, fontWeight: '800' }}>{authState.username}</span>
                    </div>
                    <div style={{ height: '1px', backgroundColor: currentTheme.ui.borderLight, margin: '4px 8px', opacity: 0.4 }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleNewSession(); setIsMenuOpen(false); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        background: 'none',
                        border: 'none',
                        color: currentTheme.ui.text,
                        fontSize: '14px',
                        fontWeight: '600',
                        borderRadius: '12px',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <Plus size={18} strokeWidth={2.5} color={currentTheme.ui.accent} />
                      <span>{t('newSession')}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setIsSettingsOpen(true); setIsMenuOpen(false); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        background: 'none',
                        border: 'none',
                        color: currentTheme.ui.text,
                        fontSize: '14px',
                        fontWeight: '600',
                        borderRadius: '12px',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <SettingsIcon size={18} strokeWidth={2.5} color={currentTheme.ui.textSecondary} />
                      <span>{t('settings')}</span>
                    </button>
                    <div style={{ height: '1px', backgroundColor: currentTheme.ui.borderLight, margin: '4px 8px', opacity: 0.4 }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLogoutRequest(); setIsMenuOpen(false); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        background: 'none',
                        border: 'none',
                        color: currentTheme.red,
                        fontSize: '14px',
                        fontWeight: '700',
                        borderRadius: '12px',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <Power size={18} strokeWidth={2.5} />
                      <span>{t('logout')}</span>
                    </button>
                  </div>
                </div>
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
