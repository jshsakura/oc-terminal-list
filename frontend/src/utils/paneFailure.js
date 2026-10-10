/**
 * sessionId → 연결 실패 사유. 모듈 레벨 단일 스토어 + 탭 단위 접기.
 *
 * 왜 필요한가: 실패 카드는 **그 pane 을 보고 있을 때만** 보인다. 다른 탭에서 일하는 동안
 * 호스트가 죽으면 화면 어디에도 표시가 없어서, 그 탭을 열어 보기 전까지 모른다. 탭 바는
 * 언제나 보이는 유일한 자리다.
 *
 * `agentStatusStore` 와 같은 이유로 컨텍스트가 아니라 모듈 스토어다 — 프로바이더를 끼우면
 * 트리 전체가 리렌더 대상이 되는데, `useSyncExternalStore` 는 구독한 쪽만 다시 그린다.
 *
 * ⚠️ **pane 이 사라지면 반드시 지워야 한다.** 안 지우면 닫힌 세션의 실패가 스토어에 남아
 *    그 자리를 물려받은 탭에 엉뚱한 경고가 뜬다(그리고 영원히 안 내려간다).
 */

// sessionId → { detail, at }
let state = {};
const listeners = new Set();

const emit = () => {
  // 새 참조로 교체 — useSyncExternalStore 가 얕은 비교로 변경을 감지한다.
  state = { ...state };
  listeners.forEach((fn) => fn());
};

export const subscribePaneFailure = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getPaneFailureSnapshot = () => state;

/**
 * 이 세션이 호스트에 못 붙었다(또는 다시 붙었다).
 *
 * `detail` 이 비면 해제. 같은 사유가 다시 들어오면 **아무것도 하지 않는다** — 실패는
 * 재시도 주기(4→8→16→30s)마다 다시 보고되는데, 그때마다 새 참조를 내면 탭 바가
 * 그 주기로 리렌더된다.
 */
export const reportPaneFailure = (sessionId, detail) => {
  if (!sessionId) return;
  const next = detail ? String(detail) : '';
  const prev = state[sessionId];
  if (!next) {
    if (!prev) return;
    delete state[sessionId];
    emit();
    return;
  }
  if (prev && prev.detail === next) return;
  state[sessionId] = { detail: next, at: Date.now() };
  emit();
};

/** pane 이 닫혔다 — 위 ⚠️ 참고. `reportPaneFailure(id, '')` 와 같다. */
export const clearPaneFailure = (sessionId) => reportPaneFailure(sessionId, '');

/**
 * 탭 하나의 대표 실패 — 그 탭 pane 중 처음 실패한 것의 사유.
 *
 * 분할 탭에서 여러 pane 이 같은 호스트면 사유도 같다. 다르면 아무거나 하나를 고르는 대신
 * **개수를 같이** 돌려준다 — "이 탭에서 2개가 못 붙었다" 는 사유 하나보다 정확하다.
 */
export const deriveTabFailure = (tab, failureMap) => {
  if (!tab || !failureMap) return null;
  const panes = tab.panes || [];
  let first = null;
  let count = 0;
  for (const pane of panes) {
    const entry = failureMap[pane?.sessionId];
    if (!entry) continue;
    count += 1;
    if (!first) first = entry.detail;
  }
  return count ? { detail: first, count } : null;
};
