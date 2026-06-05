import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { styles, fszStyles, shortcutStyles } from './settingsStyles';

const { color, space } = tokens;

export const ShortcutRow = ({ keys, desc }) => (
  <div style={shortcutStyles.row}>
    <div style={shortcutStyles.keys}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} style={shortcutStyles.kbd}>{key}</span>
      ))}
    </div>
    <div style={shortcutStyles.desc}>{desc}</div>
  </div>
);

export const Section = ({ title, children }) => (
  <section style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionBody}>{children}</div>
  </section>
);

export const Divider = () => <div style={styles.divider} />;

export const Field = ({ label, hint, children }) => (
  <div style={styles.field}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

export const Select = ({ value, onChange, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...styles.input,
          borderColor: hover ? color.borderStrong : color.border,
          appearance: 'none',
          cursor: 'pointer',
          paddingRight: '28px',
          width: '100%',
        }}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: '8px',
          pointerEvents: 'none',
          color: color.muted,
          flexShrink: 0,
        }}
      />
    </div>
  );
};

export const Toggle = ({ label, checked, onChange, hint }) => (
  <label style={styles.toggleRow}>
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: space['3'] }}>
      <span style={styles.toggleLabel}>{label}</span>
      {hint ? <span style={styles.hint}>{hint}</span> : null}
    </span>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        ...styles.toggle,
        background: checked ? color.accent : color.surface1,
      }}
    >
      <span
        style={{
          ...styles.toggleKnob,
          transform: checked ? 'translateX(14px)' : 'translateX(0)',
        }}
      />
    </button>
  </label>
);

// 폰트 크기 — 숫자 input + 슬라이더 + ± 버튼 한 줄. 변경 빠르게.
export const FontSizeRow = ({ value, onChange, min = 8, max = 28 }) => {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const set = (v) => onChange(clamp(parseInt(v, 10) || min));
  return (
    <div style={fszStyles.row}>
      <button
        type="button"
        style={fszStyles.btn}
        onClick={() => set(value - 1)}
        title="-1"
        aria-label="decrease font size"
      >−</button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={fszStyles.input}
      />
      <button
        type="button"
        style={fszStyles.btn}
        onClick={() => set(value + 1)}
        title="+1"
        aria-label="increase font size"
      >+</button>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={fszStyles.slider}
      />
    </div>
  );
};
