import AppStyles from '../../styles/AppStyles';

const LoadingScreen = ({ currentTheme, t }) => {
  const styles = AppStyles;

  return (
    <div style={{ ...styles.loadingContainer, backgroundColor: currentTheme.ui.bg }}>
      <h1 style={{
        ...styles.loadingLogo,
        color: currentTheme.ui.accent
      }}>{t('appName')}</h1>
      <p style={{ ...styles.loadingText, color: currentTheme.ui.textSecondary }}>{t('loading')}</p>
    </div>
  );
};

export default LoadingScreen;
