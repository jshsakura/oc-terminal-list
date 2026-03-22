/**
 * Settings 컴포넌트
 * 테마, 언어, 스크롤 동작 등 설정
 */
import { useEffect, useState } from 'react';
import { themeNames } from '../styles/themes';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';
import { X } from 'lucide-react';
import { DEFAULT_TERMINAL_FONT_FAMILY } from '../utils/terminalFonts';

const Settings = ({ isOpen, onClose, settings, onSave, theme, username }) => {
  const { t } = useTranslation(settings.language);
  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  if (!isOpen) return null;

  const currentTheme = theme;

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
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        defaultShell: 'bash',
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
        backdropFilter: 'blur(30px) saturate(180%)',
        borderRadius: currentTheme.ui.radius || '8px',
        border: `1px solid ${currentTheme.ui.border}`,
        boxShadow: currentTheme.ui.shadow,
        position: 'relative',
        overflow: 'hidden'
      }} onClick={(e) => e.stopPropagation()}>
        {/* Inner Highlight for Skeuomorphism */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          backgroundColor: 'rgba(255,255,255,0.05)',
          pointerEvents: 'none',
          zIndex: 10
        }} />
        <div style={{ 
          ...styles.header, 
          backgroundColor: currentTheme.ui.bgSecondary,
          borderBottom: `1px solid ${currentTheme.ui.border}`
        }}>
          <h2 style={{ ...styles.title, color: currentTheme.ui.accent }}>{t('settingsTitle')}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} theme={currentTheme} icon={X} />
        </div>

        <div style={styles.content}>
          <div style={{ ...styles.row, ...styles.userSection, borderBottomColor: currentTheme.ui.borderLight || currentTheme.ui.border }}>
            {username && (
              <div style={styles.rowItem}>
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

            <div style={styles.rowItem}>
              <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('defaultShell')}</label>
              <select
                value={localSettings.defaultShell || 'bash'}
                onChange={(e) => handleChange('defaultShell', e.target.value)}
                style={selectStyle}
              >
                <option value="bash">{t('shellBash')}</option>
                <option value="zsh">{t('shellZsh')}</option>
                <option value="sh">{t('shellSh')}</option>
                <option value="auto">{t('shellAuto')}</option>
              </select>
            </div>
          </div>

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
          <Button 
            variant="danger" 
            onClick={handleReset} 
            theme={currentTheme}
          >
            {t('reset')}
          </Button>
          <div style={styles.buttonGroup}>
            <Button 
              variant="secondary"
              onClick={onClose} 
              theme={currentTheme}
            >
              {t('cancel')}
            </Button>
            <Button 
              variant="primary" 
              onClick={handleSave} 
              theme={currentTheme}
            >
              {t('save')}
            </Button>
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
    padding: '12px 20px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '800',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  content: {
    padding: '20px',
    overflowY: 'auto',
  },
  section: {
    marginBottom: '16px',
  },
  row: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  rowItem: {
    flex: 1,
  },
  userSection: {
    paddingBottom: '16px',
    borderBottom: '1px solid',
  },
  userValue: {
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: '700',
    border: '1px solid',
    fontFamily: '"JetBrains Mono", monospace',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '12px',
    fontWeight: '700',
    opacity: 0.8,
    textTransform: 'uppercase',
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid',
    fontSize: '13px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid',
    fontSize: '13px',
    outline: 'none',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    marginTop: '8px',
    cursor: 'pointer',
  },
  hint: {
    display: 'block',
    marginTop: '4px',
    fontSize: '11px',
    opacity: 0.7,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderTop: '1px solid',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
  },
};

export default Settings;
