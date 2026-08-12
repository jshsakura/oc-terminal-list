/**
 * Shared git-status poller — one timer and one in-flight request per repo key,
 * no matter how many components ask for it.
 *
 * Why this exists: TerminalHeader mounts one poller per pane and every tab's
 * PaneGrid stays mounted, so N panes meant N independent timers hitting
 * /api/git/status on their own offsets. Measured on this deployment it was 80%
 * of all HTTP traffic (380 of 470 requests in 40 minutes) — every one of them
 * riding the shared Cloudflare tunnel that WS reconnects also depend on.
 *
 * A short result cache did not help: it only dedupes requests that land inside
 * the TTL, and independent timers drift apart within seconds. Subscribers must
 * share the *timer*, not just the result.
 */
import { authHeaders } from './auth';

// A subscriber joining within this window of the last fetch reuses the result
// instead of firing its own request (tab switches, remounts, split siblings).
export const GIT_STATUS_FRESH_MS = 2000;
// Idle entries kept for instant delivery on remount before the cache is pruned.
const MAX_IDLE_ENTRIES = 24;

export const gitStatusKey = (hostId, path) => (hostId ? `h:${hostId}:${path || ''}` : `l:${path || ''}`);

export const gitStatusUrl = (hostId, path) => {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return hostId ? `/api/hosts/${hostId}/git/status${qs}` : `/api/git/status${qs}`;
};

const defaultFetcher = async (hostId, path) => {
  const res = await fetch(gitStatusUrl(hostId, path), { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
};

const EMPTY_STATE = { data: null, error: null, ts: 0 };

/**
 * Factory so tests get an isolated store (module singleton below is the app's).
 * `isHidden` is injected for the same reason.
 */
export const createGitStatusStore = ({
  fetcher = defaultFetcher,
  isHidden = () => (typeof document !== 'undefined' && document.hidden),
  now = () => Date.now(),
} = {}) => {
  const entries = new Map();

  const notify = (entry) => {
    entry.subs.forEach((sub) => {
      try { sub.onData(entry.state); } catch { /* a bad subscriber must not stop the others */ }
    });
  };

  const runFetch = (entry) => {
    if (entry.inflight) return entry.inflight;
    const p = (async () => {
      try {
        const data = await fetcher(entry.hostId, entry.path);
        entry.state = { data, error: null, ts: now() };
      } catch (e) {
        // Keep the last good data — a transient failure should not blank the list.
        entry.state = { data: entry.state.data, error: e?.message || 'git status failed', ts: now() };
      } finally {
        entry.inflight = null;
      }
      notify(entry);
    })();
    entry.inflight = p;
    return p;
  };

  const stopTimer = (entry) => {
    if (entry.timer) { clearInterval(entry.timer); entry.timer = null; }
    entry.periodMs = 0;
  };

  /** Timer period = the shortest interval any live subscriber asked for. */
  const retime = (entry) => {
    if (!entry.subs.size) { stopTimer(entry); return; }
    let period = Infinity;
    entry.subs.forEach((sub) => { if (sub.intervalMs > 0 && sub.intervalMs < period) period = sub.intervalMs; });
    if (!Number.isFinite(period)) { stopTimer(entry); return; }
    if (entry.periodMs === period && entry.timer) return;
    stopTimer(entry);
    entry.periodMs = period;
    entry.timer = setInterval(() => {
      // Hidden page: skip. The visibility listener refreshes on return.
      if (isHidden()) return;
      runFetch(entry);
    }, period);
  };

  const prune = () => {
    const idle = [...entries.values()].filter((e) => !e.subs.size);
    if (idle.length <= MAX_IDLE_ENTRIES) return;
    idle.sort((a, b) => a.state.ts - b.state.ts);
    idle.slice(0, idle.length - MAX_IDLE_ENTRIES).forEach((e) => entries.delete(e.key));
  };

  let visibilityBound = false;
  const onVisibility = () => {
    if (isHidden()) return;
    entries.forEach((entry) => { if (entry.subs.size) runFetch(entry); });
  };
  const bindVisibility = () => {
    if (visibilityBound || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  };

  const ensure = (key, hostId, path) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, hostId, path, subs: new Set(), state: EMPTY_STATE, inflight: null, timer: null, periodMs: 0 };
      entries.set(key, entry);
    }
    return entry;
  };

  /**
   * @returns unsubscribe fn
   */
  const subscribe = ({ hostId = null, path = '', intervalMs = 15000, onData }) => {
    const key = gitStatusKey(hostId, path);
    const entry = ensure(key, hostId || null, path || '');
    const sub = { intervalMs, onData };
    entry.subs.add(sub);
    bindVisibility();

    // Deliver what we already have so a remount does not flash empty.
    if (entry.state.ts) onData(entry.state);
    retime(entry);
    if (!entry.state.ts || now() - entry.state.ts > GIT_STATUS_FRESH_MS) {
      if (!isHidden()) runFetch(entry);
    }

    return () => {
      entry.subs.delete(sub);
      if (!entry.subs.size) { stopTimer(entry); prune(); } else retime(entry);
    };
  };

  /** Explicit user-driven refresh — coalesces with any in-flight request. */
  const refresh = ({ hostId = null, path = '' } = {}) => {
    const entry = ensure(gitStatusKey(hostId, path), hostId || null, path || '');
    return runFetch(entry);
  };

  const peek = ({ hostId = null, path = '' } = {}) => entries.get(gitStatusKey(hostId, path))?.state || EMPTY_STATE;

  const dispose = () => {
    entries.forEach(stopTimer);
    entries.clear();
    if (visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      visibilityBound = false;
    }
  };

  return { subscribe, refresh, peek, dispose, _entries: entries };
};

const store = createGitStatusStore();

export const subscribeGitStatus = store.subscribe;
export const refreshGitStatus = store.refresh;
export const peekGitStatus = store.peek;
export default store;
