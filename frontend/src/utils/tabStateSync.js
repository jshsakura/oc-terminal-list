/**
 * 기기 간 tab-state 동기화용 순수 헬퍼.
 *
 * 왜 있나 — 두 기기(PC + 폰)가 동시에 열려 있으면 tab-state 가 서로를 무한히 되받아쳤다:
 *   A 가 SSE 로 서버 상태 적용 → setTabs 가 **새 배열**을 만듦 → 저장 effect 재실행 →
 *   PUT (내용은 같아도 서버는 updated_at 을 무조건 새로 찍음) → SSE → B 가 적용 → B 도 PUT → …
 * 내용이 같은 왕복이라 화면은 안 흔들리지만 1초 주기로 요청이 계속 오간다.
 * 끊는 방법은 "내용이 같으면 아무 일도 없던 것으로" — 그래서 내용 지문(fingerprint) 비교가 필요하다.
 */

// JSON 과 같은 의미로 정규화하되 키 순서에 의존하지 않게 정렬한다.
// (서버 왕복·migrateTab 을 거치면 같은 내용도 키 순서가 달라질 수 있다.)
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
        .filter(([, v]) => v !== undefined)   // JSON.stringify 와 동일하게 undefined 키는 없는 것
    );
  }
  return value;
};

/** 탭 배열의 내용 지문 — 같으면 서버/로컬 상태가 실질적으로 동일하다. */
export const tabsFingerprint = (tabs = []) => JSON.stringify(canonicalize(tabs));

/** 두 탭 배열이 내용상 같은가 (참조·키 순서 무관). */
export const areTabsEquivalent = (a, b) => tabsFingerprint(a) === tabsFingerprint(b);

/**
 * 보고 있던 탭이 사라졌을 때 어디로 갈지.
 * 다른 기기가 그 탭을 닫으면 무조건 첫 탭으로 튕기던 것을 이웃 탭으로 바꾼다 (VSCode/Zed 모델).
 * lastIndex 는 사라지기 직전 그 탭의 위치. 모르면 0 취급.
 */
export const pickFallbackTabId = (tabs = [], lastIndex = 0) => {
  if (tabs.length === 0) return null;
  const clamped = Math.min(Math.max(lastIndex, 0), tabs.length - 1);
  return tabs[clamped]?.id ?? null;
};
