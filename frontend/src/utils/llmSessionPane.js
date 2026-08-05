/**
 * LLM 세션 → 살아있는 pane 찾기.
 *
 * watcher 가 주는 세션 ID 는 **그 에이전트 자신의 것**(Claude Code 의 세션 UUID 등)이라
 * 우리 tmux 세션 ID 와 직접 맞지 않는다. 대신 로그에 같이 남는 `cwd` 로 잇는다:
 * 같은 호스트에서 같은 디렉토리를 열고 있는 pane 이면 그게 그 작업이 도는 자리다.
 *
 * 정확한 매칭이 아니라 **가장 그럴듯한 자리로 데려다주는 것**이 목적이다. 못 찾으면
 * null 을 주고, 호출부는 링크를 안 그린다 — 엉뚱한 pane 으로 보내는 것보다 낫다.
 */

/** 경로 비교용 정규화 — 끝 슬래시와 중복 슬래시만 정리한다. */
export function normalizeCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  const collapsed = cwd.trim().replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

/**
 * pane 이 어느 호스트에 있는지 — 로컬 pane 은 hostId 가 없으므로 'local' 로 읽는다.
 * 백엔드의 LOCAL_SOURCE_ID 와 같은 문자열이어야 조인이 맞는다.
 */
function paneHostId(pane) {
  return pane?.hostId || 'local';
}

/** pane 의 cwd — pane 에 없으면 탭의 것을 쓴다(단일 pane 탭은 탭에만 있다). */
function paneCwd(pane, tab) {
  return normalizeCwd(pane?.cwd || tab?.cwd || '');
}

/**
 * @param {{host_id?: string, cwd?: string}} session  watcher 세션 행
 * @param {Array} tabs  현재 탭 목록
 * @returns {{tabId: string, paneId: string}|null}
 */
export function findPaneForSession(session, tabs) {
  const targetHost = session?.host_id || 'local';
  const targetCwd = normalizeCwd(session?.cwd);
  if (!targetCwd || !Array.isArray(tabs)) return null;

  // VNC/에디터 pane 은 대상이 아니다 — 터미널만 에이전트가 돈다.
  const candidates = [];
  tabs.forEach((tab) => {
    (tab?.panes || []).forEach((pane) => {
      if (pane?.mode && pane.mode !== 'terminal') return;
      if (paneHostId(pane) !== targetHost) return;
      if (paneCwd(pane, tab) !== targetCwd) return;
      candidates.push({ tabId: tab.id, paneId: pane.id });
    });
  });
  if (!candidates.length) return null;
  // 여러 개면 첫 번째 — 같은 호스트·같은 경로의 pane 끼리는 우열을 가릴 근거가 없다.
  return candidates[0];
}

/**
 * 세션 목록에 `pane` 필드를 붙인다. 한 번만 순회하도록 여기서 묶어 처리한다 —
 * 목록 렌더에서 매 행마다 전체 탭을 훑으면 pane 이 많을 때 낭비가 크다.
 */
export function attachPaneTargets(sessions, tabs) {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((s) => ({ ...s, pane: findPaneForSession(s, tabs) }));
}
