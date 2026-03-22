import { useState, useEffect, useCallback } from 'react';
import { generateUUID } from '../utils/helpers';

const useSessionManager = (isAuthenticated) => {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  const fetchSessions = useCallback(async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch('/api/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const mapped = data.map(s => ({ id: s.id, name: s.name, cwd: s.cwd }));
      setSessions(mapped);
      return mapped;
    } catch (error) {
      console.error('Fetch sessions failed:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSessions().then((loadedSessions) => {
        const storedActiveId = localStorage.getItem('active_session_id');
        if (storedActiveId && loadedSessions.some(s => s.id === storedActiveId)) {
          setActiveSessionId(storedActiveId);
        } else if (loadedSessions.length > 0) {
          setActiveSessionId(loadedSessions[0].id);
        }
      });
    } else {
      setSessions([]);
      setActiveSessionId(null);
    }
  }, [isAuthenticated, fetchSessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('active_session_id', activeSessionId);
    }
  }, [activeSessionId]);

  const createSession = async (cwd = null) => {
    const newId = generateUUID();
    const token = localStorage.getItem('auth_token');

    try {
      const response = await fetch(`/api/sessions/${newId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          cols: 80, 
          rows: 24,
          cwd: cwd || null
        }),
      });

      if (response.ok) {
        const folderName = cwd ? cwd.split('/').pop() : null;
        const newSession = { 
          id: newId, 
          name: folderName ? `bash (${folderName})` : 'bash',
          cwd: cwd
        };
        setSessions(prev => [...prev, newSession]);
        setActiveSessionId(newId);
        return newId;
      }
    } catch (error) {
      console.error('Create session failed:', error);
    }
    return null;
  };

  const deleteSession = async (sessionId) => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          const remaining = sessions.filter(s => s.id !== sessionId);
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
        }
        return true;
      }
    } catch (error) {
      console.error('Delete session failed:', error);
    }
    return false;
  };

  const renameSession = async (sessionId, newName) => {
    const token = localStorage.getItem('auth_token');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName }),
      });

      if (response.ok) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName } : s));
        return true;
      }
    } catch (error) {
      console.error('Rename session failed:', error);
    }
    return false;
  };

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    deleteSession,
    renameSession,
    refreshSessions: fetchSessions
  };
};

export default useSessionManager;
