/**
 * Live cwd values reported by the existing per-host remote tmux sweep.
 *
 * The store is separate from React context so one changed pane only wakes cwd
 * subscribers. Keys include the host because tmux session names repeat across hosts.
 */
import { isRenderPaused, subscribeRenderPause } from './renderPause';

let state = {};
let snapshot = state;
let publicationPending = false;
const listeners = new Set();

const publish = () => {
  if (isRenderPaused()) { publicationPending = true; return; }
  snapshot = state;
  publicationPending = false;
  listeners.forEach((listener) => listener());
};

subscribeRenderPause(() => { if (!isRenderPaused() && publicationPending) publish(); });

const keyOf = (hostId, session) => `${hostId || ''}\u0000${session || ''}`;

export const subscribeRemoteCwd = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getRemoteCwd = (hostId, session) => (
  hostId && session ? (snapshot[keyOf(hostId, session)] || '') : ''
);

export const applyRemoteCwdChanges = (hostId, cwds) => {
  if (!hostId || !cwds || typeof cwds !== 'object') return;
  let next = state;
  for (const [session, cwd] of Object.entries(cwds)) {
    if (!session) continue;
    const key = keyOf(hostId, session);
    if (cwd === null) {
      if (!Object.hasOwn(state, key)) continue;
      if (next === state) next = { ...state };
      delete next[key];
      continue;
    }
    if (typeof cwd !== 'string' || !cwd || state[key] === cwd) continue;
    if (next === state) next = { ...state };
    next[key] = cwd;
  }
  if (next === state) return;
  state = next;
  publish();
};

export const _resetRemoteCwd = () => {
  state = {};
  snapshot = state;
  publicationPending = false;
  listeners.clear();
};
