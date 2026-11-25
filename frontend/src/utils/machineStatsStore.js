import { apiFetch } from './apiFetch';
import { authHeaders } from './auth';
import { einkPollMs } from './einkMode';

export const MACHINE_STATS_POLL_MS = 2000;
export const MACHINE_STATS_TIMEOUT_MS = 8000;
export const MACHINE_STATS_HISTORY_MS = 5 * 60 * 1000;
export const MACHINE_STATS_HISTORY_LIMIT = 150;

const defaultFetcher = async (signal) => {
  const response = await apiFetch('/api/system/stats', { headers: authHeaders(), signal });
  if (!response.ok) {
    throw new Error('machine_stats_failed');
  }
  const stats = await response.json();
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    throw new Error('machine_stats_failed');
  }
  return stats;
};

const sampleNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const createMachineStatsStore = ({
  fetcher = defaultFetcher,
  isHidden = () => (typeof document !== 'undefined' && document.hidden),
  visibilityTarget = typeof document !== 'undefined' ? document : null,
  now = () => Date.now(),
  pollMs = MACHINE_STATS_POLL_MS,
  timeoutMs = MACHINE_STATS_TIMEOUT_MS,
} = {}) => {
  const subscribers = new Set();
  let state = { stats: null, history: [], updatedAt: null, error: false, refreshing: false };
  let timer = null;
  let pending = null;
  let initialAttempted = false;

  const publish = (patch) => {
    state = { ...state, ...patch };
    for (const subscriber of subscribers) {
      subscriber.listener(state);
    }
  };

  const hasMonitoring = () => [...subscribers].some((subscriber) => subscriber.monitoring);
  const canFetch = () => subscribers.size > 0 && !isHidden();
  const clearPoll = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stopRequest = () => {
    if (!pending) {
      return;
    }
    const request = pending;
    pending = null;
    clearTimeout(request.deadline);
    request.controller.abort();
    if (!state.stats) {
      initialAttempted = false;
    }
    publish({ refreshing: false });
  };

  const arm = () => {
    if (timer !== null || pending || !canFetch() || !hasMonitoring()) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      run();
    }, einkPollMs(pollMs));
  };

  const run = () => {
    if (!canFetch()) {
      return Promise.resolve();
    }
    if (pending) {
      return pending.promise;
    }
    clearPoll();
    initialAttempted = true;
    const controller = new AbortController();
    const request = { controller, monitoring: hasMonitoring(), deadline: null, promise: null };
    pending = request;
    const cancelled = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('machine_stats_cancelled')), { once: true });
    });
    request.deadline = setTimeout(() => controller.abort(), timeoutMs);
    publish({ refreshing: true });
    request.promise = (async () => {
      try {
        const stats = await Promise.race([fetcher(controller.signal), cancelled]);
        if (pending !== request || controller.signal.aborted || !canFetch()) {
          return;
        }
        const at = now();
        let history = state.history.filter((sample) => sample.at >= at - MACHINE_STATS_HISTORY_MS);
        if (request.monitoring && hasMonitoring()) {
          history = [...history, {
            at,
            cpu: sampleNumber(stats.cpu),
            ram: sampleNumber(stats.ram),
            disk: sampleNumber(stats.disk),
            net_rx_rate: sampleNumber(stats.net_rx_rate),
            net_tx_rate: sampleNumber(stats.net_tx_rate),
          }].slice(-MACHINE_STATS_HISTORY_LIMIT);
        }
        publish({ stats, history, updatedAt: at, error: false });
      } catch {
        if (pending === request && canFetch()) {
          publish({ error: true });
        }
      } finally {
        clearTimeout(request.deadline);
        if (pending === request) {
          pending = null;
          publish({ refreshing: false });
          arm();
        }
      }
    })();
    return request.promise;
  };

  const reconcile = () => {
    clearPoll();
    if (!canFetch()) {
      stopRequest();
      return;
    }
    if (pending?.monitoring && !hasMonitoring()) {
      stopRequest();
    }
    if (!initialAttempted || hasMonitoring()) {
      run();
    }
  };

  return {
    getState: () => state,
    refresh: run,
    subscribe(listener, { monitoring = false } = {}) {
      const subscriber = { listener, monitoring };
      subscribers.add(subscriber);
      if (subscribers.size === 1) {
        visibilityTarget?.addEventListener('visibilitychange', reconcile);
      }
      listener(state);
      if (!initialAttempted || (monitoring && !pending && timer === null)) {
        reconcile();
      }
      return () => {
        subscribers.delete(subscriber);
        if (!subscribers.size) {
          visibilityTarget?.removeEventListener('visibilitychange', reconcile);
        }
        if (!subscribers.size || !hasMonitoring()) {
          clearPoll();
          if (!subscribers.size || pending?.monitoring) {
            stopRequest();
          }
        }
      };
    },
  };
};

export const machineStatsStore = createMachineStatsStore();
export default machineStatsStore;
