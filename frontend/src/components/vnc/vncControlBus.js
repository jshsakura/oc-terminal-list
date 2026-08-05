/**
 * VNC pane controls live in the tab menus, not on the pane.
 *
 * The pane itself is the content — a control rail sitting on top of it covered
 * the desktop and was slow to hit on a phone. But the menus are rendered far
 * away from `VncPane` (TabBar / SubTabBar), so this is the wire between them.
 * Same pattern the app already uses for `iterm:open-file` / `iterm:activity`:
 * a window CustomEvent instead of threading props six levels.
 *
 * The registry exists so a menu can show which mode is currently on without
 * owning that state. `window.terminalSessions` does the same thing for xterm.
 */

export const VNC_CONTROL_EVENT = 'iterm:vnc-control';

const registry = new Map();   // paneId -> { viewMode, quality }

export const registerVncPane = (paneId, state) => {
  if (paneId) registry.set(paneId, state);
};

export const unregisterVncPane = (paneId) => {
  if (paneId) registry.delete(paneId);
};

export const getVncState = (paneId) => (paneId ? registry.get(paneId) || null : null);

/**
 * Ask a pane to change a control. The pane applies it to the live RFB right
 * away and persists it afterwards — the picture must not wait for a settings
 * round trip (that lag was the complaint about the old rail).
 */
export const emitVncControl = (paneId, patch) => {
  if (!paneId || !patch) return;
  try {
    window.dispatchEvent(new CustomEvent(VNC_CONTROL_EVENT, { detail: { paneId, ...patch } }));
  } catch { /* no window (tests/SSR) — nothing to control anyway */ }
};
