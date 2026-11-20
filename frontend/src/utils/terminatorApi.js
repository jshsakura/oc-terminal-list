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

// One GLM request per message; the backend gives it up to 40s.
const SAY_TIMEOUT_MS = 45000;

export const fetchTerminatorStatus = () => apiFetch('/api/terminator/status').then(json);
export const fetchTerminatorMessages = () => apiFetch('/api/terminator/messages').then(json);
export const resetTerminator = () => apiFetch('/api/terminator/reset', { method: 'POST' }).then(json);
export const sayToTerminator = (text) => apiFetch('/api/terminator/say', {
  method: 'POST',
  timeoutMs: SAY_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
}).then(json);

// Settings: the key is write-only, only its last four characters come back.
export const fetchTerminatorConfig = () => apiFetch('/api/terminator/config').then(json);
export const saveTerminatorConfig = (body) => apiFetch('/api/terminator/config', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(json);
export const checkTerminator = () => apiFetch('/api/terminator/check', { method: 'POST', timeoutMs: 25000 }).then(json);
