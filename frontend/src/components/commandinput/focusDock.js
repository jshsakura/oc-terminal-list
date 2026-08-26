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

/**
 * 퀵바(MobileToolbar) 안의 고정 슬롯 id.
 *
 * 대상 선택·히스토리 토글은 입력 도크의 것이지만 **그리는 자리는 퀵바**다 — 도크에 두면
 * 줄이 하나 더 생기고, 폰에서 도크가 먹는 높이가 곧 터미널이 잃는 높이이기 때문이다.
 * 도크가 이 노드로 포탈한다. 슬롯이 없으면(데스크탑) 아무 일도 일어나지 않는다.
 */
export const DOCK_SLOT_ID = 'iterm-dock-slot';

/**
 * 도크와 그 슬롯이 화면 가장자리에서 띄우는 폭(px).
 *
 * 두 줄(퀵바의 슬롯 · 도크 입력줄)이 세로로 맞닿아 있으므로, 왼쪽 여백이 서로 다르면
 * 위아래 버튼이 어긋나 보인다. 실제로 슬롯은 0 이었고 — 대상 선택 버튼이 화면 왼쪽
 * 끝에 붙어 테두리가 잘린 것처럼 보였다. 두 파일이 이 값을 같이 쓴다.
 */
export const DOCK_EDGE_GUTTER = 6;
