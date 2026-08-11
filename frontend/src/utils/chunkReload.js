/**
 * A deploy deletes the previous build's hashed chunks (`emptyOutDir: true`), so a tab
 * still running the old bundle — or one whose service-worker cache mixes generations —
 * throws when it lazy-loads a module. Reloading fixes it; sitting there does not.
 *
 * The decision lives here (pure, tested) and the boundaries do the reload, because
 * `window.location.reload()` is untestable in jsdom while this is the part that has
 * the rules: which errors qualify, and the once-per-30s latch that keeps a persistent
 * failure from reload-looping the app into never booting.
 */

/* Wording differs per browser, and matching only one means Safari/Firefox fail
   silently. The MIME line is the service-worker/proxy case: something answered the
   chunk request with an HTML shell instead of 404. */
const CHUNK_ERROR_HINTS = [
  'dynamically imported module',      // Chrome/Vite
  'Loading chunk',                    // webpack family
  'Importing a module script failed', // Safari
  'error loading dynamically imported module',
  'is not a valid JavaScript MIME type',
  'Expected a JavaScript module script',
];

export const RELOAD_GUARD_KEY = 'iterm-chunk-reload-at';
export const RELOAD_GUARD_MS = 30 * 1000;

export const isChunkLoadError = (error) => {
  const message = error?.message || '';
  return CHUNK_ERROR_HINTS.some((hint) => message.includes(hint));
};

const defaultStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // private mode / blocked storage
  }
};

/**
 * True when the caller should reload the page for this error — and the guard is
 * stamped, so a second boundary catching the same broken deploy does not reload again.
 * Storage being unavailable must not block recovery: the reload still happens, it just
 * loses the loop protection (`LazyErrorBoundary` and `PaneErrorBoundary` share the key).
 */
export const claimChunkReload = (error, { storage = defaultStorage(), now = Date.now() } = {}) => {
  if (!isChunkLoadError(error)) return false;
  try {
    // No stamp means "never reloaded" — an absent guard must not read as a recent one.
    const last = Number(storage?.getItem(RELOAD_GUARD_KEY)) || 0;
    if (last && now - last < RELOAD_GUARD_MS) return false; // just reloaded — again loops
    storage?.setItem(RELOAD_GUARD_KEY, String(now));
  } catch { /* proceed without the guard */ }
  return true;
};
