/**
 * State behind the Terminator panel.
 *
 * Nothing here polls. The conversation is refetched when Terminator's own session changes
 * agent status (working ↔ idle), which the existing tab-state SSE already pushes, plus once
 * when the panel opens and once after each message is sent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentStatusSnapshot, subscribeAgentStatus } from '../utils/agentStatusStore';
import {
  fetchTerminatorMessages, fetchTerminatorStatus, sayToTerminator, startTerminator,
} from '../utils/terminatorApi';

const REFETCH_SETTLE_MS = 400;

const useTerminator = (open) => {
  const [status, setStatus] = useState(null);       // { configured, logins, sessionId, running }
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);       // sent, not yet in the transcript
  const [phase, setPhase] = useState('idle');       // idle | checking | starting | ready | error
  const [error, setError] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; clearTimeout(timerRef.current); }, []);

  const refetch = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchTerminatorMessages()
        .then((data) => {
          if (!aliveRef.current) return;
          const next = data.messages || [];
          setMessages(next);
          // A pending bubble is done once the transcript shows the same text.
          setPending((prev) => prev.filter((p) => !next.some((m) => m.role === 'user' && m.text === p.text)));
        })
        .catch(() => { /* keep what is shown; the next status change refetches */ });
    }, REFETCH_SETTLE_MS);
  }, []);

  const boot = useCallback(async () => {
    setError(null);
    setPhase('checking');
    try {
      const st = await fetchTerminatorStatus();
      if (!aliveRef.current) return;
      setStatus(st);
      if (!st.configured) { setPhase('idle'); return; }
      if (!st.running) {
        setPhase('starting');
        await startTerminator();
        if (!aliveRef.current) return;
        setStatus({ ...st, running: true });
      }
      setPhase('ready');
      refetch();
    } catch (exc) {
      if (!aliveRef.current) return;
      setError(exc.message || 'error');
      setPhase('error');
    }
  }, [refetch]);

  useEffect(() => { if (open) boot(); }, [open, boot]);

  // Refetch when Terminator's own pane changes state. The SSE already carries it.
  const sessionId = status?.sessionId;
  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let last = getAgentStatusSnapshot()[sessionId]?.status ?? null;
    setAgentStatus(last);
    return subscribeAgentStatus(() => {
      const now = getAgentStatusSnapshot()[sessionId]?.status ?? null;
      if (now === last) return;
      last = now;
      setAgentStatus(now);
      refetch();
    });
  }, [open, sessionId, refetch]);

  const say = useCallback(async (text) => {
    const clean = (text || '').trim();
    if (!clean) return false;
    const item = { id: `pending:${Date.now()}`, role: 'user', text: clean, pending: true };
    setPending((prev) => [...prev, item]);
    try {
      await sayToTerminator(clean);
      refetch();
      return true;
    } catch (exc) {
      setPending((prev) => prev.filter((p) => p.id !== item.id));
      setError(exc.message || 'error');
      return false;
    }
  }, [refetch]);

  return {
    status, phase, error, agentStatus, say, retry: boot,
    messages: pending.length ? [...messages, ...pending] : messages,
    isThinking: agentStatus === 'working' || pending.length > 0,
  };
};

export default useTerminator;
