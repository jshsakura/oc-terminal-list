import { useEffect, useState } from 'react';

/**
 * Public server config — fetched **once for the whole app** right after boot.
 *
 *  - local_disabled: true hides "this machine" (the local terminal). Container mode.
 *  - tmux_socket: the socket local sessions live on. The copy handle needs it to build
 *    a working attach command.
 *
 * Cached at module level: calling this hook per pane would fire one request per pane.
 * On failure it falls back to safe defaults and retries on the next mount.
 */
const FALLBACK = { local_disabled: false, tmux_socket: '' };
let cached = null;
let inflight = null;

const fetchConfig = () => {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/api/config')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cached = { ...FALLBACK, ...data };
      return cached;
    })
    .catch(() => FALLBACK)          // not cached — the next mount tries again
    .finally(() => { inflight = null; });
  return inflight;
};

const useAppConfig = () => {
  const [config, setConfig] = useState(() => (cached ? { ...cached, loaded: true } : { ...FALLBACK, loaded: false }));
  useEffect(() => {
    let cancelled = false;
    fetchConfig().then((data) => {
      if (!cancelled) setConfig({ ...data, loaded: true });
    });
    return () => { cancelled = true; };
  }, []);
  return config;
};

export default useAppConfig;
