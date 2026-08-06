import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

/**
 * `collapsible` — 자주 안 쓰는 구획은 접어 둔다. 비밀번호 변경처럼 일 년에 한 번
 * 쓰는 폼이 늘 펼쳐져 있으면 그만큼 자주 쓰는 항목이 아래로 밀린다.
 * 기본 구획은 그대로 — 접는 것이 늘면 그건 그것대로 클릭이 는다.
 */
export const Section = ({ title, children, collapsible = false, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <section style={styles.section}>
        <div style={styles.sectionTitle}>{title}</div>
        <div style={styles.sectionBody}>{children}</div>
      </section>
    );
  }
  return (
    <section style={styles.section}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...styles.sectionTitle,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          minHeight: '32px',
        }}
        aria-expanded={open}
      >
        <ChevronRight
          size={12}
          strokeWidth={2.2}
          style={{
            flexShrink: 0,
            transition: 'transform 140ms',
            transform: open ? 'rotate(90deg)' : 'none',
          }}
        />
        {title}
      </button>
      {open && <div style={styles.sectionBody}>{children}</div>}
    </section>
  );
};

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
