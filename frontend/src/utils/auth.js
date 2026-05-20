const LEGACY_AUTH_TOKEN_KEY = 'auth_token';
const LEGACY_USERNAME_KEY = 'username';

let volatileAuthToken = null;

export const getLegacyAuthToken = () => {
  try {
    const token = localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)?.trim();
    if (!token || token === 'null' || token === 'undefined') return null;
    return token;
  } catch {
    return null;
  }
};

export const setVolatileAuthToken = (token) => {
  const clean = typeof token === 'string' ? token.trim() : '';
  volatileAuthToken = clean && clean !== 'null' && clean !== 'undefined' ? clean : null;
};

export const clearVolatileAuthToken = () => {
  volatileAuthToken = null;
};

export const authHeaders = (headers = {}) => {
  const token = getLegacyAuthToken() || volatileAuthToken;
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
};

export const clearLegacyAuthStorage = () => {
  try {
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USERNAME_KEY);
  } catch {
    // storage may be unavailable in private/browser-restricted contexts.
  }
};

export const clearAuthFallbacks = () => {
  clearLegacyAuthStorage();
  clearVolatileAuthToken();
};
