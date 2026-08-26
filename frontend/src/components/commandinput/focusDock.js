/**
 * 터미널 탭 → 하단 입력 도크로 포커스.
 *
 * 왜 이벤트인가: 터미널의 터치 핸들러(`attachTerminalInteractions`)와 도크(`CommandInput`)는
 * 트리에서 멀리 떨어져 있다. prop 을 여섯 단계 내리는 대신 window 이벤트로 잇는다 —
 * 이 저장소가 `iterm:open-file` / `iterm:activity` 에 쓰는 것과 같은 패턴이다.
 *
 * ⚠️ **부르는 쪽이 탭 제스처 안에 있어야 한다.** iOS 는 사용자 제스처 밖의 focus() 로는
 * 키보드를 올리지 않는다. 그래서 이 함수는 비동기로 감싸지 않는다.
 */
export const FOCUS_DOCK_EVENT = 'iterm:focus-command-dock';

/** 도크가 떠 있으면 거기로 포커스하고 true. 없으면 아무것도 안 하고 false. */
export const focusCommandDock = () => {
  if (typeof document === 'undefined') return false;
  // 도크가 실제로 화면에 있을 때만 — 데스크탑에는 없고, 모바일도 pane 상태에 따라 없다.
  if (!document.querySelector('[data-testid="command-input-dock"] textarea')) return false;
  window.dispatchEvent(new CustomEvent(FOCUS_DOCK_EVENT));
  return true;
};
