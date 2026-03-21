/**
 * Settings 컴포넌트
 * 테마, 언어, 스크롤 동작 등 설정
 */
import { useState } from 'react';
import { themeNames } from '../styles/themes';
import useTranslation from '../hooks/useTranslation';

const Settings = ({ isOpen, onClose, settings, onSave, theme, username }) => {
  const { t } = useTranslation(settings.language);
  const [localSettings, setLocalSettings] = useState(settings);

  if (!isOpen) return null;

  // 기본 테마 (theme prop이 없을 경우 Catppuccin 사용)
  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      bgTertiary: '#313244',
      border: '#313244',
      text: '#cdd6f4',
      textSecondary: '#6c7086',
      accent: '#89b4fa',
      radius: '12px',
      radiusSmall: '8px',
    },
    green: '#a6e3a1',
    red: '#f38ba8',
    brightBlack: '#585b70',
  };

  const handleChange = (key, value) => {
    setLocalSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleReset = () => {
    if (confirm(t('reset'))) {
      onSave({
        theme: 'catppuccin',
        language: 'en',
        fontSize: 14,
        fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace',
        autoScroll: 'smart',
        smoothScroll: true,
        scrollSensitivity: 0.8,
      });
      onClose();
    }
  };

  const inputStyle = {
    ...styles.input,
    backgroundColor: currentTheme.ui.bgSecondary,
    color: currentTheme.ui.text,
    borderColor: currentTheme.ui.border,
    borderRadius: currentTheme.ui.radiusSmall,
  };

  const selectStyle = {
    ...styles.select,
    backgroundColor: currentTheme.ui.bgSecondary,
    color: currentTheme.ui.text,
    borderColor: currentTheme.ui.border,
    borderRadius: currentTheme.ui.radiusSmall,
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ 
        ...styles.modal, 
        backgroundColor: currentTheme.ui.glassBg || currentTheme.ui.bg,
        backdropFilter: 'blur(20px)',
        borderRadius: currentTheme.ui.radius,
        border: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.header, borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
          <h2 style={{ ...styles.title, color: currentTheme.ui.accent }}>{t('settingsTitle')}</h2>
          <button onClick={onClose} style={{ ...styles.closeBtn, color: currentTheme.ui.text }}>
            ✕
          </button>
        </div>

        <div style={styles.content}>
          {/* 사용자 정보 */}
          {username && (
            <div style={{ ...styles.section, ...styles.userSection, borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
              <label style={{ ...styles.label, color: currentTheme.ui.textSecondary }}>{t('user')}</label>
              <div style={{ 
                ...styles.userValue, 
                color: currentTheme.ui.accent, 
                backgroundColor: currentTheme.ui.cardBg || currentTheme.ui.bgTertiary, 
                borderColor: currentTheme.ui.borderLight || currentTheme.ui.border,
                borderRadius: currentTheme.ui.radiusSmall
              }}>
                {username}
              </div>
            </div>
          )}

          {/* 테마와 언어를 한 줄로 */}
          <div style={styles.row}>
            <div style={styles.rowItem}>
              <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('theme')}</label>
              <select
                value={localSettings.theme}
                onChange={(e) => handleChange('theme', e.target.value)}
                style={selectStyle}
              >
                {themeNames.map((name) => {
                  const themeKey = `theme${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                  return (
                    <option key={name} value={name}>
                      {t(themeKey) || name}
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={styles.rowItem}>
              <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('language')}</label>
              <select
                value={localSettings.language}
                onChange={(e) => handleChange('language', e.target.value)}
                style={selectStyle}
              >
                <option value="en">{t('languageEnglish')}</option>
                <option value="ko">{t('languageKorean')}</option>
              </select>
            </div>
          </div>

          {/* 폰트 크기 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('fontSize')}</label>
            <input
              type="number"
              min="10"
              max="24"
              value={localSettings.fontSize}
              onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
              style={inputStyle}
            />
          </div>

          {/* 자동 스크롤 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('autoScroll')}</label>
            <select
              value={localSettings.autoScroll}
              onChange={(e) => handleChange('autoScroll', e.target.value)}
              style={selectStyle}
            >
              <option value="always">Always</option>
              <option value="smart">Smart (AI)</option>
              <option value="never">Manual</option>
            </select>
          </div>

          {/* 부드러운 스크롤 */}
          <div style={styles.section}>
            <label style={{ ...styles.checkboxLabel, color: currentTheme.ui.text }}>
              <input
                type="checkbox"
                checked={localSettings.smoothScroll}
                onChange={(e) => handleChange('smoothScroll', e.target.checked)}
                style={styles.checkbox}
              />
              {t('smoothScroll')}
            </label>
          </div>

          {/* 스크롤 민감도 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>
              {t('scrollSensitivity')}: {localSettings.scrollSensitivity.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={localSettings.scrollSensitivity}
              onChange={(e) => handleChange('scrollSensitivity', parseFloat(e.target.value))}
              style={styles.slider}
            />
            <small style={{ ...styles.hint, color: currentTheme.ui.textSecondary }}>
              {t('scrollSensitivityHint')}
            </small>
          </div>
        </div>

        <div style={{ ...styles.footer, borderTopColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
          <button onClick={handleReset} style={{ 
            ...styles.resetBtn, 
            backgroundColor: 'rgba(243, 139, 168, 0.1)', 
            color: currentTheme.red,
            border: `1px solid ${currentTheme.red}44`,
            borderRadius: currentTheme.ui.radiusSmall
          }}>
            {t('reset')}
          </button>
          <div style={styles.buttonGroup}>
            <button onClick={onClose} style={{ 
              ...styles.cancelBtn, 
              backgroundColor: currentTheme.ui.bgTertiary, 
              color: currentTheme.ui.text,
              borderRadius: currentTheme.ui.radiusSmall
            }}>
              {t('cancel')}
            </button>
            <button onClick={handleSave} style={{ 
              ...styles.saveBtn, 
              backgroundColor: currentTheme.ui.accent, 
              color: currentTheme.ui.bg,
              borderRadius: currentTheme.ui.radiusSmall,
              boxShadow: `0 4px 15px ${currentTheme.ui.accent}44`
            }}>
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(8px)',
  },
  modal: {
    width: '90%',
    maxWidth: '500px',
    maxHeight: '85vh',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    letterSpacing: '0.5px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  content: {
    padding: '24px',
    overflowY: 'auto',
  },
  section: {
    marginBottom: '20px',
  },
  row: {
    display: 'flex',
    gap: '16px',
    marginBottom: '20px',
  },
  rowItem: {
    flex: 1,
  },
  userSection: {
    paddingBottom: '20px',
    borderBottom: '1px solid',
  },
  userValue: {
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: '700',
    border: '1px solid',
    fontFamily: '"JetBrains Mono", monospace',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '13px',
    fontWeight: '600',
    opacity: 0.9,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid',
    fontSize: '14px',
    outline: 'none',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    marginTop: '10px',
    cursor: 'pointer',
  },
  hint: {
    display: 'block',
    marginTop: '6px',
    fontSize: '11px',
    opacity: 0.7,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderTop: '1px solid',
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
  },
  saveBtn: {
    padding: '10px 20px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  cancelBtn: {
    padding: '10px 20px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  resetBtn: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default Settings;
