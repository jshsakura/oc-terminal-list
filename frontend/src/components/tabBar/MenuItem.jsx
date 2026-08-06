/**
 * One menu row. Lives in its own file so components that render menu rows can
 * import it without going through TabBarMenus — which imports them back, and a
 * cycle here shows up as a silently undefined component.
 */
import { tokens } from '../../styles/tokens';
import { glassMenuItemHover } from '../../styles/glass';

const { color } = tokens;

export const MenuItem = ({ onClick, children, danger, disabled = false, icon: Icon = null, style = null }) => (
  <button
    onClick={disabled ? undefined : (e) => { e.stopPropagation(); onClick?.(); }}
    disabled={disabled}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      textAlign: 'left',
      padding: '5px 8px',
      background: 'transparent',
      border: 'none',
      borderRadius: '5px',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? color.muted : (danger ? color.danger : color.text),
      fontSize: '11.5px',
      fontFamily: 'inherit',
      transition: 'background 120ms, box-shadow 120ms',
      lineHeight: 1.3,
      opacity: disabled ? 0.5 : 1,
      ...style,
    }}
    /* 모든 메뉴가 같은 호버를 쓴다 — 면(surface2)에 왼쪽 액센트 실마리. 유리 위에서
       반투명 면만으로는 뒤에 비치는 것과 섞여 "눌리는 줄" 이 애매해진다. */
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = glassMenuItemHover();
      e.currentTarget.style.boxShadow = `inset 2px 0 0 ${danger ? color.danger : color.accent}`;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.boxShadow = 'none';
    }}
  >
    {Icon && <Icon size={12} strokeWidth={1.8} />}
    {children}
  </button>
);
