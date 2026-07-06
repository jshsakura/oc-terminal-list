/**
 * 레트로 CRT 스캔라인 — "터미널 외 영역"의 단순 배경에만 얹는 장식 레이어.
 *
 * 설계 의도:
 *  - 배경 *레이어* 로만 쓴다(overlay 아님). `background: SCANLINE_BG, <baseColor>` 처럼
 *    베이스 색 위에 미세한 가로 줄무늬를 깐다.
 *  - 터미널 pane(불투명 배경)·버튼·아이콘 등은 자기 배경을 그 위에 그리므로
 *    스캔라인이 얹히지 않는다 → 사용자 요구("버튼/요소엔 넣지 말고 배경에만") 충족.
 *  - JS 비용 0 (정적 CSS 그라디언트).
 *
 * 톤: 어두운 테마 기준으로 아주 옅은 밝은 줄(1px)을 3px 주기로. 은은하게 보이되 거슬리지 않게.
 */
export const SCANLINE_BG =
  'repeating-linear-gradient(0deg,' +
  ' rgba(255,255,255,0.08) 0px,' +
  ' rgba(255,255,255,0.08) 1px,' +
  ' transparent 1px,' +
  ' transparent 3px)';

/** 베이스 배경(색/그라디언트) 위에 스캔라인을 얹어 background 축약값을 만든다. */
export const withScanlines = (base) => `${SCANLINE_BG}, ${base}`;
