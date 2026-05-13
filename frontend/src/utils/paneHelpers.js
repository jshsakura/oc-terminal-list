import { generateUUID } from './helpers';

/**
 * Create a real pane inheriting context from the active pane/tab.
 * Returns a pane with id, mode, and appropriate sessionId or hostId.
 * Never returns an empty (picker) pane.
 *
 * - Local pane → new sessionId (never reuses the source), carry themeOverride + cwd
 * - Host pane → same hostId, carry themeOverride + cwd, NO tmuxSessionName copy
 * - Empty/unknown pane → fall back to tab type (hostId for host tab, new sessionId otherwise)
 */
export const makePaneFromContext = (tab, activePane, hostsArr = [], localTheme = null) => {
  const pane = activePane || {};
  const cwd = pane.cwd ?? tab?.cwd ?? null;

  // Active pane is a host pane → new pane with same hostId
  if (pane.hostId) {
    const host = hostsArr.find((h) => h.id === pane.hostId);
    const themeOverride = pane.themeOverride || host?.theme || null;
    return {
      id: generateUUID(),
      mode: 'terminal',
      hostId: pane.hostId,
      ...(themeOverride ? { themeOverride } : null),
      ...(cwd != null ? { cwd } : null),
    };
  }

  // Active pane is local → new pane with fresh sessionId
  if (pane.sessionId) {
    const themeOverride = pane.themeOverride || localTheme || null;
    return {
      id: generateUUID(),
      mode: 'terminal',
      sessionId: generateUUID(),
      ...(themeOverride ? { themeOverride } : null),
      ...(cwd != null ? { cwd } : null),
    };
  }

  // Active pane is empty — fall back to tab type
  if (tab?.type === 'host' && tab?.hostId) {
    const host = hostsArr.find((h) => h.id === tab.hostId);
    const themeOverride = host?.theme || null;
    return {
      id: generateUUID(),
      mode: 'terminal',
      hostId: tab.hostId,
      ...(themeOverride ? { themeOverride } : null),
      ...(cwd != null ? { cwd } : null),
    };
  }

  // Default: new local session
  const themeOverride = localTheme || null;
  return {
    id: generateUUID(),
    mode: 'terminal',
    sessionId: generateUUID(),
    ...(themeOverride ? { themeOverride } : null),
    ...(cwd != null ? { cwd } : null),
  };
};
