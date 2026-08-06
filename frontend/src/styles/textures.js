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

/* 배경 주사선의 잉크는 **테마 글자색**이다. 검정으로 그으면 어두운 테마에서 선이 배경과
   3 RGB 차이밖에 안 나 아무것도 안 보이고(실측), 밝은 테마에서는 도리어 때 탄 것처럼
   보인다. 글자색을 쓰면 어두운 테마엔 밝은 선, 밝은 테마엔 어두운 선이 되어 한 공식으로
   양쪽이 성립한다 — 테마가 바뀌면 CSS 변수만 바뀌므로 리렌더도 필요 없다. */
const CANVAS_INK = (pct) => `color-mix(in srgb, var(--ui-text, #e4e6f1) ${pct}%, transparent)`;
const CANVAS_ALPHA_DARK = 7;
const CANVAS_ALPHA_LIGHT = 5;   // 밝은 바탕에서 같은 농도면 줄무늬가 지저분해진다
const CANVAS_PERIOD = 4;

/**
 * 홈 캔버스 배경 질감.
 *
 * 테마가 `texture: 'flat'` 이라고 선언하면 아무것도 얹지 않는다 — e-ink 계열은 질감의
 * **부재**가 정체성이라 거기에 주사선을 그으면 그 테마가 아니게 된다. 그 외에는(필드가
 * 없는 대부분의 테마 포함) 옅은 주사선을 깐다.
 *
 * 이 질감은 대시보드 카드의 유리(`styles/dashboardCard.js`)와 한 세트다. 뒤에 뭉갤 것이
 * 있어야 블러가 유리로 읽힌다 — 하나만 떼면 둘 다 의미를 잃는다.
 *
 * @returns {string|null} backgroundImage 값, 또는 질감 없음
 */
export const canvasTexture = (theme, { light = false } = {}) => {
  if (theme?.texture === 'flat') return null;
  return scanlines({
    line: CANVAS_INK(light ? CANVAS_ALPHA_LIGHT : CANVAS_ALPHA_DARK),
    period: CANVAS_PERIOD,
  });
};
