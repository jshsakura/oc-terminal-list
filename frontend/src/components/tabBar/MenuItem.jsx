/**
 * One menu row. Lives in its own file so components that render menu rows can
 * import it without going through TabBarMenus — which imports them back, and a
 * cycle here shows up as a silently undefined component.
 */
import { tokens } from '../../styles/tokens';

const { color } = tokens;

export const MenuItem = ({ onClick, children, danger, disabled = false, icon: Icon = null, style = null }) => (
  <button
    /* Hover is one CSS rule (main.jsx `.iterm-menu-item`) — wiring it per menu in JS
       means fixing one place leaves the others behind (the settings submenu was one). */
    className={`iterm-menu-item${danger ? ' iterm-menu-item-danger' : ''}`}
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
  >
    {Icon && <Icon size={12} strokeWidth={1.8} />}
    {children}
  </button>
);
