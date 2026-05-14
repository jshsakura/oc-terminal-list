import { useCallback, useEffect, useRef, useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * 터미널 세션의 현재 작업 디렉토리(cwd).
 *
 * 로컬/리모트: 마운트·세션 변경·명시적 refresh 때만 fetch.
 * tmux 의 #{pane_current_path} 는 즉시 조회 가능하므로 주기 폴링하지 않는다.
 *
 * 반환:
 *  - workspaceRelative: 워크스페이스 기준 상대 경로 (로컬만). null = 외부 또는 알 수 없음
 *  - absolutePath: tmux 가 보고한 절대 경로
 */
const useActiveTerminalCwd = ({
  sessionId,
  hostId = null,
  tmuxSession = null,
  isLocal = true,
  intervalMs = 0,
  refreshSignal = 0,
}) => {
  const [workspaceRelative, setWorkspaceRelative] = useState('');
  const [absolutePath, setAbsolutePath] = useState(null);
  const tickRef = useRef(null);

  const fetchLocal = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}/cwd`, { headers: authHeader() });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.in_workspace) {
        setWorkspaceRelative(data.workspace_relative || '');
      } else {
        setWorkspaceRelative(null);
      }
      setAbsolutePath(data.cwd || null);
      return data;
    } catch { return null; }
  }, []);

  const fetchRemote = useCallback(async (id, session) => {
    try {
      const qs = session ? `?session=${encodeURIComponent(session)}` : '';
      const res = await fetch(`/api/hosts/${id}/cwd${qs}`, { headers: authHeader() });
      if (!res.ok) return null;
      const data = await res.json();
      setAbsolutePath(data.cwd || null);
      setWorkspaceRelative(null);
      return data;
    } catch { return null; }
  }, []);

  const refresh = useCallback(() => {
    if (isLocal) {
      if (!sessionId) {
        setWorkspaceRelative('');
        setAbsolutePath(null);
        return Promise.resolve(null);
      }
      return fetchLocal(sessionId);
    }
    if (!hostId) {
      setAbsolutePath(null);
      return Promise.resolve(null);
    }
    return fetchRemote(hostId, tmuxSession);
  }, [isLocal, sessionId, hostId, tmuxSession, fetchLocal, fetchRemote]);

  // 기본은 1회성 조회. intervalMs 를 명시한 경우에만 하위호환 폴링.
  useEffect(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    refresh();
    if (intervalMs > 0) {
      tickRef.current = setInterval(refresh, intervalMs);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); tickRef.current = null; };
  }, [refresh, intervalMs, refreshSignal]);

  return { workspaceRelative, absolutePath, refresh };
};

export default useActiveTerminalCwd;
