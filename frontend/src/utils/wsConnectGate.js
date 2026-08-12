/**
 * Concurrency gate for WS handshakes — one instance for the whole page.
 *
 * A restored workspace opens every pane at once (measured: 14 sockets inside 8
 * seconds). That fires 14 handshakes into the shared Cloudflare tunnel and makes
 * the server spawn 14 tmux attach clients, each replaying its screen at the same
 * moment — that is the long "loading" the user sees. The end state is identical
 * either way, so attaching a few at a time costs nothing and feels better.
 *
 * Two rules:
 * - **Visible panes go first.** Panes in background tabs wait.
 * - **Never wait forever.** If a hung handshake holds a slot, the waiter
 *   proceeds anyway after maxWaitMs. A gate that can block reconnection would be
 *   worse than every bug this repo has fixed around reconnects.
 */

export const WS_GATE_MAX_CONCURRENT = 3;
export const WS_GATE_MAX_WAIT_MS = 2500;
// Backstop so a forgotten release (or an unmount before open/close) cannot lock a slot forever.
export const WS_GATE_AUTO_RELEASE_MS = 12000;

export const createWsConnectGate = ({
  maxConcurrent = WS_GATE_MAX_CONCURRENT,
  maxWaitMs = WS_GATE_MAX_WAIT_MS,
  autoReleaseMs = WS_GATE_AUTO_RELEASE_MS,
} = {}) => {
  let active = 0;
  let waiting = [];

  const makeRelease = () => {
    let released = false;
    const autoTimer = setTimeout(() => release(), autoReleaseMs);
    function release() {
      if (released) return;
      released = true;
      clearTimeout(autoTimer);
      active = Math.max(0, active - 1);
      pump();
    }
    return release;
  };

  const grant = (entry) => {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    active += 1;
    entry.resolve(makeRelease());
  };

  function pump() {
    while (active < maxConcurrent && waiting.length) {
      // Priority first, FIFO within the same priority.
      let idx = waiting.findIndex((w) => w.priority);
      if (idx < 0) idx = 0;
      const [entry] = waiting.splice(idx, 1);
      grant(entry);
    }
  }

  /**
   * @returns {Promise<() => void>} release fn — must be called whether the socket opens or closes.
   */
  const acquire = ({ priority = false } = {}) => new Promise((resolve) => {
    const entry = { priority, resolve, settled: false, timer: null };
    if (active < maxConcurrent) { grant(entry); return; }
    entry.timer = setTimeout(() => {
      // Waited long enough: leave the queue and proceed. `active` still goes up
      // so the release call stays balanced.
      waiting = waiting.filter((w) => w !== entry);
      grant(entry);
    }, maxWaitMs);
    waiting.push(entry);
  });

  const stats = () => ({ active, waiting: waiting.length });

  return { acquire, stats };
};

const gate = createWsConnectGate();

export const acquireWsConnectSlot = gate.acquire;
export const wsConnectGateStats = gate.stats;
export default gate;
