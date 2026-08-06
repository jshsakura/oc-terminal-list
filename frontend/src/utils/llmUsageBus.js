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

/**
 * "지금 수집 중" — 갱신 버튼이 도는 곳(대시보드 상단)과 실제로 도는 곳
 * (LlmDashboard)이 다른 컴포넌트라서 필요한 신호다. 누르고 아무 반응이 없으면
 * 눌린 건지 알 수 없다.
 */
export const LLM_USAGE_BUSY_EVENT = 'iterm:llm-usage-busy';

export const emitLlmUsageBusy = (busy, failed = null) => {
  try {
    window.dispatchEvent(new CustomEvent(LLM_USAGE_BUSY_EVENT, {
      detail: { busy: !!busy, failed: failed || null },
    }));
  } catch { /* no window */ }
};
