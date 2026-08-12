/**
 * WS ticket micro-batcher.
 *
 * Boot and workspace restore open every pane at once. One POST /api/ws-ticket
 * per pane meant a burst as wide as the pane count (measured: 14 inside one
 * second), all queued on the shared HTTP/2 connection — the very connection that
 * wedges on mobile network switches. Collect for a short window and issue one
 * POST /api/ws-tickets instead.
 *
 * The window is deliberately short: a lone reconnect pays it as latency. 30ms is
 * negligible next to a round trip (100ms+) yet wide enough to catch a mass open.
 *
 * Results are matched **positionally**. Remote panes on the same host all share
 * one ws path and tickets are single use, so keying results by path would hand
 * them one ticket and every pane after the first would silently fail to attach.
 */

export const WS_TICKET_BATCH_WINDOW_MS = 30;
// Mirrors the server's MAX_BATCH_PATHS — anything over splits into another request.
export const WS_TICKET_BATCH_MAX = 32;

const FAILED = { ticket: null, authExpired: false };
const EXPIRED = { ticket: null, authExpired: true };

/**
 * @param postBatch (paths[]) => Promise<{ ok, status, tickets }>
 *   tickets: array aligned with the request; each item is {ticket, expires_at} or null.
 */
export const createWsTicketBatcher = ({ postBatch, windowMs = WS_TICKET_BATCH_WINDOW_MS, maxBatch = WS_TICKET_BATCH_MAX } = {}) => {
  let pending = [];
  let timer = null;

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending.length) return;
    const batch = pending;
    pending = [];

    let result;
    try {
      result = await postBatch(batch.map((p) => p.path));
    } catch {
      batch.forEach((p) => p.resolve(FAILED));
      return;
    }

    if (result?.status === 401 || result?.status === 403) {
      batch.forEach((p) => p.resolve(EXPIRED));
      return;
    }
    if (!result?.ok || !Array.isArray(result?.tickets)) {
      batch.forEach((p) => p.resolve(FAILED));
      return;
    }
    batch.forEach((p, i) => {
      const slot = result.tickets[i];
      p.resolve(slot?.ticket ? { ticket: slot.ticket, authExpired: false } : FAILED);
    });
  };

  const request = (path) => new Promise((resolve) => {
    pending.push({ path, resolve });
    if (pending.length >= maxBatch) { flush(); return; }
    if (!timer) timer = setTimeout(flush, windowMs);
  });

  return { request, flush };
};
