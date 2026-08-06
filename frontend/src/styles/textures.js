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

/* ─── 홈 캔버스 = 화면 ────────────────────────────────────────────────────
 *
 * 공식은 옆 프로젝트(game-and-what `frontend/src/theme.css`)에서 가져왔다. 처음엔 카드
 * **뒤에만** 선을 깔았는데, 그러면 카드 사이 여백에만 줄이 보여 CRT 가 아니라 그냥
 * 줄무늬 벽지가 된다. 두 가지가 그것을 화면으로 바꾼다:
 *
 *   1. 주사선은 콘텐츠 **위를** 덮는다(오버레이). 카드 위로도 지나가야 화면이 된다.
 *   2. 바탕은 평평한 색이 아니라 위에서 빛이 드는 radial 워시다.
 *
 * 잉크는 검정이다. 밝은 선으로 그으면 어두운 테마에서 배경과 3 RGB 차이라 안 보인다는
 * 이유로 한 번 밝은 잉크를 썼는데, 그건 "뒤에 깔던" 시절의 보정이었다 — 위에 덮는
 * 순간 검정 선이 명암 파동을 만들어 어두운 테마·밝은 테마 모두에서 성립한다.
 */
/* 0.06 * opacity .5 = 실효 0.03 이 레퍼런스 값인데, 우리 홈은 카드가 화면을 많이
   덮어 선이 지나는 면적이 작다 — 한 단계 올려야 같은 정도로 읽힌다. */
const CANVAS_LINE = 'rgba(0, 0, 0, 0.11)';
const CANVAS_PERIOD = 3;        // 1px 선 + 2px 간격
/** 오버레이 자체의 불투명도 — 선을 더 옅게 만들되 주기는 유지한다. */
export const CANVAS_TEXTURE_OPACITY = 0.5;

/**
 * 홈 캔버스 위에 덮는 주사선.
 *
 * 테마가 `texture: 'flat'` 이라고 선언하면 아무것도 얹지 않는다 — e-ink 계열은 질감의
 * **부재**가 정체성이라 거기에 주사선을 그으면 그 테마가 아니게 된다. 그 외에는(필드가
 * 없는 대부분의 테마 포함) 옅은 주사선을 덮는다.
 *
 * 이 질감은 대시보드 카드의 유리(`styles/dashboardCard.js`)와 한 세트다 — 유리는 뒤에
 * 뭉갤 것이 있어야 유리로 읽히고, 주사선은 유리 위를 지나야 화면으로 읽힌다.
 *
 * @returns {string|null} background 값, 또는 질감 없음
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
