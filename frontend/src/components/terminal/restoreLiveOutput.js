import { authHeaders } from '../../utils/auth';

// A hidden pane may still be in tmux copy-mode after the reader changes tabs.
export default async function restoreLiveOutput(sessionId, hostId, { toBottom = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('/api/terminal-scroll', {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, host_id: hostId || null,
        ...(toBottom ? { action: 'bottom' } : { offset: 0 }) }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.available === true && result.offset === 0;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}
