import { tokens } from './tokens';

const { color, font, fontWeight } = tokens;

/**
 * 숫자를 담는 네모 타일 — 탭 번호(Ctrl+N), 서브탭 번호, pane 주소 배지가 **같은 모양**을 쓴다.
 *
 * 맨 숫자로 두면 sans 라벨 옆에서 떠도는 모노 글자로 보이지만, 아이콘 타일과 같은 네모에
 * 담으면 "식별자"로 읽힌다. 세 곳이 각자 그리면 곧 어긋나므로 여기 하나로 둔다.
 *
 * @param size  타일 한 변(px). 아이콘 타일보다 살짝 작게 두면 아이콘이 주, 숫자가 부로 읽힌다.
 * @param base  타일이 얹히는 바탕색. **알파가 아니라 opaque color-mix** 로 섞기 위해 필요하다 —
 *              알파면 아래 글자(터미널 출력/탭 배경)가 비쳐 숫자가 뭉개진다.
 */
export const numberTileStyle = ({ size = 14, fontSize = '9.5px', base = 'transparent', dim = false } = {}) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: `${size}px`,
  height: `${size}px`,
  padding: '0 2px',
  boxSizing: 'border-box',
  borderRadius: '4px',
  background: `color-mix(in srgb, ${color.text} ${dim ? 6 : 9}%, ${base})`,
  border: `1px solid color-mix(in srgb, ${color.text} ${dim ? 8 : 13}%, ${base})`,
  fontFamily: font.mono,
  fontWeight: fontWeight.semibold,
  fontSize,
  lineHeight: 1,
  flexShrink: 0,
});

export default numberTileStyle;
