import { useState, useEffect, useRef, useCallback } from 'react';
import { authHeaders } from '../../../utils/auth';
import { einkPollMs } from '../../../utils/einkMode';

export default function useLlmInfo(info, enabled, { currentOnly = false, poll = true, onSnapshot } = {}) {
  const target = JSON.stringify([info?.tabType, info?.host?.id, info?.sessionId, info?.effectiveTmuxSession]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [choice, setSelected] = useState(null);
  const selected = !currentOnly && choice?.target === target ? choice : null;
  const refreshRef = useRef(null);
  const hostId = info?.tabType === 'host' ? info.host?.id : null;
  const sessionId = info?.sessionId;
  const tmuxSession = info?.effectiveTmuxSession;

  useEffect(() => {
    setData(null);
    setError(null);
    if (!enabled || !sessionId) { return undefined; }
    let active = true;
    let pending = false;
    let controller;
    const load = async () => {
      if (pending) { return; }
      pending = true;
      controller = new AbortController();
      setBusy(true);
      setError(null);
      const params = new URLSearchParams({ session_id: sessionId });
      if (currentOnly) { params.set('current_only', 'true'); }
      if (hostId) {
        params.set('host_id', hostId);
        if (tmuxSession) { params.set('tmux_session', tmuxSession); }
      }
      if (selected) {
        params.set('thread_id', selected.id);
        params.set('process_id', String(selected.pid));
      }
      try {
        const response = await fetch(`/api/llm-usage/pane?${params}`, {
          headers: authHeaders(), signal: controller.signal,
        });
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
        const next = await response.json();
        if (active) {
          setData(next);
          onSnapshot?.(next);
          if (selected && next.process_id !== selected.pid) { setSelected(null); }
        }
      } catch (err) {
        if (active && err.name !== 'AbortError') {
          setError(err.message);
          onSnapshot?.(null);
          setData(null);
        }
      } finally {
        pending = false;
        if (active) { setBusy(false); }
      }
    };
    refreshRef.current = load;
    load();
    const timer = poll ? setInterval(load, einkPollMs(30000)) : null;
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      refreshRef.current = null;
    };
  }, [enabled, sessionId, hostId, tmuxSession, selected, currentOnly, poll, onSnapshot]);

  const refresh = useCallback(() => refreshRef.current?.(), []);
  const select = useCallback((id) => setSelected(id ? { id, pid: data?.process_id, target } : null), [data?.process_id, target, setSelected]);
  return { data, error, busy, refresh, select };
}
