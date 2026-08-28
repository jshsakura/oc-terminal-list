/**
 * Shared git-status poller — one timer and one in-flight request per repo key,
 * however many components ask for it.
 *
 * Why this exists: TerminalHeader mounts one poller per pane and every tab's
 * PaneGrid stays mounted, so N panes meant N independent timers hitting
 * /api/git/status on their own offsets. Measured on this deployment it was 80%
 * of all HTTP traffic (380 of 470 requests in 40 minutes), every one riding the
 * shared Cloudflare tunnel that WS reconnects also depend on.
 *
 * A short result cache did not fix it: a cache only merges requests that land
 * inside its TTL, and independent timers drift apart within seconds. What has to
 * be shared is the *timer*, not the result.
 */
import { authHeaders } from './auth';
import { apiFetch } from './apiFetch';
import { einkPollMs } from './einkMode';

// A subscriber joining this soon after the last fetch reuses the result instead
// of firing its own (tab switches, remounts, split siblings on one repo).
export const GIT_STATUS_FRESH_MS = 2000;
// Idle entries kept around for instant delivery on remount, before pruning.
const MAX_IDLE_ENTRIES = 24;

/* Activity-driven refresh. A repo only changes when something writes to it, and
 * in this app that means the terminal ran something. So `touch()` refreshes when
 * the output *stops* — a build that finishes updates the badge ~2.5s later
 * instead of on the next clock tick, while an agent streaming for minutes keeps
 * pushing the timer out and costs nothing. The min gap keeps a chatty pane from
 * turning every pause into a request. */
export const GIT_ACTIVITY_SETTLE_MS = 2500;
export const GIT_ACTIVITY_MIN_GAP_MS = 20000;

export const gitStatusKey = (hostId, path) => (hostId ? `h:${hostId}:${path || ''}` : `l:${path || ''}`);

export const gitStatusUrl = (hostId, path) => {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return hostId ? `/api/hosts/${hostId}/git/status${qs}` : `/api/git/status${qs}`;
};

const defaultFetcher = async (hostId, path) => {
  const res = await apiFetch(gitStatusUrl(hostId, path), { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
};

const EMPTY_STATE = { data: null, error: null, ts: 0 };

/**
 * Factory so tests get an isolated store (the module singleton below is the
 * app's). `isHidden` is injected for the same reason.
 */
export const createGitStatusStore = ({
  fetcher = defaultFetcher,
  isHidden = () => (typeof document !== 'undefined' && document.hidden),
  now = () => Date.now(),
} = {}) => {
  const entries = new Map();

  const notify = (entry) => {
    entry.subs.forEach((sub) => {
      try { sub.onData(entry.state); } catch { /* one bad subscriber must not stop the rest */ }
    });
  };

  const runFetch = (entry) => {
    if (entry.inflight) return entry.inflight;
    const p = (async () => {
      try {
        const data = await fetcher(entry.hostId, entry.path);
        entry.state = { data, error: null, ts: now() };
      } catch (e) {
        // Keep the last good data — a transient failure must not blank the list.
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
    if (entry.settleTimer) { clearTimeout(entry.settleTimer); entry.settleTimer = null; }
    entry.periodMs = 0;
  };

  /** Period = the shortest interval any live subscriber asked for. */
  const retime = (entry) => {
    if (!entry.subs.size) { stopTimer(entry); return; }
    let period = Infinity;
    entry.subs.forEach((sub) => { if (sub.intervalMs > 0 && sub.intervalMs < period) period = sub.intervalMs; });
    if (!Number.isFinite(period)) { stopTimer(entry); return; }
    // 이북 모드에서는 그 주기를 늘린다. 배지 하나가 분당 16회 대신 4회 갱신되는 것은
    // 읽는 사람이 알아채지 못하지만, 전자잉크에서는 화면 갱신 12번의 차이다.
    period = einkPollMs(period);
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
      entry = {
        key, hostId, path, subs: new Set(), state: EMPTY_STATE,
        inflight: null, timer: null, settleTimer: null, periodMs: 0,
      };
      entries.set(key, entry);
    }
    return entry;
  };

  /**
   * "Something happened in this repo's terminal." Refreshes once the noise stops
   * (debounce), and only if the last fetch is old enough (throttle). Nobody
   * watching → nothing to do; the next subscriber fetches anyway.
   */
  const touch = ({ hostId = null, path = '' } = {}) => {
    const entry = entries.get(gitStatusKey(hostId, path));
    if (!entry || !entry.subs.size) return;
    if (entry.settleTimer) clearTimeout(entry.settleTimer);
    entry.settleTimer = setTimeout(() => {
      entry.settleTimer = null;
      if (!entry.subs.size || isHidden()) return;
      if (now() - entry.state.ts < GIT_ACTIVITY_MIN_GAP_MS) return;
      runFetch(entry);
    }, GIT_ACTIVITY_SETTLE_MS);
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

    // Hand over what we already have so a remount does not flash an empty list.
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

  return { subscribe, refresh, touch, peek, dispose, _entries: entries };
};

const store = createGitStatusStore();

export const subscribeGitStatus = store.subscribe;
export const refreshGitStatus = store.refresh;
export const touchGitStatus = store.touch;
export const peekGitStatus = store.peek;
export default store;
