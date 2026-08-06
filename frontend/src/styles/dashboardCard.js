import { tokens } from './tokens';

const { color, radius, space } = tokens;

/**
 * 대시보드 카드 한 장의 면.
 *
 * **유리는 뒤에 비칠 것이 있을 때만 유리다.** 예전에 카드에 유리를 씌웠다가 되돌린 이유가
 * 그것이었다 — 평평한 배경 위에서는 블러가 뭉갤 대상이 없어 "그냥 투명" 해 보였다.
 * 지금은 홈 캔버스에 주사선이 깔려 있어(`styles/textures.js` `canvasTexture`) 블러가
 * 실제로 선을 뭉갠다. 그래서 카드 안쪽이 젖빛 유리로 읽히고, 배경이 그대로 보이는 곳과
 * 경계가 생긴다 — 이 두 가지는 한 세트라 하나만 떼면 둘 다 의미를 잃는다.
 *
 * 타일·막대·차트 카드가 모두 이 하나를 쓴다. 각자 그리면 곧 농도가 어긋난다.
 */
export const dashboardCardStyle = ({ padding = space['3'], corner = radius.md } = {}) => ({
  padding,
  borderRadius: corner,
  /* 완전 불투명이면 뒤가 안 비치고, 너무 투명하면 글씨가 배경 선 위에 얹혀 읽기 힘들다.
     62% 는 주사선이 흐릿하게 비치되 본문 대비는 지키는 지점이다(실측으로 고른 값). */
  background: `color-mix(in srgb, ${color.surface0} 62%, transparent)`,
  border: `1px solid ${color.borderStrong}`,
  /* 위쪽 1px 하이라이트가 유리의 두께를 만든다 — 이게 없으면 그냥 반투명 사각형이다.
     **흰색을 박지 않는다**: 라이트 테마에서 흰 하이라이트는 사라지고 검은 그림자는
     지나치게 무겁다. 테마의 text/crust 에서 뽑으면 어두운 테마에선 밝은 테두리,
     밝은 테마에선 또렷한 경계선이 되어 양쪽 다 성립한다. */
  boxShadow: `0 2px 10px color-mix(in srgb, ${color.crust} 55%, transparent),`
    + ` inset 0 1px 0 color-mix(in srgb, ${color.text} 7%, transparent)`,
  backdropFilter: 'blur(var(--glass-blur-card, 12px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-card, 12px))',
});

export default dashboardCardStyle;
