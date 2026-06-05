import { useState } from 'react';
import { tokens } from '../../styles/tokens';
import { styles } from './hostEditorStyles';

const { color, fontSize } = tokens;

export const Section = ({ title, children }) => (
  <section style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionBody}>{children}</div>
  </section>
);

export const Divider = () => <div style={styles.divider} />;

export const Row = ({ children }) => <div style={styles.row}>{children}</div>;

export const Field = ({ label, hint, children, flex }) => (
  <div style={{ ...styles.field, flex: flex || 'unset' }}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

export const Input = ({ value, onChange, type = 'text', placeholder, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...styles.input,
        borderColor: focused ? color.accentBorder : color.border,
        background: focused ? color.crust : color.mantle,
      }}
    />
  );
};

export const Select = ({ value, onChange, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...styles.input, borderColor: hover ? color.borderStrong : color.border, cursor: 'pointer', appearance: 'none' }}
    >
      {children}
    </select>
  );
};

export const SegmentedControl = ({ value, options, onChange }) => (
  <div style={styles.segment}>
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        style={{
          ...styles.segmentBtn,
          background: value === opt.value ? color.surface1 : 'transparent',
          color: value === opt.value ? color.text : color.muted,
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const Toggle = ({ label, hint, checked, onChange }) => (
  <div style={styles.toggleRow}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: fontSize['13'], color: color.text }}>{label}</div>
      {hint && <div style={{ fontSize: fontSize['11'], color: color.muted, marginTop: '2px' }}>{hint}</div>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        ...styles.toggle,
        background: checked ? color.accent : color.surface1,
      }}
    >
      <span style={{ ...styles.toggleKnob, transform: checked ? 'translateX(14px)' : 'translateX(0)' }} />
    </button>
  </div>
);
