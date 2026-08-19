/**
 * One live picture of every terminal, across every machine — shared by whoever asks.
 *
 * Why a store and not a hook-local fetch: the home screen can be mounted in more than
 * one place (the dashboard and an empty pane both render it), and every tab's PaneGrid
 * stays mounted. A per-component timer would multiply by mounts, and this particular
 * request is the expensive one — filling remote status costs **one SSH round trip per
 * host** on the backend. So the timer is shared, not the result.
 *
 * Why it polls at all: remote panes are invisible to the backend's tmux watcher (it can
 * only see this machine's sessions), so their status is "unknown" until someone asks.
 * Asking on the user's behalf is the whole point — the alternative is a board that
 * lies quietly.
 */
import { authHeaders } from './auth';
import { apiFetch } from './apiFetch';

// Slow on purpose. Every tick is one SSH connection per remote host, and a board of
// "who is working right now" is still useful at this resolution.
export const FLEET_POLL_MS = 30000;
// A subscriber arriving this soon after the last fetch reuses it instead of firing its
// own (tab switches, remounts, a second board on screen).
export const FLEET_FRESH_MS = 5000;
// Remote status costs SSH, so give it more room than the app's 15s default.
export const FLEET_TIMEOUT_MS = 25000;

// One sweep for the whole screen: pane statuses, when each session started, and each
// machine's own figures — all from a single SSH visit per host (routes/fleet.py).
export const FLEET_URL = '/api/fleet';

const defaultFetcher = async () => {
  const res = await apiFetch(FLEET_URL, { headers: authHeaders(), timeoutMs: FLEET_TIMEOUT_MS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return {
    targets: Array.isArray(body?.targets) ? body.targets : [],
    machines: Array.isArray(body?.machines) ? body.machines : [],
  };
};

/** Factory so tests get an isolated store; the module singleton below is the app's. */
export const createFleetStore = ({
  fetcher = defaultFetcher,
  isHidden = () => (typeof document !== 'undefined' && document.hidden),
  now = () => Date.now(),
  pollMs = FLEET_POLL_MS,
} = {}) => {
  const subscribers = new Set();
  let state = { targets: [], machines: [], error: null, loading: false, ts: 0 };
  let timer = null;
  let inFlight = null;

  const emit = () => {
    for (const fn of subscribers) fn(state);
  };

  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  const run = async () => {
    // One request at a time. Two boards mounting together must not become two SSH
    // fan-outs — the backend cost is per call, not per caller.
    if (inFlight) return inFlight;
    set({ loading: true });
    inFlight = (async () => {
      try {
        const { targets, machines } = await fetcher();
        set({ targets, machines, error: null, loading: false, ts: now() });
      } catch (e) {
        // Keep the last good picture. A blank board on one failed poll reads as
        // "everything stopped", which is worse than a slightly stale one.
        set({ error: e?.message || 'failed', loading: false, ts: now() });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const tick = () => {
    // Nothing to show and nobody looking — skip the round trip entirely rather than
    // keeping a hidden tab talking to every host.
    if (!subscribers.size || isHidden()) return;
    run();
  };

  const arm = () => {
    if (timer || !subscribers.size) return;
    timer = setInterval(tick, pollMs);
  };

  const disarm = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    getState: () => state,
    /** Force a fetch now, ignoring freshness — the refresh button. */
    refresh: () => run(),
    subscribe(fn) {
      subscribers.add(fn);
      fn(state);
      arm();
      if (!state.ts || (now() - state.ts) > FLEET_FRESH_MS) run();
      return () => {
        subscribers.delete(fn);
        if (!subscribers.size) disarm();
      };
    },
    /** Test seam: how many timers exist (must never exceed one). */
    _timerCount: () => (timer ? 1 : 0),
  };
};

export const fleetStore = createFleetStore();
export default fleetStore;
