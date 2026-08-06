import { tokens } from './tokens';

const { color, font, fontSize, fontWeight, motion } = tokens;

/**
 * 세그먼트 스위치 — 선택지가 유한하고 **한 번에 하나만** 켜지는 컨트롤의 공통 언어.
 *
 * 홈의 터미널/대시보드, 기간(7일·30일·90일·전체), 차트의 비용/토큰·차트/표가 모두 같은
 * 모양을 쓴다. 각자 보더 있는 버튼을 나열하면 같은 성격의 컨트롤이 화면마다 달라 보이고,
 * 무엇보다 "여러 개 중 하나" 라는 사실이 형태로 드러나지 않는다.
 *
 * 모양의 규칙 두 가지:
 *  1. **트랙은 움푹하다.** 한 단 어두운 면 + inset 그림자 — 눌린 자리.
 *  2. **선택된 것만 떠오른다.** 밝은 면 + 아래 그림자 + 위 1px 하이라이트.
 * 색만 바꾸면 그냥 색이 다른 버튼이고, 형태가 바뀌어야 스위치로 읽힌다.
 *
 * (탭바에는 쓰지 않는다 — 거긴 창틀이지 컨트롤이 아니고, 탭이 없는 자리까지 홈이 파인다.)
 */
export const segmentedTrackStyle = ({ radius: corner = '9px' } = {}) => ({
  display: 'inline-flex',
  alignItems: 'stretch',
  alignSelf: 'flex-start',
  gap: '2px',
  padding: '2px',
  borderRadius: corner,
  background: 'color-mix(in srgb, #000 20%, var(--ui-crust))',
  border: `1px solid ${color.border}`,
  boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
  maxWidth: '100%',
  boxSizing: 'border-box',
});

/**
 * 트랙 안의 한 칸.
 * @param active  선택 여부
 * @param compact 좁은 칸(기간 칩처럼 글자만 들어가는 경우)
 */
export const segmentedItemStyle = ({ active = false, compact = false } = {}) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: compact ? '0 11px' : '0 13px',
  minHeight: compact ? '26px' : '30px',
  border: 'none',
  borderRadius: '7px',
  fontSize: compact ? fontSize['11'] : fontSize['12'],
  fontWeight: fontWeight.medium,
  fontFamily: compact ? font.mono : font.sans,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `background ${motion.fast}, color ${motion.fast}`,
  background: active ? 'var(--ui-surface1)' : 'transparent',
  color: active ? color.text : color.subtext,
  /* 선택된 칸만 두께를 갖는다 — 아래 그림자로 떠오르고 위 1px 하이라이트가 모서리를 켠다. */
  boxShadow: active
    ? `0 1px 3px color-mix(in srgb, ${color.crust} 65%, transparent),`
      + ` inset 0 1px 0 color-mix(in srgb, ${color.text} 10%, transparent)`
    : 'none',
});

/** 비선택 칸의 호버 — 트랙 위에서 살짝만 밝아진다(선택 상태와 헷갈리지 않게). */
export const segmentedHoverBackground = `color-mix(in srgb, ${color.text} 7%, transparent)`;
