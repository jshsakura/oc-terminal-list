import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authHeaders } from '../utils/auth';
import { apiFetch } from '../utils/apiFetch';
import { createHostCwdBatcher } from '../utils/hostCwdBatch';
import { subscribeAgentStatus, getAgentCwd } from '../utils/agentStatusStore';

const fetchHostCwds = async (hostId) => {
  const res = await apiFetch(`/api/hosts/${hostId}/cwd/batch`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.cwds || {};
};

const fetchLocalCwds = async (_key, sessionIds) => {
  const ids = sessionIds.filter(Boolean).join(',');
  const res = await apiFetch(`/api/sessions/cwd/batch?ids=${encodeURIComponent(ids)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.cwds || {};
};

const { request: requestHostCwd } = createHostCwdBatcher({ fetchCwds: fetchHostCwds });
const { request: requestLocalCwd } = createHostCwdBatcher({ fetchCwds: fetchLocalCwds });

/**
 * 터미널 세션의 현재 작업 디렉토리(cwd).
 *
 * 로컬/리모트: 마운트·세션 변경·명시적 refresh 때만 fetch.
 * tmux 의 #{pane_current_path} 는 즉시 조회 가능하므로 주기 폴링하지 않는다.
 *
 * **그런데 `cd` 는 따라간다 — 새 폴링을 만들지 않고.** 에이전트 상태 폴링이 이미
 * `#{pane_current_path}` 를 읽어 SSE 로 흘려보내고 있으므로(공짜다: 같은 tmux 호출의
 * 칸 하나, 이미 열려 있는 SSE), 그 값이 바뀐 순간을 **신호로만** 쓴다. 값 자체를 쓰지
 * 않는 이유는 화면이 워크스페이스 **상대** 경로도 필요로 하는데 그 환산은 서버만
 * 할 수 있어서다 — 상대 경로 계산을 여기 베끼면 두 곳이 반드시 어긋난다.
 * 그래서 `cd` 한 번당 배치된 요청 하나. 사람 속도로 일어나는 일이라 무시할 수 있다.
 *
 * ⚠️ 이 신호는 **로컬 tmux pane 에만** 온다. 원격 pane 의 tmux 는 그 호스트에 있고
 * herdr 에는 이 폴링이 없다 — 그쪽은 예전처럼 명시적 refresh 로만 갱신된다.
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
// 2s·4s·8s·16s·30s — 세션이 붙기까지의 창을 덮고 끝낸다(그 뒤는 refreshSignal 이 담당).
const MAX_CWD_RETRIES = 5;

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
  /* deferMs is read through a ref on purpose: it flips whenever the pane's
     visibility does, and as an effect dependency that meant *leaving* a tab
     re-fetched too — a pane nobody is looking at, re-learning its cwd 1.5s after
     you navigated away. Becoming visible is a refreshSignal bump instead, so only
     the direction that matters triggers work. */
  const deferMsRef = useRef(deferMs);
  deferMsRef.current = deferMs;
  const tickRef = useRef(null);
  const retryRef = useRef(null);
  const retryAttemptRef = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
  }, []);

  const fetchLocal = useCallback(async (id) => {
    try {
      // Local panes share one request too — see utils/hostCwdBatch. '' is the
      // key for "this machine": one tmux server, one batch.
      const data = await requestLocalCwd('', id);
      if (!data) return null;
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
      /* Panes on one host share a single request (utils/hostCwdBatch) — see the
         note there. Without a session name there is nothing to look up in the
         per-session map, so that case keeps the single-shot endpoint. */
      if (session) {
        const cwd = await requestHostCwd(id, session);
        if (cwd == null) return null;
        setAbsolutePath(cwd);
        setWorkspaceRelative(null);
        return { cwd };
      }
      const res = await apiFetch(`/api/hosts/${id}/cwd`, { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      setAbsolutePath(data.cwd || null);
      setWorkspaceRelative(null);
      return data;
    } catch { return null; }
  }, []);

  /* cwd 가 비어있으면(fetch 실패/세션 미준비) 백오프로 재시도. 성공하면 멈춘다.
     **사다리는 끝이 있어야 한다.** 예전엔 30s 에서 캡만 걸고 영원히 돌았다 — cwd 를 끝내
     못 주는 pane 하나가 분당 2회(원격이면 SSH 왕복 2회)를 영구히 태웠고, 원격 pane 이
     아홉이면 그게 그대로 곱해졌다. 세션이 실제로 붙는 순간은 폴링이 아니라 refreshSignal
     (terminalReady) 이 알려주므로, 붙기 전 창만 덮으면 충분하다. */
  const scheduleRetry = useCallback((doFetch) => {
    clearRetry();
    const attempt = retryAttemptRef.current;
    if (attempt >= MAX_CWD_RETRIES) return;
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

  /* 이 세션의 살아있는 cwd(문자열). ⚠️ 원시값이어야 한다 — 객체를 만들어 돌려주면
     `useSyncExternalStore` 가 매 렌더를 변경으로 읽어 무한 루프가 된다. */
  const liveCwd = useSyncExternalStore(
    subscribeAgentStatus,
    () => (isLocal ? getAgentCwd(sessionId) : ''),
    () => '',
  );
  /* 그 값이 우리가 아는 것과 달라진 순간에만 다시 묻는다. 같은 값이 또 와도(스냅샷
     하이드레이션 등) 아무 일도 하지 않는다. */
  const lastLiveRef = useRef('');
  useEffect(() => {
    if (!liveCwd || liveCwd === lastLiveRef.current) return;
    lastLiveRef.current = liveCwd;
    if (absolutePath && liveCwd === absolutePath) return;   // 이미 그 경로를 알고 있다
    refresh();
  }, [liveCwd, absolutePath, refresh]);

  // 기본은 1회성 조회 + 실패 시 백오프. intervalMs 를 명시한 경우에만 하위호환 폴링.
  useEffect(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    clearRetry();
    retryAttemptRef.current = 0;
    let deferTimer = null;
    const defer = deferMsRef.current;
    if (defer > 0) deferTimer = setTimeout(refresh, defer);
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
  }, [refresh, intervalMs, refreshSignal, clearRetry]);

  return { workspaceRelative, absolutePath, refresh };
};

export default useActiveTerminalCwd;
