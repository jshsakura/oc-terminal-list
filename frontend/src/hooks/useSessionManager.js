import { useState, useEffect, useCallback, useRef } from 'react';
import { generateUUID } from '../utils/helpers';

const SUPPORTED_SHELLS = new Set(['auto', 'bash', 'zsh', 'sh']);

const normalizeShell = (value) => {
  if (typeof value !== 'string') {
    return 'auto';
  }

  const normalized = value.trim().toLowerCase();
  return SUPPORTED_SHELLS.has(normalized) ? normalized : 'auto';
};

const useSessionManager = (isAuthenticated, defaultShell = 'auto') => {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const creatingSessionRef = useRef(false);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');

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
    if (creatingSessionRef.current) {
      return null;
    }

    creatingSessionRef.current = true;
    const newId = generateUUID();
    const requestedShell = normalizeShell(defaultShell);

    try {
      const response = await fetch(`/api/sessions/${newId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          cols: 80, 
          rows: 24,
          cwd: cwd || null,
          shell: requestedShell,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const actualCwd = data.cwd || cwd;
        const folderName = actualCwd ? actualCwd.split('/').pop() : null;
        const shellName = typeof data.shell_name === 'string' && data.shell_name
          ? data.shell_name
          : requestedShell === 'auto'
            ? 'shell'
            : requestedShell;
        
        const newSession = { 
          id: newId, 
          name: folderName ? `${shellName} (${folderName})` : shellName,
          cwd: actualCwd
        };
        setSessions(prev => [...prev, newSession]);
        setActiveSessionId(newId);
        return newId;
      }
    } catch (error) {
      console.error('Create session failed:', error);
    } finally {
      creatingSessionRef.current = false;
    }
    return null;
  };

  const deleteSession = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
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
    try {
      const response = await fetch(`/api/sessions/${sessionId}/name`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
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
