/**
 * CSS 질감 — 전부 정적 그라디언트다(애니메이션 없음). 컴포지터 단계에서만 처리되므로
 * 화면 어디에 얹어도 프레임 비용이 없다. 저지연 원칙을 지키는 유일한 질감 방식이다.
 *
 * pane 오버레이(TerminalTexture)와 홈 배경이 같은 공식을 쓰도록 여기 하나만 둔다 —
 * 따로 적으면 두 곳의 주기·농도가 서서히 어긋난다.
 */

/**
 * 주사선. `period` px 마다 `line` 색으로 1px.
 * @param line   선 색(완전한 CSS 색 문자열). 배경 위냐 글자 위냐에 따라 잉크가 다르다.
 * @param period 몇 px 마다 한 줄을 그을지.
 */
export const scanlines = ({ line = 'rgba(0, 0, 0, 0.1)', period = 4 } = {}) => `repeating-linear-gradient(
  to bottom,
  ${line} 0px,
  ${line} 1px,
  transparent 1px,
  transparent ${period}px
)`;

/** 가장자리 어둠. CRT 곡률감의 나머지 절반. */
export const vignette = (alpha = 0.2) => `radial-gradient(ellipse at center, transparent 66%, rgba(0,0,0,${alpha}) 100%)`;

/* ─── 홈 캔버스 = 화면, 카드 = 그 위의 유리판 ──────────────────────────────
 *
 * 공식은 옆 프로젝트(game-and-what `frontend/src/theme.css`)에서 가져왔다. 거기서 배운 것:
 * 평평한 단색 위의 선은 그냥 줄무늬 벽지고, **위에서 빛이 드는 워시**가 있어야 화면이 된다.
 *
 * 다만 그쪽은 주사선을 `body::before` 로 콘텐츠 **위에** 덮는다(전체가 하나의 LCD 화면인
 * 앱이라 그게 맞다). 우리는 아니다 — 대시보드는 숫자를 읽는 화면이라 카드 위로 선이
 * 인쇄되면 값 위에 무늬가 얹혀 어수선하다. 그래서 선은 **캔버스에만** 깔고, 카드는 유리로
 * 그 위에 놓는다. 유리가 뒤의 선을 흐리게 통과시키므로 카드 안에서도 질감이 느껴지되
 * 또렷한 줄이 숫자를 가로지르지는 않는다.
 *
 * 잉크는 검정이다. 밝은 선으로 그으면 어두운 테마에서 배경과 3 RGB 차이라 안 보인다는
 * 관찰이 있었는데, 그건 워시가 없던 시절 얘기다 — 워시가 명암을 만들어주면 검정 선이
 * 밝은 테마·어두운 테마 모두에서 읽힌다.
 */
const CANVAS_LINE = 'rgba(0, 0, 0, 0.11)';
const CANVAS_PERIOD = 3;        // 1px 선 + 2px 간격

/**
 * 홈 캔버스의 주사선. 카드 **뒤에** 깔린다.
 *
 * 테마가 `texture: 'flat'` 이라고 선언하면 아무것도 얹지 않는다 — e-ink 계열은 질감의
 * **부재**가 정체성이라 거기에 주사선을 그으면 그 테마가 아니게 된다.
 *
 * 이 질감은 대시보드 카드의 유리(`styles/dashboardCard.js`)와 한 세트다 — 유리는 뒤에
 * 뭉갤 것이 있어야 유리로 읽히고, 선은 유리에 뭉개져야 화면 너머로 읽힌다.
 *
 * @returns {string|null} background-image 값, 또는 질감 없음
 */
export const canvasTexture = (theme) => {
  if (theme?.texture === 'flat') return null;
  return scanlines({ line: CANVAS_LINE, period: CANVAS_PERIOD });
};

/**
 * 캔버스 바탕 — 위쪽에서 빛이 드는 워시. 평평한 단색이면 주사선을 덮어도 종이 같다.
 * 질감을 거부하는 테마에서는 워시도 주지 않는다(그 테마의 평평함이 의도다).
 */
export const canvasWash = (theme) => {
  if (theme?.texture === 'flat') return null;
  return 'radial-gradient(circle at 50% 0%,'
    + ' color-mix(in srgb, var(--ui-text, #e4e6f1) 5%, var(--ui-base, #1a1a25)),'
    + ' var(--ui-base, #1a1a25))';
};
