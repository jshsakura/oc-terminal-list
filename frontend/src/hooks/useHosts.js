import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * 저장된 SSH 호스트 목록을 관리하는 훅.
 *
 * 호스트는 "저장된 연결 템플릿"이고, 활성 연결(=세션)은 별개로 관리한다.
 * 호스트를 더블클릭/엔터하면 호스트와 결합된 새 세션이 만들어지고,
 * 그 세션은 /ws/host/{hostId} 로 연결된다.
 */
const useHosts = (isAuthenticated) => {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return [];
    setLoading(true);
    try {
      const res = await fetch('/api/hosts', { headers: authHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.items || [];
      setHosts(items);
      return items;
    } catch (e) {
      console.error('fetch hosts failed', e);
      return [];
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) refresh();
    else setHosts([]);
  }, [isAuthenticated, refresh]);

  const createHost = async (payload) => {
    const res = await fetch('/api/hosts', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to create host');
    const data = await res.json();
    await refresh();
    return data.id;
  };

  const updateHost = async (id, payload) => {
    const res = await fetch(`/api/hosts/${id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to update host');
    await refresh();
  };

  const deleteHost = async (id) => {
    const res = await fetch(`/api/hosts/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to delete host');
    await refresh();
  };

  return { hosts, loading, refresh, createHost, updateHost, deleteHost };
};

export default useHosts;
