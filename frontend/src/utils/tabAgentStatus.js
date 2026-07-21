/**
 * 탭 하나의 대표 에이전트 상태 — 그 탭 안 pane 들 중 가장 손이 필요한 것.
 *
 * 우선순위: permission > working > idle.
 * 분할 탭에서 한 pane 이 허락을 기다리면 그게 나머지 어떤 상태보다 급하다.
 */

const PRIORITY = { permission: 3, working: 2, idle: 1 };

export const deriveTabAgentStatus = (tab, statusMap) => {
  if (!tab || !statusMap) return null;
  const panes = tab.panes || [];
  let best = null;
  for (const pane of panes) {
    const status = statusMap[pane?.sessionId]?.status;
    if (!status) continue;
    if (!best || PRIORITY[status] > PRIORITY[best]) best = status;
  }
  return best;
};

/**
 * 탭 뱃지로 그릴 가치가 있는 상태인가.
 *
 * idle 은 뺀다 — claude 를 띄워둔 탭 전부에 상시 점이 켜지면 그냥 노이즈고,
 * "평소" 와 "볼 것 있음" 이 구분되지 않는다. 정보가 있는 건 두 가지뿐이다:
 * 지금 돌고 있다(working), 그리고 나를 기다린다(permission).
 */
export const isNotableAgentStatus = (status) => status === 'working' || status === 'permission';
