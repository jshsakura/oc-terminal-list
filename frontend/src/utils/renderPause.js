// Rendering is independent of pane activity: pausing must not close sockets or sessions.
let paused = false;
const listeners = new Set();

export const isRenderPaused = () => paused;
export const subscribeRenderPause = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const setRenderPaused = (next) => {
  if (paused === next) return;
  paused = next;
  document.documentElement.toggleAttribute('data-render-paused', next);
  for (const listener of listeners) listener();
};
