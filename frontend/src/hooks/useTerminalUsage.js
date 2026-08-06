import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * Terminal usage stats (`/api/usage/summary`).
 *
 * Lifted out of the tile component: **the home has to know who is loading** so the
 * head (the range switch) can render as one skeleton with the cards below it. When
 * only the bottom half knows, the top stands there finished and the page looks
 * half-drawn.
 *
 * Module-level cache (60s) — the home and the empty-pane home can mount at once and
 * still make a single request. With a warm cache the first render already has data,
 * so the skeleton never flashes.
 *
 * @returns {{ data: object|null, loading: boolean }}
 */
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export default function useTerminalUsage(days) {
  const [data, setData] = useState(() => _cache.get(days)?.data || null);
  const [loading, setLoading] = useState(() => !_cache.get(days));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(() => {
    const cached = _cache.get(days);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/usage/summary?days=${days}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        _cache.set(days, { data: d, ts: Date.now() });
        if (alive.current) setData(d);
      })
      .catch(() => { /* missing stats must never break the home */ })
      .finally(() => { if (alive.current) setLoading(false); });
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return { data, loading };
}
