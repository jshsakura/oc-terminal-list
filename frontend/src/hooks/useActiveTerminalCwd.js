import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';

/**
 * 터미널 세션의 현재 작업 디렉토리(cwd).
 *
 * 로컬/리모트: 마운트·세션 변경·명시적 refresh 때만 fetch.
 * tmux 의 #{pane_current_path} 는 즉시 조회 가능하므로 주기 폴링하지 않는다.
 *
 * deferMs: delays the first lookup, for off-screen panes. A restored workspace
 * mounts every pane at once, so these lookups (a per-pane SSH round trip when
 * remote) pile onto the same moment as the WS handshakes and tickets. Same end
 * state, it just yields its turn. When it drops to 0 (the pane became visible)
 * the effect re-runs and fetches immediately.
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
  deferMs = 0,
}) => {
  const [workspaceRelative, setWorkspaceRelative] = useState('');
  const [absolutePath, setAbsolutePath] = useState(null);
  const tickRef = useRef(null);
  const retryRef = useRef(null);
  const retryAttemptRef = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
  }, []);

  const fetchLocal = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}/cwd`, { headers: authHeaders() });
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
      const res = await fetch(`/api/hosts/${id}/cwd${qs}`, { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      setAbsolutePath(data.cwd || null);
      setWorkspaceRelative(null);
      return data;
    } catch { return null; }
  }, []);

  // cwd 가 비어있으면(fetch 실패/세션 미준비) 백오프로 재시도. 성공하면 멈춤.
  const scheduleRetry = useCallback((doFetch) => {
    clearRetry();
    const attempt = retryAttemptRef.current;
    const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
    retryAttemptRef.current = attempt + 1;
    retryRef.current = setTimeout(async () => {
      const data = await doFetch();
      if (!data || !data.cwd) scheduleRetry(doFetch);
      else retryAttemptRef.current = 0;
    }, delay);
  }, [clearRetry]);

  const refresh = useCallback(() => {
    if (isLocal) {
      if (!sessionId) {
        clearRetry();
        retryAttemptRef.current = 0;
        setWorkspaceRelative('');
        setAbsolutePath(null);
        return Promise.resolve(null);
      }
      const p = fetchLocal(sessionId);
      p.then((data) => {
        if (!data || !data.cwd) scheduleRetry(() => fetchLocal(sessionId));
        else { clearRetry(); retryAttemptRef.current = 0; }
      });
      return p;
    }
    if (!hostId) {
      clearRetry();
      retryAttemptRef.current = 0;
      setAbsolutePath(null);
      return Promise.resolve(null);
    }
    const p = fetchRemote(hostId, tmuxSession);
    p.then((data) => {
      if (!data || !data.cwd) scheduleRetry(() => fetchRemote(hostId, tmuxSession));
      else { clearRetry(); retryAttemptRef.current = 0; }
    });
    return p;
  }, [isLocal, sessionId, hostId, tmuxSession, fetchLocal, fetchRemote, scheduleRetry, clearRetry]);

  // 기본은 1회성 조회 + 실패 시 백오프. intervalMs 를 명시한 경우에만 하위호환 폴링.
  useEffect(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    clearRetry();
    retryAttemptRef.current = 0;
    let deferTimer = null;
    if (deferMs > 0) deferTimer = setTimeout(refresh, deferMs);
    else refresh();
    if (intervalMs > 0) {
      tickRef.current = setInterval(refresh, intervalMs);
    }
    return () => {
      if (deferTimer) clearTimeout(deferTimer);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      clearRetry();
    };
  }, [refresh, intervalMs, refreshSignal, clearRetry, deferMs]);

  return { workspaceRelative, absolutePath, refresh };
};

export default useActiveTerminalCwd;
