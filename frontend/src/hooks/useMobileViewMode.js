import { useCallback, useState } from 'react';

const STORAGE_KEY = 'iterm:mobileViewOnly';

// Keep this preference on this device, independently of synced app settings.
export default function useMobileViewMode() {
  const [viewOnly, setViewOnly] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
  });
  const changeViewOnly = useCallback((value) => {
    setViewOnly(value);
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Private browsing. */ }
  }, []);
  return [viewOnly, changeViewOnly];
}
