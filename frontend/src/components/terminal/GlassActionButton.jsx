import { styles } from './terminalStyles';

/**
 * 상태 카드(종료/인계/연결실패) 안의 글래스 액션 버튼.
 *
 * 호버 시 배경 농도를 22% → 35% 로 올리는 패턴이 카드마다 손으로 복붙돼 있었다.
 * 색만 바뀌고 나머지는 같아서 여기로 모은다. 비활성일 땐 호버 반응 없음.
 */
const GlassActionButton = ({
  themeUi,
  color,
  onClick,
  disabled = false,
  title,
  style,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      ...styles.glassActionBtn(themeUi, color),
      ...(disabled ? { opacity: 0.7 } : null),
      ...style,
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = `color-mix(in srgb, ${color} 35%, transparent)`;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = `color-mix(in srgb, ${color} 22%, transparent)`;
    }}
  >
    {children}
  </button>
);

export default GlassActionButton;
