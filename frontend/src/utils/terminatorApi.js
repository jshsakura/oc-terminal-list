/**
 * Terminator panel API. Every call has a deadline (apiFetch): a wedged shared HTTP/2
 * connection must not leave the panel spinning forever.
 */
import { apiFetch } from './apiFetch';

const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.detail || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return body;
};

// Starting waits for a shell and an agent to come up (backend waits up to 20s).
const START_TIMEOUT_MS = 30000;

export const fetchTerminatorStatus = () => apiFetch('/api/terminator/status').then(json);
export const startTerminator = () => apiFetch('/api/terminator/start', { method: 'POST', timeoutMs: START_TIMEOUT_MS }).then(json);
export const fetchTerminatorMessages = () => apiFetch('/api/terminator/messages').then(json);
export const showTerminatorTerminal = () => apiFetch('/api/terminator/show', { method: 'POST' }).then(json);
export const sayToTerminator = (text) => apiFetch('/api/terminator/say', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
}).then(json);
