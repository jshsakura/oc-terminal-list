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
// 주소는 **한 쌍**이다. `1.1` 을 점 찍힌 문자열로 쓰면 터미널 출력에 섞여 그냥 숫자로
// 보이므로 가운데를 옅은 구분선으로 끊는다 — 그래도 두 값은 한 덩어리로 붙어 있어야 한다.
//
// 배지 안에 배경 깔린 상자를 또 넣지 않는다: 배지 자체가 이미 면이라 이중이 되고,
// 왼쪽만 패딩이 두 겹(배지 + 상자)으로 쌓여 숫자가 안으로 밀려 보인다.
const addressGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  flexShrink: 0,
  fontFamily: font.mono,
  fontWeight: fontWeight.semibold,
  lineHeight: 1,
};

const addressDividerStyle = {
  width: '1px',
  height: '8px',
  flexShrink: 0,
  background: `color-mix(in srgb, ${color.text} 22%, transparent)`,
};

const PaneAddressLabel = memo(({
  paneNumber, tabNumber = null, paneLabel = null, fullAddress = null,
  isProminent = false, onCopy = null, copyLabel = '',
}) => (
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
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      minWidth: '15px',
      // 이름이 길어도 터미널 가로를 잠식하지 않게 — 넘치면 말줄임.
      maxWidth: '45%',
      padding: '0 5px',
      borderRadius: '4px',
      fontSize: '10px',
      lineHeight: '15px',
      color: color.text,
      // 배경을 깔아 아래 글자와 겹쳐도 숫자가 읽힌다. 알파가 아니라 opaque color-mix —
      // 알파면 터미널 글자가 비쳐 숫자가 뭉개진다.
      background: `color-mix(in srgb, ${color.surface1} 82%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color.overlay0} 40%, transparent)`,
      // 우상단은 스크롤되는 출력에 묻히지 않는 자리라, 평소에도 읽히게 둔다.
      // (우하단은 출력에 가려 0.2 로도 거슬렸지만, 여기선 오히려 안 보였다.)
      // 숫자만 있던 시절엔 0.45 로도 읽혔지만, 이름이 붙으면서 폭이 넓어져 아래 출력과
      // 섞이면 뭉갠다 — 이름이 읽히라고 붙인 것이니 idle 도 0.6 까지 올린다.
      opacity: isProminent ? 0.9 : 0.6,
      transition: 'opacity 120ms ease',
    }}
  >
    {/* 앞 = 탭 번호, 뒤 = pane 번호. 둘이 합쳐 `itl send 1.3` 의 주소가 된다.
        탭 번호를 모르면(목록에 없는 탭) pane 번호만 — 틀린 주소를 그리느니 안 그린다. */}
    <span style={addressGroupStyle}>
      {tabNumber != null && (
        <>
          <span>{tabNumber}</span>
          <span aria-hidden style={addressDividerStyle} />
        </>
      )}
      <span>{paneNumber}</span>
    </span>
    {/* 이름은 sans — 분할 화면에는 서브탭바가 없어서 여기 말고는 pane 이름이 나올 자리가 없다. */}
    {paneLabel ? (
      <span
        style={{
          fontFamily: font.sans,
          fontWeight: fontWeight.medium,
          color: color.subtext,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {paneLabel}
      </span>
    ) : null}
  </span>
));

PaneAddressLabel.displayName = 'PaneAddressLabel';

export default PaneAddressLabel;
