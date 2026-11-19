/**
 * State behind the Terminator panel. Nothing polls: the panel reads the conversation once
 * when it opens, and each answer comes back on the request that asked it.
 *
 * The answer's screen actions run here, on this device only: `did` right away, `point` as
 * a spotlight. Offered buttons are left for the person to press.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchTerminatorMessages, fetchTerminatorStatus, resetTerminator, sayToTerminator,
} from '../utils/terminatorApi';
import { runUiAction } from '../utils/uiActions';

const useTerminator = (open) => {
  const [status, setStatus] = useState(null);       // { configured, model }
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null);     // the question waiting for its answer
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchTerminatorStatus().then((st) => { if (aliveRef.current) setStatus(st); })
      .catch((exc) => { if (aliveRef.current) setError(exc.message || 'error'); });
    fetchTerminatorMessages().then((data) => { if (aliveRef.current) setMessages(data.messages || []); })
      .catch(() => { /* an empty conversation is a fine start */ });
  }, [open]);

  const say = useCallback(async (text) => {
    const clean = (text || '').trim();
    if (!clean || pending) return false;
    setError(null);
    setPending({ id: `pending:${Date.now()}`, role: 'user', text: clean, pending: true });
    try {
      const data = await sayToTerminator(clean);
      if (!aliveRef.current) return true;
      setMessages(data.messages || []);
      const reply = data.reply || {};
      if (reply.did) runUiAction(reply.did);
      if (reply.point) window.dispatchEvent(new CustomEvent('iterm:spotlight', { detail: { id: reply.point } }));
      return true;
    } catch (exc) {
      if (aliveRef.current) setError(exc.message || 'error');
      return false;
    } finally {
      if (aliveRef.current) setPending(null);
    }
  }, [pending]);

  const reset = useCallback(async () => {
    setMessages([]);
    setError(null);
    try { await resetTerminator(); } catch { /* the next question starts fresh anyway */ }
  }, []);

  return {
    status, error, say, reset,
    messages: pending ? [...messages, pending] : messages,
    isThinking: !!pending,
  };
};

export default useTerminator;
