import { memo } from 'react';
import { Copy } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { numberDividerStyle } from '../../styles/numberTile';

const { color, font, fontWeight } = tokens;

/**
 * pane 우상단의 주소 배지 — "3번 터미널로 보내"라고 말할 수 있게 하는 라벨.
 *
 * `탭|pane` 이 곧 `itl send 1.3` 의 주소다. 이름을 함께 다는 이유는 분할 화면(데스크탑)엔
 * 서브탭바가 없어 pane 이름이 나올 자리가 여기뿐이기 때문.
 *
 * **접기/펼치기**: 이름까지 펼치면 그만큼 터미널 출력을 덮는다. 주소만 남기고 접을 수
 * 있어야 방해가 안 된다. 접힘 상태는 호출부가 들고 있다(설정에 저장 → 새로고침해도 유지).
 *
 * 평소엔 옅게 두고 pane 에 포커스/호버하면 진해진다. 단일 pane 탭엔 아예 그리지 않는다.
 *
 * 배지 안에 배경 깔린 상자를 또 넣지 않는다: 배지 자체가 이미 면이라 이중이 되고,
 * 한쪽만 패딩이 두 겹으로 쌓여 숫자가 밀려 보인다.
 */
const addressGroupStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  flexShrink: 0,
  fontFamily: font.mono,
  fontWeight: fontWeight.semibold,
  // 모노 숫자는 같은 px 에서 sans 보다 크게 보인다 — 이름(10px)보다 한 단계 낮춘다.
  fontSize: '9px',
  lineHeight: 1,
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  fontSize: 'inherit',
};

const iconBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '15px',
  height: '15px',
  flexShrink: 0,
  padding: 0,
  background: 'none',
  border: 'none',
  borderRadius: '3px',
  color: color.subtext,
  cursor: 'pointer',
};

const PaneAddressLabel = memo(({
  paneNumber, tabNumber = null, paneLabel = null, fullAddress = null,
  isProminent = false, onCopy = null, copyLabel = '',
  isExpanded = true, onToggleExpand = null, expandLabel = '', collapseLabel = '',
}) => {
  const isInteractive = !!(onCopy || onToggleExpand);
  const showName = isExpanded && !!paneLabel;
  return (
    <span
      className="iterm-pane-address"
      aria-hidden={isInteractive ? undefined : true}
      style={{
        position: 'absolute',
        right: '6px',
        top: '4px',
        zIndex: 6,
        // 평소엔 터미널 글자 위라 클릭 통과(pointerEvents none). 조작 핸들이 붙으면 이 작은
        // 배지만 클릭 대상이 된다(주변 터미널 영역은 그대로 클릭 가능).
        pointerEvents: isInteractive ? 'auto' : 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        // 배지가 15px 밖에 안 돼 납작했다. 20px 로 세우고 좌우도 7px 로 — 접어서 숫자만
        // 남았을 때 특히 5px 은 글자가 테두리에 붙어 보였다.
        height: '20px',
        minWidth: '20px',
        // 폭은 내용만큼만 — 펼쳤다고 넓게 잡아둘 이유는 없고, 대신 %로 묶어 잘리지도 않게.
        // pane 밖으로 나가지 않는 선(좌우 6px 여백)에서만 말줄임이 걸린다.
        width: 'max-content',
        maxWidth: 'calc(100% - 12px)',
        padding: '0 7px',
        borderRadius: '5px',
        fontSize: '10px',
        lineHeight: 1,
        color: color.text,
        // 배경을 깔아 아래 글자와 겹쳐도 숫자가 읽힌다. 알파가 아니라 opaque color-mix —
        // 알파면 터미널 글자가 비쳐 숫자가 뭉개진다.
        background: `color-mix(in srgb, ${color.surface1} 82%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color.overlay0} 40%, transparent)`,
        // 우상단은 스크롤되는 출력에 묻히지 않는 자리라, 평소에도 읽히게 둔다.
        opacity: isProminent ? 0.9 : 0.6,
        transition: 'opacity 120ms ease',
      }}
    >
      {/* 주소 = 접기/펼치기 핸들. 앞이 탭 번호, 뒤가 pane 번호이고 둘이 합쳐 `itl send 1.3`.
          탭 번호를 모르면(목록에 없는 탭) pane 번호만 — 틀린 주소를 그리느니 안 그린다. */}
      <button
        type="button"
        style={{ ...addressGroupStyle, cursor: onToggleExpand ? 'pointer' : 'default' }}
        title={onToggleExpand
          ? (isExpanded ? collapseLabel : expandLabel)
          : (fullAddress ? `itl send ${fullAddress}` : undefined)}
        onClick={onToggleExpand ? (e) => { e.stopPropagation(); onToggleExpand(); } : undefined}
      >
        {tabNumber != null && (
          <>
            <span>{tabNumber}</span>
            <span aria-hidden style={numberDividerStyle} />
          </>
        )}
        <span>{paneNumber}</span>
      </button>

      {/* 이름은 sans — 분할 화면에는 서브탭바가 없어서 여기 말고는 pane 이름이 나올 자리가 없다. */}
      {showName && (
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
      )}

      {/* 복사는 **별도 버튼**이다. 배지 전체가 복사 버튼이면 접기 핸들과 겸직할 수 없고,
          주소를 읽으려 눌렀을 뿐인데 클립보드가 바뀌는 사고도 난다. */}
      {onCopy && isExpanded && (
        <button
          type="button"
          style={iconBtnStyle}
          title={copyLabel}
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = color.subtext; }}
        >
          <Copy size={10} strokeWidth={2} />
        </button>
      )}
    </span>
  );
});

PaneAddressLabel.displayName = 'PaneAddressLabel';

export default PaneAddressLabel;
