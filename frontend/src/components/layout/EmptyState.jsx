import { Plus } from 'lucide-react';
import AppStyles from '../../styles/AppStyles';

const EmptyState = ({ currentTheme, t, handleNewSession }) => {
  const styles = AppStyles;

  return (
    <div style={styles.emptyState}>
      <div style={{ ...styles.emptyIcon, color: currentTheme.ui.textSecondary }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M7 10l3 3-3 3" />
          <line x1="13" y1="16" x2="17" y2="16" />
        </svg>
      </div>
      <h2 style={{ ...styles.emptyTitle, color: currentTheme.ui.text }}>
        {t('noTerminals')}
      </h2>
      <p style={{ ...styles.emptyMessage, color: currentTheme.ui.textSecondary, opacity: 0.9 }}>
        {t('createFirstTerminal')}
      </p>
      <button 
        onClick={handleNewSession} 
        style={{ 
          ...styles.emptyButton, 
          backgroundColor: currentTheme.ui.accent, 
          color: currentTheme.ui.bg,
          boxShadow: `0 4px 15px ${currentTheme.ui.accent}44`
        }}
      >
        <Plus size={20} strokeWidth={3} />
        <span>{t('newSession')}</span>
      </button>
    </div>
  );
};

export default EmptyState;
