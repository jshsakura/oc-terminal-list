import { useState } from 'react';
import { Eye, EyeOff, Check, ClipboardPaste } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { font, radius, motion } = tokens;

export const ThemedSubmitButton = ({ children, disabled, themed, type = 'button' }) => (
  <button
    type={type}
    disabled={disabled}
    style={{
      ...themed.submitBtn,
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = themed._submitHoverBg;
      e.currentTarget.style.borderColor = themed._submitHoverBorder;
      e.currentTarget.style.boxShadow = themed._submitHoverShadow;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = themed.submitBtn.background;
      e.currentTarget.style.borderColor = themed.submitBtn.borderColor;
      e.currentTarget.style.boxShadow = themed.submitBtn.boxShadow;
    }}
  >
    {children}
  </button>
);

export const Field = ({ label, value, onChange, type = 'text', placeholder, disabled, autoFocus, inputMode, mono, autoComplete, themed, icon: Icon, pasteAction, revealable = false, revealLabel = 'Show password', concealLabel = 'Hide password' }) => {
  const [focused, setFocused] = useState(false);
  const [pasteOk, setPasteOk] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const isSecret = type === 'password' && revealable;
  const SecretIcon = secretVisible ? EyeOff : Eye;
  const handlePasteClick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text);
        setPasteOk(true);
        setTimeout(() => setPasteOk(false), 1200);
      }
    } catch { /* clipboard denied */ }
  };
  return (
    <label style={themed.field}>
      <span style={themed.label}>{label}</span>
      <div style={{
        ...themed.inputWrap,
        borderColor: focused ? themed._inputFocusBorder : themed._inputBorder,
        boxShadow: focused ? themed._inputFocusShadow : 'none',
        background: focused ? themed._inputFocusBg : themed._inputBg,
      }}>
        {Icon && <Icon size={14} strokeWidth={2} style={{ color: focused ? themed._inputFocusBorder : themed._iconMuted, flexShrink: 0 }} />}
        <input
          type={isSecret && secretVisible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode={inputMode}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            ...themed.input,
            fontFamily: mono ? font.mono : font.sans,
            letterSpacing: mono ? '0.25em' : 'normal',
            textAlign: mono ? 'center' : 'left',
          }}
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setSecretVisible((v) => !v)}
            disabled={disabled}
            aria-label={secretVisible ? concealLabel : revealLabel}
            title={secretVisible ? concealLabel : revealLabel}
            style={themed.iconBtn}
          >
            <SecretIcon size={14} strokeWidth={2} />
          </button>
        )}
        {pasteAction && (
          <button
            type="button"
            onClick={handlePasteClick}
            disabled={disabled}
            aria-label="Paste from clipboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              border: 'none',
              background: pasteOk ? themed._inputFocusBorder : 'transparent',
              borderRadius: radius.xs,
              color: pasteOk ? themed.crust : themed._iconMuted,
              cursor: 'pointer',
              flexShrink: 0,
              transition: `background ${motion.fast}, color ${motion.fast}`,
            }}
          >
            {pasteOk ? <Check size={13} strokeWidth={2.5} /> : <ClipboardPaste size={13} strokeWidth={2} />}
          </button>
        )}
      </div>
    </label>
  );
};
