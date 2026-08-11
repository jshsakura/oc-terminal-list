/**
 * Holds the tab-state EventSource **off the document**.
 *
 * An EventSource is an HTTP response that never ends, and iOS Safari counts one owned by
 * the page as a still-loading resource — the progress bar under the address bar sticks
 * at ~10% and comes back on every SSE reconnect. A worker's requests are not part of the
 * document's load progress, so the same stream stops painting that bar.
 *
 * Only the stream lives here. Ticket issuing, reconnect backoff and the single-connection
 * invariant stay on the main thread (see `useWorkspaceTabs`) — that logic has a history of
 * storming, and splitting it across a thread boundary is how you get two of it.
 */
let stream = null;

const closeStream = () => {
  try { stream?.close(); } catch { /* already gone */ }
  stream = null;
};

self.onmessage = (event) => {
  const { type, url } = event.data || {};

  if (type === 'close') {
    closeStream();
    return;
  }
  if (type !== 'connect') return;

  // Workers gained EventSource late (Safari 16.4). Say so and let the page do it itself.
  if (typeof EventSource === 'undefined') {
    self.postMessage({ type: 'unsupported' });
    return;
  }

  closeStream();
  stream = new EventSource(url);
  stream.onopen = () => self.postMessage({ type: 'open' });
  stream.onmessage = (e) => self.postMessage({ type: 'message', data: e.data });
  stream.onerror = () => {
    // The page owns reconnect. Close here so a half-dead stream cannot linger.
    closeStream();
    self.postMessage({ type: 'error' });
  };
};
