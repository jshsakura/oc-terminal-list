import { memo } from 'react';
import { Copy } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, font, fontWeight } = tokens;

/**
 * pane 우상단의 주소 배지 — `탭.pane`. 그게 전부다.
 *
 * 주소가 필요한 이유는 하나뿐이다: **자기 주소를 자기가 볼 방법이 없으면 "옆에 2번한테
 * 시켜" 라고 말할 수 없다.** 하단 tmux 상태바의 `[1.2]` 와 같은 값이고, 같은 이유로 있다.
 *
 * ⚠️ **이름과 접기 핸들은 다시 붙이지 않는다.** 한때 셋 다 달려 있었고, 이름은 터미널
 * 출력을 덮었으며 접기 핸들은 주소를 읽으려다 누르게 만들었다.
 *
 * 복사 버튼은 **`onCopy` 를 받았을 때만** 나온다. 핸들이 `itl send 1.2 'TEXT'` 라,
 * 붙여넣는 쪽 셸에 `itl` 이 없으면 `command not found` 로 끝나기 때문이다 — 없는 도구를
 * 쓰라고 내미느니 안 내민다(호출부가 `itl_available` 로 가른다).
 *
 * 버튼이 없으면 `pointerEvents: none` 이라 아래 터미널이 그대로 클릭된다. 버튼이 붙어도
 * **이 작은 상자만** 클릭 대상이고 주변 터미널은 그대로다.
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

const copyBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '15px',
  height: '15px',
  flexShrink: 0,
  padding: 0,
  marginLeft: '4px',
  background: 'none',
  border: 'none',
  borderRadius: '3px',
  color: color.subtext,
  cursor: 'pointer',
};

const PaneAddressLabel = memo(({
  paneNumber, tabNumber = null, fullAddress = null, isProminent = false,
  onCopy = null, copyLabel = '',
}) => (
  <span
    className="iterm-pane-address"
    aria-hidden={onCopy ? undefined : true}
    title={fullAddress || undefined}
    style={{
      position: 'absolute',
      right: '6px',
      top: '4px',
      zIndex: 6,
      // 평소엔 터미널 글자 위라 클릭을 통과시킨다. 복사 버튼이 붙을 때만 대상이 된다.
      pointerEvents: onCopy ? 'auto' : 'none',
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
      {/* 구분자는 점 하나로 충분하다. 예전에는 `numberTile` 의 스타일 상수를 썼는데,
          그 export 가 사라진 뒤에도 **테스트는 통과했다** — undefined 인 style 은 조용히
          무시되기 때문이다. 값 하나에 모듈을 걸 이유가 없다. */}
      {tabNumber != null && <span>{`${tabNumber}.`}</span>}
      <span>{paneNumber}</span>
    </span>

    {onCopy && (
      <button
        type="button"
        style={copyBtnStyle}
        title={copyLabel}
        onClick={(e) => { e.stopPropagation(); onCopy(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface2; e.currentTarget.style.color = color.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = color.subtext; }}
      >
        <Copy size={10} strokeWidth={2} />
      </button>
    )}
  </span>
));

PaneAddressLabel.displayName = 'PaneAddressLabel';

export default PaneAddressLabel;
