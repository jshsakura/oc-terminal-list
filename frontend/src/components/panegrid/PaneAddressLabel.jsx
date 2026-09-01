import { memo } from 'react';
import { tokens } from '../../styles/tokens';
import { numberDividerStyle } from '../../styles/numberTile';

const { color, font, fontWeight } = tokens;

/**
 * pane 우상단의 주소 배지 — `탭.pane`. 그게 전부다.
 *
 * 주소가 필요한 이유는 하나뿐이다: **자기 주소를 자기가 볼 방법이 없으면 "옆에 2번한테
 * 시켜" 라고 말할 수 없다.** 하단 tmux 상태바의 `[1.2]` 와 같은 값이고, 같은 이유로 있다.
 *
 * ⚠️ **여기에 다른 것을 붙이지 않는다.** 한때 pane 이름·복사 버튼·접기 핸들이 함께
 * 달려 있었다. 그 복사는 "이 터미널을 봐" 라고 남의 에이전트에게 건네는 tmux attach
 * 핸들이었는데, 그 쓰임(itl · 세션 간 명령 전달)이 통째로 사라지면서 남은 건 터미널
 * 출력을 덮는 상자뿐이었다. 배지는 읽는 것이지 누르는 것이 아니다 —
 * `pointerEvents: none` 이라 아래 터미널이 그대로 클릭된다.
 *
 * 평소엔 옅게, pane 에 포커스/호버하면 진하게.
 */
const addressGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  flexShrink: 0,
  fontFamily: font.mono,
  fontWeight: fontWeight.semibold,
  lineHeight: 1,
};

const PaneAddressLabel = memo(({
  paneNumber, tabNumber = null, fullAddress = null, isProminent = false,
}) => (
  <span
    className="iterm-pane-address"
    aria-hidden
    title={fullAddress || undefined}
    style={{
      position: 'absolute',
      right: '6px',
      top: '4px',
      zIndex: 6,
      // 터미널 글자 위에 뜨는 라벨이므로 클릭은 통과시킨다.
      pointerEvents: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      height: '20px',
      minWidth: '20px',
      width: 'max-content',
      maxWidth: 'calc(100% - 12px)',
      padding: '0 7px',
      borderRadius: '5px',
      // 모노 숫자는 같은 px 에서 sans 보다 크게 보인다.
      fontSize: '9px',
      lineHeight: 1,
      color: color.text,
      // 알파가 아니라 opaque color-mix — 알파면 터미널 글자가 비쳐 숫자가 뭉개진다.
      background: `color-mix(in srgb, ${color.surface1} var(--glass-fill, 82%), transparent)`,
      border: `1px solid color-mix(in srgb, ${color.overlay0} 40%, transparent)`,
      opacity: isProminent ? 0.9 : 0.6,
      transition: 'opacity 120ms ease',
    }}
  >
    {/* 앞이 탭 번호, 뒤가 pane 번호이고 둘이 합쳐 `1.3`.
        탭 번호를 모르면(목록에 없는 탭) pane 번호만 — 틀린 주소를 그리느니 안 그린다. */}
    <span style={addressGroupStyle}>
      {tabNumber != null && (
        <>
          <span>{tabNumber}</span>
          <span aria-hidden style={numberDividerStyle} />
        </>
      )}
      <span>{paneNumber}</span>
    </span>
  </span>
));

PaneAddressLabel.displayName = 'PaneAddressLabel';

export default PaneAddressLabel;
