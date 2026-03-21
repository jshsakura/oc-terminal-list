import React from 'react';

const Button = ({ 
  children, 
  onClick, 
  variant = 'secondary', 
  size = 'medium', 
  disabled = false, 
  style = {}, 
  theme,
  title,
  icon: Icon,
  fullWidth = false
}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: theme.ui.accent,
          color: theme.ui.bg,
          boxShadow: `0 2px 8px ${theme.ui.accent}33`,
        };
      case 'danger':
        return {
          backgroundColor: 'rgba(243, 139, 168, 0.15)',
          color: theme.red,
          border: `1px solid ${theme.red}44`,
        };
      case 'warning':
        return {
          backgroundColor: 'rgba(250, 179, 135, 0.15)',
          color: theme.yellow,
          border: `1px solid ${theme.yellow}44`,
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          color: theme.ui.iconColor,
        };
      case 'secondary':
      default:
        return {
          backgroundColor: theme.ui.bgTertiary,
          color: theme.ui.text,
          border: `1px solid ${theme.ui.borderLight}`,
        };
    }
  };

  const getSizeStyle = () => {
    switch (size) {
      case 'small':
        return { padding: '4px 8px', fontSize: '11px', height: '28px' };
      case 'large':
        return { padding: '12px 24px', fontSize: '15px', height: '44px' };
      case 'icon':
        return { padding: '0', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
      case 'medium':
      default:
        return { padding: '8px 16px', fontSize: '13px', height: '36px' };
    }
  };

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: theme.ui.radiusSmall || '2px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '700',
    transition: 'all 0.15s ease',
    opacity: disabled ? 0.5 : 1,
    width: fullWidth ? '100%' : 'auto',
    userSelect: 'none',
    fontFamily: 'inherit',
    ...getVariantStyle(),
    ...getSizeStyle(),
    ...style,
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      style={baseStyle}
      title={title}
    >
      {Icon && <Icon size={size === 'small' ? 14 : 16} strokeWidth={2.5} />}
      {children}
    </button>
  );
};

export default Button;
