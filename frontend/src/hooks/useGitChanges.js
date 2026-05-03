import { useCallback, useEffect, useRef, useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const useGitChanges = ({ enabled = false, intervalMs = 4000, path = '' } = {}) => {
  const [items, setItems] = useState([]);
  const [branch, setBranch] = useState(null);
  const [repo, setRepo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const tickRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/git/status${path ? `?path=${encodeURIComponent(path)}` : ''}`;
      const res = await fetch(url, { headers: authHeader() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setItems(data.items || []);
      setBranch(data.branch || null);
      setRepo(data.repo || null);
      setError(data.error || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!enabled) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    refresh();
    tickRef.current = setInterval(refresh, intervalMs);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [enabled, intervalMs, refresh]);

  const fetchDiff = useCallback(async (path, staged = false) => {
    const url = `/api/git/diff?path=${encodeURIComponent(path)}&staged=${staged ? 'true' : 'false'}`;
    const res = await fetch(url, { headers: authHeader() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  return { items, branch, repo, error, loading, refresh, fetchDiff };
};

export default useGitChanges;
