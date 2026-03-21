import AppStyles from '../../styles/AppStyles';

const StatusBar = ({ sessions, activeSessionId, setActiveSessionId, currentTheme }) => {
  const styles = AppStyles;

  if (sessions.length === 0) return null;

  return (
    <div style={{
      ...styles.statusBar,
      backgroundColor: currentTheme.ui.glassBg || 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(16px) saturate(180%)',
      bottom: '52px', // MobileToolbar 바로 위
      border: `1px solid ${currentTheme.ui.borderLight || 'rgba(255,255,255,0.1)'}`,
      borderRadius: currentTheme.ui.radius || '4px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    }}>
      <style>{`
        div::-webkit-scrollbar { display: none; }
      `}</style>
      {sessions.map((s, idx) => {
        const isActive = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            style={{
              ...styles.statusTab,
              backgroundColor: isActive ? currentTheme.ui.accent : 'transparent',
              color: isActive ? currentTheme.ui.bg : currentTheme.ui.textSecondary,
              borderRadius: currentTheme.ui.radiusSmall || '2px',
              fontWeight: isActive ? '800' : '600',
              boxShadow: isActive ? `0 4px 12px ${currentTheme.ui.accent}66` : 'none',
            }}
          >
            <span style={{ opacity: 0.7, marginRight: '4px' }}>{idx}</span>
            {s.name || 'bash'}{isActive ? ' ●' : ''}
          </div>
        );
      })}
    </div>
  );
};

export default StatusBar;
