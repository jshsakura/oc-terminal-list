import { tokens } from '../../styles/tokens';

const { color, fontSize, fontWeight, radius, motion, space } = tokens;

const variantStyle = {
  primary: {
    background: color.accent,
    color: color.crust,
    border: '1px solid transparent',
  },
  secondary: {
    background: color.surface0,
    color: color.text,
    border: `1px solid ${color.border}`,
  },
  ghost: {
    background: 'transparent',
    color: color.subtext,
    border: `1px solid ${color.border}`,
  },
  // Filled, same weight as `primary` — it is the dialog's main action, just a
  // destructive one. Outlined-on-neutral-border read *weaker* than the
  // `secondary` cancel button sitting next to it, which inverts the hierarchy
  // and makes the button look unpainted.
  danger: {
    background: color.danger,
    color: color.crust,
    border: '1px solid transparent',
  },
};

// Variants that paint a surface — hover dims them instead of touching the border.
const FILLED_VARIANTS = new Set(['primary', 'danger']);

const sizeStyle = {
  small:  { height: '24px', fontSize: fontSize['11'], padding: `0 10px` },
  medium: { height: '30px', fontSize: fontSize['13'], padding: `0 ${space['4']}` },
  large:  { height: '36px', fontSize: fontSize['13'], padding: `0 ${space['5']}` },
  icon:   { width: '28px', height: '28px', padding: 0 },
};

const Button = ({
  children,
  onClick,
  variant = 'secondary',
  size = 'medium',
  disabled = false,
  style = {},
  title,
  icon: Icon,
  fullWidth = false,
  type = 'button',
}) => {
  const v = variantStyle[variant] || variantStyle.secondary;
  const s = sizeStyle[size] || sizeStyle.medium;

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space['1.5'],
    borderRadius: radius.sm,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: fontWeight.medium,
    fontFamily: 'inherit',
    letterSpacing: 'normal',
    transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}, opacity ${motion.fast}`,
    opacity: disabled ? 0.45 : 1,
    width: fullWidth ? '100%' : (size === 'icon' ? s.width : 'auto'),
    userSelect: 'none',
    outline: 'none',
    ...v,
    ...s,
    ...style,
  };

  const iconSize = size === 'small' ? 13 : 14;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={baseStyle}
      title={title}
      onMouseEnter={(e) => {
        if (disabled) return;
        // Filled variants dim; outlined ones have no fill to dim, so they
        // strengthen their border instead.
        if (FILLED_VARIANTS.has(variant)) {
          e.currentTarget.style.opacity = '0.92';
        } else if (variant === 'ghost') {
          e.currentTarget.style.background = color.surface0;
        } else {
          e.currentTarget.style.borderColor = color.borderStrong;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = disabled ? '0.45' : '1';
        e.currentTarget.style.background = v.background;
        // border 는 전체 shorthand 로 복원 — rgba() 처럼 공백 포함 컬러 호환
        e.currentTarget.style.border = v.border;
      }}
    >
      {Icon && <Icon size={iconSize} strokeWidth={2} />}
      {children}
    </button>
  );
};

export default Button;
