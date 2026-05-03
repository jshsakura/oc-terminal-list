import { useCallback, useEffect, useRef, useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * 활성 로컬 tmux 세션의 현재 작업 디렉토리(cwd)를 주기 폴링.
 * 호스트 세션이거나 sessionId 가 없으면 워크스페이스 루트로 폴백.
 *
 * 반환:
 *  - workspaceRelative: 워크스페이스 기준 상대 경로 ('' = 루트). null = 워크스페이스 외부 또는 알 수 없음
 *  - absolutePath: tmux 가 보고한 절대 경로
 */
const useActiveTerminalCwd = ({ sessionId, isLocal = true, intervalMs = 3000 }) => {
  const [workspaceRelative, setWorkspaceRelative] = useState('');
  const [absolutePath, setAbsolutePath] = useState(null);
  const tickRef = useRef(null);

  const fetchOnce = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}/cwd`, { headers: authHeader() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.in_workspace) {
        setWorkspaceRelative(data.workspace_relative || '');
      } else {
        setWorkspaceRelative(null);
      }
      setAbsolutePath(data.cwd || null);
    } catch {
      // 무시 — 다음 tick 에서 재시도
    }
  }, []);

  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!sessionId || !isLocal) {
      setWorkspaceRelative('');
      setAbsolutePath(null);
      return;
    }
    fetchOnce(sessionId);
    tickRef.current = setInterval(() => fetchOnce(sessionId), intervalMs);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [sessionId, isLocal, intervalMs, fetchOnce]);

  return { workspaceRelative, absolutePath };
};

export default useActiveTerminalCwd;
