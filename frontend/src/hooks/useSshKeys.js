import { useCallback, useEffect, useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const useSshKeys = (isAuthenticated) => {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return [];
    setLoading(true);
    try {
      const res = await fetch('/api/ssh-keys', { headers: authHeader() });
      if (!res.ok) return [];
      const data = await res.json();
      setKeys(data.items || []);
      return data.items || [];
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) refresh();
    else setKeys([]);
  }, [isAuthenticated, refresh]);

  const createKey = async ({ name, privateKey, passphrase, publicKey }) => {
    const res = await fetch('/api/ssh-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        name,
        private_key: privateKey,
        passphrase: passphrase || null,
        public_key: publicKey || null,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to add key');
    await refresh();
  };

  const deleteKey = async (id) => {
    const res = await fetch(`/api/ssh-keys/${id}`, { method: 'DELETE', headers: authHeader() });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to delete key');
    await refresh();
  };

  // 부분 업데이트. private_key 비어있으면 기존 키 유지 (write-once 정책).
  const updateKey = async (id, { name, privateKey, passphrase, publicKey, clearPassphrase }) => {
    const body = {};
    if (name !== undefined) body.name = name;
    if (publicKey !== undefined) body.public_key = publicKey;
    if (privateKey) body.private_key = privateKey;
    if (clearPassphrase) body.clear_passphrase = true;
    else if (passphrase) body.passphrase = passphrase;
    const res = await fetch(`/api/ssh-keys/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to update key');
    await refresh();
  };

  return { keys, loading, refresh, createKey, updateKey, deleteKey };
};

export default useSshKeys;
