import AppStyles from '../../styles/AppStyles';

const StatusBar = ({ sessions, activeSessionId, setActiveSessionId, onCloseSession, onNewSession, currentTheme }) => {
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
      <button
        type="button"
        onClick={onNewSession}
        title="New terminal"
        style={{
          ...styles.statusTab,
          border: `1px dashed ${currentTheme.ui.border}`,
          color: currentTheme.ui.textSecondary,
          fontWeight: 700,
          minWidth: '32px',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          height: '24px',
        }}
      >
        +
      </button>
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
              border: `1px solid ${isActive ? currentTheme.ui.accent : currentTheme.ui.borderLight}`,
              borderRadius: currentTheme.ui.radiusSmall || '2px',
              fontWeight: isActive ? '800' : '600',
              boxShadow: isActive ? `0 4px 12px ${currentTheme.ui.accent}66` : 'none',
              padding: '0 8px',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '12px' }}>{idx + 1}</span>
            {s.name ? (
              <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
            ) : null}
            {isActive && <span style={{ fontSize: '10px' }}>●</span>}
            {sessions.length > 1 && onCloseSession ? (
              <button
                type="button"
                title="Close terminal"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseSession(s.id);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: isActive ? currentTheme.ui.bg : currentTheme.ui.textSecondary,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 800,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default StatusBar;
