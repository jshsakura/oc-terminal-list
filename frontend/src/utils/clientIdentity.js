const CLIENT_ID_KEY = 'iterm:client-id';

const randomId = () => {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getTerminalClientId = () => {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const next = randomId();
    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return randomId();
  }
};

export const getNetworkSummary = () => {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return '';
  const parts = [c.effectiveType, c.type].filter(Boolean);
  return parts.join('/');
};
