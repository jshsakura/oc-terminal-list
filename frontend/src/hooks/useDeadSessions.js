import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

/**
 * Rows in the session table whose tmux session is gone.
 *
 * Why this exists: closing a tab kills its tmux session, but the DB row stays — nothing ever
 * deleted it. On this box that had grown to 45 dead rows out of 48, the oldest three months
 * old. They are harmless (`/api/sessions` cross-checks tmux and marks `alive`), so nobody
 * noticed; that is exactly why it needs a number on screen rather than a background job.
 *
 * ⚠️ `null` means "could not tell", never zero. An empty tmux list is also what a stopped
 * tmux server looks like, and the server refuses to prune on that reading — see the prune
 * route. Rendering unknown as "0 dead" would be the screen lying quietly.
 *
 * Fetches once when it becomes visible, and after a prune. No timer: dead rows do not appear
 * on their own while you are looking at the home screen (a tab has to close first), and this
 * repo has paid for per-mount pollers before.
 */
const useDeadSessions = (isVisible = true) => {
  const [count, setCount] = useState(null);
  const [pruning, setPruning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sessions');
      if (!res.ok) { setCount(null); return; }
      const rows = await res.json();
      if (!Array.isArray(rows)) { setCount(null); return; }
      // `alive` is the server's cross-check against tmux. If it never sent the field we do
      // not get to guess — that is the unknown case, not "all alive".
      if (rows.some((r) => typeof r?.alive !== 'boolean')) { setCount(null); return; }
      setCount(rows.filter((r) => !r.alive).length);
    } catch {
      setCount(null);
    }
  }, []);

  useEffect(() => {
    if (isVisible) refresh();
  }, [isVisible, refresh]);

  const prune = useCallback(async () => {
    setPruning(true);
    try {
      const res = await apiFetch('/api/sessions/prune', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `${res.status}`);
      await refresh();
      return data?.removed ?? 0;
    } finally {
      setPruning(false);
    }
  }, [refresh]);

  return { count, pruning, prune, refresh };
};

export default useDeadSessions;
