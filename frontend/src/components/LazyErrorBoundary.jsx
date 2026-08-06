import { Component } from 'react';

/* Wording differs per browser when a chunk was deleted by a deploy. Matching only one
   of these means Safari/Firefox fail silently. */
const CHUNK_ERROR_HINTS = [
  'dynamically imported module',      // Chrome/Vite
  'Loading chunk',                    // webpack family
  'Importing a module script failed', // Safari
  'error loading dynamically imported module',
];
const RELOAD_GUARD_KEY = 'iterm-chunk-reload-at';
const RELOAD_GUARD_MS = 30 * 1000;

/**
 * Boundary for lazy modals.
 *
 * **One failure must not kill it forever.** The previous version rendered `null` for
 * good once `hasError` was set — and since every modal shares this one boundary, a
 * single 404'd chunk meant that for the rest of the session neither settings nor any
 * confirm dialog would ever appear again (the "clicking settings does nothing" bug).
 * The next open has to try again: changing `resetKey` (i.e. what is open) clears it.
 *
 * A 404'd chunk is fixed by reloading, but that happens **once**. If the condition
 * persists, reloading repeats forever and the app never boots — hence a 30s guard.
 */
class LazyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    const msg = error?.message || '';
    if (!CHUNK_ERROR_HINTS.some((hint) => msg.includes(hint))) return;
    if (typeof window === 'undefined') return;
    try {
      const last = Number(window.sessionStorage?.getItem(RELOAD_GUARD_KEY) || 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return;   // just reloaded — doing it again loops
      window.sessionStorage?.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch { /* private mode etc. — proceed without the guard */ }
    window.location.reload();
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    if (prevProps.resetKey === this.props.resetKey) return;
    // Start the next attempt clean so one failure does not set permanently.
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default LazyErrorBoundary;
