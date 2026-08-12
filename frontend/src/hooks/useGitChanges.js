import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';
import { subscribeGitStatus, refreshGitStatus, touchGitStatus, peekGitStatus } from '../utils/gitStatusStore';

/**
 * Git changes hook.
 *
 * With hostId it reads the remote host API (/api/hosts/{hostId}/git/status),
 * otherwise the local one (/api/git/status).
 *
 * The polling itself belongs to **utils/gitStatusStore** — one timer and one
 * request per repo no matter how many panes watch it. This hook only subscribes
 * and maps the result into React state. (It used to own a setInterval per
 * instance, so panes in background tabs each polled on their own offset.)
 *
 * Anti-flicker rules:
 * - a cached value is delivered on subscribe, so no empty list flashes
 * - a failed refresh keeps the previous data and only fills in `error`
 * - the skeleton (`loading`) shows on first load only; later refreshes are quiet
 */

const useGitChanges = ({ enabled = false, intervalMs = 4000, path = '', hostId = null, activityPaneId = null } = {}) => {
  const [items, setItems] = useState([]);
  const [branch, setBranch] = useState(null);
  const [repo, setRepo] = useState(null);
  const [repos, setRepos] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // `refresh` must keep a stable identity: callers (TerminalHeader's panel
  // effect) list it as a dependency, so a new function on every path change
  // would re-run their effects too.
  const targetRef = useRef({ hostId, path });
  targetRef.current = { hostId, path };

  useEffect(() => {
    if (!enabled) return undefined;
    const cached = peekGitStatus({ hostId, path });
    setLoading(!cached.ts);
    if (!cached.ts) { setItems([]); setBranch(null); setRepo(null); setRepos([]); setError(null); }

    return subscribeGitStatus({
      hostId,
      path,
      intervalMs,
      onData: ({ data, error: err }) => {
        if (data) {
          setItems(data.items || []);
          setBranch(data.branch || null);
          setRepo(data.repo || null);
          setRepos(data.repos || []);
        }
        setError(err || data?.error || null);
        setLoading(false);
      },
    });
  }, [enabled, hostId, path, intervalMs]);

  /* The clock is only a floor. What actually changes a repo is the terminal
     writing to it, so this pane's output drives the refresh — the badge updates
     a couple of seconds after a command finishes instead of on the next tick,
     and idle panes cost nothing. */
  useEffect(() => {
    if (!enabled || !activityPaneId) return undefined;
    const onActivity = (e) => {
      if (e.detail?.paneId !== activityPaneId) return;
      touchGitStatus(targetRef.current);
    };
    window.addEventListener('iterm:activity', onActivity);
    return () => window.removeEventListener('iterm:activity', onActivity);
  }, [enabled, activityPaneId]);

  const refresh = useCallback(() => refreshGitStatus(targetRef.current), []);

  const fetchDiff = useCallback(async (filePath, staged = false) => {
    const hid = targetRef.current.hostId;
    const url = hid
      ? `/api/hosts/${hid}/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`
      : `/api/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  return { items, branch, repo, repos, error, loading, refresh, fetchDiff };
};

export default useGitChanges;
