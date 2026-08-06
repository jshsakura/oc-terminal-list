/**
 * "The setting changed — re-read now."
 *
 * The home dashboard reads LLM usage once on mount and never polls (the backend
 * caches for a day; polling would be pure waste). So flipping the switch in
 * settings has to say so, or turning it on looks like it did nothing until the
 * page is reloaded.
 *
 * Same window-CustomEvent pattern as `iterm:open-file` / `iterm:vnc-control`.
 */
export const LLM_USAGE_CHANGED_EVENT = 'iterm:llm-usage-changed';
