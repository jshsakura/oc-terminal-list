/**
 * `fetch` with a deadline.
 *
 * A page-owned request that never settles costs three things on this deployment:
 *
 * 1. **iOS Safari keeps the progress bar under the address bar.** The browser
 *    counts an in-flight subresource as "still loading" — it sticks at ~20% and
 *    the only way out is a reload. (Same accounting that made us move the SSE
 *    *stream* into a worker; the ticket fetch in front of it stayed on the page.)
 * 2. **It holds a slot in the shared HTTP/2 connection** — the one that wedges on
 *    mobile network switches. A hung request makes the wedge worse, not neutral.
 * 3. **It never retries.** The promise simply never resolves, so the poller that
 *    issued it stops polling. Silence looks like "nothing changed".
 *
 * So background/polling calls get a deadline. Failing after N seconds is a state
 * the callers already handle (they keep the last value and try again); hanging
 * forever is not.
 */

export const DEFAULT_API_TIMEOUT_MS = 15000;

/**
 * `AbortSignal.timeout` is Safari 16+. The fallback matters here specifically —
 * an older iOS is exactly where the worker-SSE path also degrades, so it is the
 * browser most likely to be showing the stuck bar.
 */
export const timeoutSignal = (ms) => {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

/**
 * Same contract as fetch(). Pass `timeoutMs: 0` to opt out (uploads, git push —
 * anything whose normal duration is unbounded), or your own `signal` to keep it.
 */
export const apiFetch = (url, { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...options } = {}) => {
  if (options.signal || !timeoutMs) return fetch(url, options);
  return fetch(url, { ...options, signal: timeoutSignal(timeoutMs) });
};

export default apiFetch;
