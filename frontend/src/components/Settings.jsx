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
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        autoScroll: 'smart',
        smoothScroll: true,
        scrollSensitivity: 0.8,
      });
      onClose();
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, backgroundColor: currentTheme.ui.bg }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.header, borderBottomColor: currentTheme.ui.border }}>
          <h2 style={{ ...styles.title, color: currentTheme.ui.accent }}>{t('settingsTitle')}</h2>
          <button onClick={onClose} style={{ ...styles.closeBtn, color: currentTheme.ui.text }}>
            ✕
          </button>
        </div>

        <div style={styles.content}>
          {/* 사용자 정보 */}
          {username && (
            <div style={{ ...styles.section, ...styles.userSection }}>
              <label style={{ ...styles.label, color: currentTheme.ui.textSecondary }}>{t('user')}</label>
              <div style={{ ...styles.userValue, color: currentTheme.ui.accent, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border }}>
                {username}
              </div>
            </div>
          )}

          {/* 테마 선택 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('theme')}</label>
            <select
              value={localSettings.theme}
              onChange={(e) => handleChange('theme', e.target.value)}
              style={{ ...styles.select, backgroundColor: currentTheme.ui.bgTertiary, color: currentTheme.ui.text, borderColor: currentTheme.ui.border }}
            >
              {themeNames.map((name) => {
                // 테마 이름을 번역 키로 변환 (예: catppuccin → themeCatppuccin)
                const themeKey = `theme${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                return (
                  <option key={name} value={name}>
                    {t(themeKey)}
                  </option>
                );
              })}
            </select>
          </div>

          {/* 언어 선택 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('language')}</label>
            <select
              value={localSettings.language}
              onChange={(e) => handleChange('language', e.target.value)}
              style={{ ...styles.select, backgroundColor: currentTheme.ui.bgTertiary, color: currentTheme.ui.text, borderColor: currentTheme.ui.border }}
            >
              <option value="en">{t('languageEnglish')}</option>
              <option value="ko">{t('languageKorean')}</option>
            </select>
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
              style={{ ...styles.input, backgroundColor: currentTheme.ui.bgTertiary, color: currentTheme.ui.text, borderColor: currentTheme.ui.border }}
            />
          </div>

          {/* 자동 스크롤 */}
          <div style={styles.section}>
            <label style={{ ...styles.label, color: currentTheme.ui.text }}>{t('autoScroll')}</label>
            <select
              value={localSettings.autoScroll}
              onChange={(e) => handleChange('autoScroll', e.target.value)}
              style={{ ...styles.select, backgroundColor: currentTheme.ui.bgTertiary, color: currentTheme.ui.text, borderColor: currentTheme.ui.border }}
            >
              <option value="always">Always (항상)</option>
              <option value="smart">Smart (AI 대응)</option>
              <option value="never">Never (수동)</option>
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
              Scroll Sensitivity (AI 스트리밍): {localSettings.scrollSensitivity.toFixed(1)}
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
              높을수록 사용자 스크롤에 민감하게 반응 (AI 채팅 최적화)
            </small>
          </div>
        </div>

        <div style={{ ...styles.footer, borderTopColor: currentTheme.ui.border }}>
          <button onClick={handleReset} style={{ ...styles.resetBtn, backgroundColor: currentTheme.red, color: currentTheme.ui.bg }}>
            {t('reset')}
          </button>
          <div style={styles.buttonGroup}>
            <button onClick={onClose} style={{ ...styles.cancelBtn, backgroundColor: currentTheme.brightBlack, color: currentTheme.ui.text }}>
              {t('cancel')}
            </button>
            <button onClick={handleSave} style={{ ...styles.saveBtn, backgroundColor: currentTheme.green, color: currentTheme.ui.bg }}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  modal: {
    backgroundColor: '#1e1e2e',
    borderRadius: '2px',
    width: '90%',
    maxWidth: '650px',
    maxHeight: '85vh',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #313244',
  },
  title: {
    margin: 0,
    color: '#89b4fa',
    fontSize: '20px',
    fontWeight: '600',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#cdd6f4',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0',
    width: '30px',
    height: '30px',
  },
  content: {
    padding: '20px',
  },
  section: {
    marginBottom: '20px',
  },
  userSection: {
    paddingBottom: '20px',
    borderBottom: '1px solid #313244',
  },
  userValue: {
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: '600',
    borderRadius: '4px',
    border: '1px solid',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    color: '#cdd6f4',
    fontSize: '14px',
    fontWeight: '500',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: '4px',
    fontSize: '14px',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: '4px',
    fontSize: '14px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#cdd6f4',
    fontSize: '14px',
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    marginTop: '8px',
  },
  hint: {
    display: 'block',
    marginTop: '4px',
    color: '#6c7086',
    fontSize: '12px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderTop: '1px solid #313244',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
  },
  saveBtn: {
    padding: '8px 16px',
    backgroundColor: '#a6e3a1',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '8px 16px',
    backgroundColor: '#585b70',
    color: '#cdd6f4',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  resetBtn: {
    padding: '8px 16px',
    backgroundColor: '#f38ba8',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};

export default Settings;
