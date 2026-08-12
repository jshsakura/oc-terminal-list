/**
 * Remote cwd batcher — one request per host, not per pane.
 *
 * A restored workspace can hold a dozen panes on one host and each asked
 * /api/hosts/{id}/cwd for itself: a dozen tunnelled requests, each costing an
 * SSH exec on the far end, all inside the boot window. `list-panes -a` on the
 * host already reports every session, so one request answers all of them.
 *
 * The window is short — a lone pane pays it as latency — and results are cached
 * only for the length of one batch, so this stays a request coalescer and never
 * becomes a stale cwd cache.
 */

export const HOST_CWD_BATCH_WINDOW_MS = 60;

export const createHostCwdBatcher = ({ fetchHostCwds, windowMs = HOST_CWD_BATCH_WINDOW_MS } = {}) => {
  // hostId -> { timer, waiters: [{ session, resolve }] }
  const pendingByHost = new Map();

  const flush = async (hostId) => {
    const pending = pendingByHost.get(hostId);
    if (!pending) return;
    pendingByHost.delete(hostId);
    if (pending.timer) clearTimeout(pending.timer);

    let cwds = null;
    try {
      cwds = await fetchHostCwds(hostId);
    } catch {
      cwds = null;
    }
    pending.waiters.forEach(({ session, resolve }) => {
      // No map at all means the request failed — the caller's retry ladder owns
      // that. A map without this session means the session has no panes yet,
      // which is also "no cwd", so both resolve to null.
      resolve(cwds && session ? (cwds[session] ?? null) : null);
    });
  };

  const request = (hostId, session) => new Promise((resolve) => {
    let pending = pendingByHost.get(hostId);
    if (!pending) {
      pending = { timer: null, waiters: [] };
      pendingByHost.set(hostId, pending);
      pending.timer = setTimeout(() => flush(hostId), windowMs);
    }
    pending.waiters.push({ session, resolve });
  });

  return { request, flush };
};
