import { lazy, Suspense, useEffect, useState } from 'react';
import useAuth from '../hooks/useAuth';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../hooks/useSettings';
import useTranslation from '../hooks/useTranslation';
import themes from '../styles/themes';
import { applyThemeVars } from '../styles/themeUI';
import { applyEinkAttribute, resolveEinkThemeId } from '../utils/einkMode';
import { documentWindowUrl } from '../utils/documentLinks';
import { parseFileKey } from './fileEditor/fileEditorHelpers';
import { authHeaders } from '../utils/auth';

const FileEditor = lazy(() => import('./FileEditor'));
const Login = lazy(() => import('./Login'));

export default function DocumentWindow() {
  const { isLoading, isAuthenticated, needsSetup, login } = useAuth();
  const [fileKey, setFileKey] = useState(() => new URLSearchParams(window.location.search).get('document') || '');
  const [settings, setSettings] = useState(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const { t } = useTranslation(settings.language);
  const theme = themes[resolveEinkThemeId(settings.theme, settings.einkMode)] || themes.catppuccin;
  useEffect(() => {
    applyThemeVars(theme);
    applyEinkAttribute(settings.einkMode === true);
  }, [theme, settings.einkMode]);
  useEffect(() => {
    document.title = `${parseFileKey(fileKey).path?.split('/').pop() || t('documentWindow')} — Terminal List`;
  }, [fileKey, t]);
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let cancelled = false;
    fetch('/api/user/settings', { headers: authHeaders() })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data?.settings) {
          setSettings((previous) => ({ ...previous, ...data.settings }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  const loading = <div role="status">{t('loading')}</div>;
  let content = loading;
  if (!isLoading) {
    if (needsSetup || !fileKey) {
      content = <a href="/">{t('openTerminalList')}</a>;
    } else if (!isAuthenticated) {
      content = <Login onLogin={login} theme={theme} language={settings.language} />;
    } else {
      content = <FileEditor
        activeFile={fileKey}
        openFiles={[fileKey]}
        onFileSelect={(path, hostId) => {
          const next = hostId ? `remote:${hostId}:${path}` : path;
          setFileKey(next);
          window.history.replaceState(null, '', documentWindowUrl(next));
        }}
        onClose={() => { setFileKey(''); window.close(); }}
        theme={theme}
        language={settings.language}
        standalone
      />;
    }
  }
  return <main style={{ position: 'fixed', inset: 0, background: theme.ui.bg, color: theme.ui.text, fontFamily: theme.ui.fontFamily }}>
    <Suspense fallback={loading}>{content}</Suspense>
  </main>;
}
