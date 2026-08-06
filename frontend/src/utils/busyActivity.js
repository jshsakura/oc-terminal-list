/**
 * 탭/pane busy 인디케이터의 순수 파생부.
 *
 * App.jsx 안에 인라인으로 있던 로직인데, App.jsx 에는 렌더 테스트가 없어서 그 안에 두면
 * 테스트가 0 이다(CLAUDE.md "Frontend derivation utils"). 타이머·이벤트 배선만 App 에 남기고
 * 판정은 여기서 한다.
 *
 * `idle` 이 이 모듈의 존재 이유다 — 예전에는 150ms 틱이 **영영** 돌았다. 아무 출력도 없고
 * busy 도 없는 상태에서 초당 6.7회 Set 두 개를 만들고 탭×pane 을 순회했다. 지금은 남은 게
 * 없으면 idle 을 돌려주고 호출부가 타이머를 끈다(다음 활동 이벤트가 다시 켠다).
 */

/* 마지막 출력 후 이만큼 동안은 busy 로 본다. 출력 burst 사이의 짧은 휴지(컴파일 단계 사이,
   prompt 대기)에 깜빡이지 않게 하는 유지 창 — 진짜 idle 이면 자연히 꺼진다. */
export const BUSY_WINDOW_MS = 3500;

/**
 * 만료분을 걸러낸 새 activity 맵과 busy pane/tab 집합을 만든다.
 * 입력은 건드리지 않는다 — 호출부는 반환된 `activity` 로 교체한다.
 *
 * @param {Map<string, number>} activity paneId → 마지막 활동 시각(ms)
 * @param {Array} tabs 탭 목록 (각 탭의 `panes[].id` 로 pane→탭을 되짚는다)
 * @param {number} now 기준 시각(ms)
 * @returns {{ activity: Map, panes: Set<string>, tabs: Set<string>, idle: boolean }}
 */
export const deriveBusy = ({ activity, tabs = [], now, windowMs = BUSY_WINDOW_MS }) => {
  const live = new Map();
  const panes = new Set();
  for (const [paneId, ts] of activity) {
    if (now - ts >= windowMs) continue;
    live.set(paneId, ts);
    panes.add(paneId);
  }

  const tabIds = new Set();
  for (const tab of tabs) {
    if (tab?.panes?.some((p) => panes.has(p?.id))) tabIds.add(tab.id);
  }

  // 남은 게 없다 = 다음 틱에 할 일이 없다. 호출부가 타이머를 멈춰도 된다.
  return { activity: live, panes, tabs: tabIds, idle: live.size === 0 };
};

/** 두 집합이 같은 원소를 갖는가 — setState 를 걸러 불필요한 리렌더를 막는 데 쓴다. */
export const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
