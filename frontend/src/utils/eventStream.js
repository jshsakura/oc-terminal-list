/**
 * Open a server-sent event stream that does **not** drive the browser's page-load
 * progress bar.
 *
 * iOS Safari treats an EventSource owned by the document as a subresource that is still
 * loading — the thin bar under the address bar sticks, and returns on every reconnect.
 * Running the stream inside a worker takes it out of that accounting. Everything else
 * (tickets, backoff, the one-connection rule) stays with the caller.
 *
 * The returned handle looks like an EventSource to the caller: it has `close()`.
 * If workers or worker-side EventSource are unavailable, it silently becomes a plain
 * EventSource — the progress bar is a cosmetic problem and must never cost the sync.
 */

// Remembered across calls: once a browser proves it cannot do this, stop paying for it.
let workerUsable = true;

const openDirect = (url, { onOpen, onMessage, onError }) => {
  const source = new EventSource(url);
  source.onopen = () => onOpen?.();
  source.onmessage = (e) => onMessage?.(e.data);
  source.onerror = () => onError?.();
  return { close: () => source.close(), viaWorker: false };
};

const openViaWorker = (url, handlers) => {
  const worker = new Worker(new URL('../workers/sseWorker.js', import.meta.url), { type: 'module' });
  let closed = false;
  let fallback = null;

  const degrade = () => {
    workerUsable = false;
    try { worker.terminate(); } catch { /* already gone */ }
    if (!closed && !fallback) fallback = openDirect(url, handlers);
  };

  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'unsupported') { degrade(); return; }
    if (closed) return;
    if (msg.type === 'open') handlers.onOpen?.();
    else if (msg.type === 'message') handlers.onMessage?.(msg.data);
    else if (msg.type === 'error') handlers.onError?.();
  };
  worker.onerror = degrade;

  worker.postMessage({ type: 'connect', url });

  return {
    close: () => {
      closed = true;
      try { worker.postMessage({ type: 'close' }); } catch { /* already terminated */ }
      try { worker.terminate(); } catch { /* already terminated */ }
      fallback?.close();
    },
    viaWorker: true,
  };
};

export const openEventStream = (url, handlers = {}) => {
  if (workerUsable && typeof Worker !== 'undefined') {
    try {
      return openViaWorker(url, handlers);
    } catch {
      workerUsable = false;   // blocked by CSP, bundler URL missing, …
    }
  }
  return openDirect(url, handlers);
};

/** Test seam — lets a suite start from a known state. */
export const _resetWorkerSupport = () => { workerUsable = true; };
