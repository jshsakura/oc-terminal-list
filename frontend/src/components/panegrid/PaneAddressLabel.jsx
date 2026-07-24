import { memo } from 'react';
import { tokens } from '../../styles/tokens';

const { color, font, fontWeight } = tokens;

/**
 * pane 우하단의 번호 — "3번 터미널로 보내"라고 말할 수 있게 하는 라벨.
 *
 * 이 번호가 곧 `itl send 3` 의 주소다(같은 탭 안에서). 다른 탭에서 부를 땐
 * `탭.pane` 이 필요해서 tooltip 에 전체 주소를 넣어 둔다.
 *
 * 평소엔 거의 안 보이게 둔다 — 항상 또렷하면 터미널 내용과 경쟁하는 노이즈고,
 * 번호가 필요한 순간은 드물다. pane 에 마우스를 올리면 진해진다.
 * 단일 pane 탭에는 아예 그리지 않는다(부를 이름이 필요 없다).
 */
const PaneAddressLabel = memo(({ paneNumber, fullAddress = null, isProminent = false, onCopy = null, copyLabel = '' }) => (
  <span
    className="iterm-pane-address"
    role={onCopy ? 'button' : undefined}
    aria-hidden={onCopy ? undefined : true}
    title={onCopy ? copyLabel : (fullAddress ? `itl send ${fullAddress}` : undefined)}
    onClick={onCopy ? (e) => { e.stopPropagation(); onCopy(); } : undefined}
    style={{
      position: 'absolute',
      right: '6px',
      top: '4px',
      zIndex: 6,
      // 평소엔 터미널 글자 위라 클릭 통과(pointerEvents none). 복사 핸들이 붙으면 이 작은
      // 배지만 클릭 대상이 된다(주변 터미널 영역은 그대로 클릭 가능).
      pointerEvents: onCopy ? 'auto' : 'none',
      cursor: onCopy ? 'pointer' : 'default',
      minWidth: '15px',
      padding: '0 4px',
      borderRadius: '4px',
      fontFamily: font.mono,
      fontSize: '10px',
      fontWeight: fontWeight.semibold,
      lineHeight: '15px',
      textAlign: 'center',
      color: color.text,
      // 배경을 깔아 아래 글자와 겹쳐도 숫자가 읽힌다. 알파가 아니라 opaque color-mix —
      // 알파면 터미널 글자가 비쳐 숫자가 뭉개진다.
      background: `color-mix(in srgb, ${color.surface1} 82%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color.overlay0} 40%, transparent)`,
      // 우상단은 스크롤되는 출력에 묻히지 않는 자리라, 평소에도 읽히게 둔다.
      // (우하단은 출력에 가려 0.2 로도 거슬렸지만, 여기선 오히려 안 보였다.)
      opacity: isProminent ? 0.85 : 0.45,
      transition: 'opacity 120ms ease',
    }}
  >
    {paneNumber}
  </span>
));

PaneAddressLabel.displayName = 'PaneAddressLabel';

export default PaneAddressLabel;
