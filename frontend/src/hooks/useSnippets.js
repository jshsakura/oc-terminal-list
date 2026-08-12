import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * Snippet list — **the whole app shares one.**
 *
 * PaneGrid mounts once per tab and every tab stays mounted, so back when each
 * instance fetched for itself, boot fired GET /api/snippets as many times as
 * there were tabs (measured: 14 inside one second) to receive the same global
 * list each time. Lifting the store to module level makes it one request.
 */

const STALE_MS = 60_000;

const state = { list: [], ts: 0 };
let inflight = null;
const subscribers = new Set();

const notify = () => {
  subscribers.forEach((fn) => {
    try { fn(state.list); } catch { /* one bad subscriber must not stop the rest */ }
  });
};

const setList = (next) => {
  state.list = next;
  state.ts = Date.now();
  notify();
};

const load = (force = false) => {
  if (inflight) return inflight;
  if (!force && state.ts && Date.now() - state.ts < STALE_MS) return Promise.resolve(state.list);
  inflight = (async () => {
    try {
      const res = await fetch('/api/snippets', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setList(await res.json());
    } catch { /* ignore — keep the old list. No ts stamp, so the next mount retries */ }
    finally { inflight = null; }
    return state.list;
  })();
  return inflight;
};

/** Test helper — clears the module cache. */
export const _resetSnippetsStore = () => {
  state.list = [];
  state.ts = 0;
  inflight = null;
  subscribers.clear();
};

const useSnippets = (enabled = false) => {
  const [snippets, setSnippets] = useState(state.list);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    subscribers.add(setSnippets);
    setSnippets(state.list);
    const needsFetch = !state.ts || Date.now() - state.ts >= STALE_MS;
    if (needsFetch) {
      setLoading(true);
      load().finally(() => setLoading(false));
    }
    return () => { subscribers.delete(setSnippets); };
  }, [enabled]);

  const refresh = useCallback(() => load(true), []);

  const create = useCallback(async ({ name, command, tags = '', sort_index = 0 }) => {
    const res = await fetch('/api/snippets', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, command, tags, sort_index }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created = await res.json();
    setList([...state.list, created]);
    return created;
  }, []);

  const update = useCallback(async (id, fields) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setList(state.list.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }, []);

  const remove = useCallback(async (id) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setList(state.list.filter((s) => s.id !== id));
  }, []);

  return { snippets, loading, refresh, create, update, remove };
};

export default useSnippets;
