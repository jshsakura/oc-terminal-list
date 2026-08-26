/**
 * 포인터(터치·마우스)로 눌린 버튼에서 포커스를 뗀다. 키보드 활성화는 건드리지 않는다.
 *
 * ⚠️ 왜 필요한가: 툴바 버튼을 탭하면 그 버튼이 포커스를 쥔 채 남고, 브라우저·플랫폼마다
 * 거기에 제 나름의 링을 그린다(안드로이드 크롬은 흰 테두리). `outline: none` 으로
 * 하나씩 막는 방식은 **막는 쪽이 늘 한 발 늦는다** — 어떤 브라우저가 무엇으로 그릴지
 * 우리가 정하지 못하기 때문이다. 포커스를 아예 안 남기면 그릴 것이 없다.
 *
 * `event.detail === 0` 은 키보드(Enter/Space)로 활성화됐다는 뜻이다. 그때는 포커스가
 * 남아야 다음 Tab 이 이어진다 — 그래서 그 경우만 남긴다.
 */
export const blurIfPointer = (event) => {
  if (event?.detail > 0) event.currentTarget?.blur?.();
};

export default blurIfPointer;
