import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth';

const useSnippets = (enabled = false) => {
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/snippets', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnippets(await res.json());
    } catch { /* 무시 — 이전 목록 유지 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);

  const create = useCallback(async ({ name, command, tags = '', sort_index = 0 }) => {
    const res = await fetch('/api/snippets', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, command, tags, sort_index }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created = await res.json();
    setSnippets((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id, fields) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }, []);

  const remove = useCallback(async (id) => {
    const res = await fetch(`/api/snippets/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { snippets, loading, refresh, create, update, remove };
};

export default useSnippets;
