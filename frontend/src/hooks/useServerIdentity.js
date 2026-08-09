import { useEffect, useState } from 'react';

/**
 * Where this server actually runs — `{ hostname, ip, ip_kind }`, `ip_kind` being
 * `'tailscale' | 'lan' | ''`. Goes into the pane's copyable session handle so the
 * paste says *which machine* the tmux session lives on.
 *
 * It has to come from the backend. `window.location.hostname` is the address a human
 * opened in a browser: behind the Cloudflare tunnel that is a public web domain with
 * no SSH on it, and on a loopback deploy it is literally `localhost`. Either one sends
 * whoever receives the paste to the wrong box.
 *
 * Module-level cache, same reason as `useAppConfig` / `useLocalVncAvailable`: every
 * pane mounts this, and one request per pane is one request too many.
 */
const FALLBACK = { hostname: '', ip: '', ip_kind: '' };
let cached = null;
let inflight = null;

const fetchIdentity = () => {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/api/system/self')
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

const useServerIdentity = () => {
  const [identity, setIdentity] = useState(() => cached || FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetchIdentity().then((data) => {
      if (!cancelled) setIdentity(data);
    });
    return () => { cancelled = true; };
  }, []);
  return identity;
};

export default useServerIdentity;
