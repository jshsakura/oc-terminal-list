import { useEffect, useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { tokens } from '../styles/tokens';
import { HOST_ICON_OPTIONS } from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * 아이콘 팝업 — 검색 + 그리드. 선택 시 onChange(key) 후 자동으로 닫힘.
 * "없음(기본)" 도 한 칸 차지해서 초기화 가능.
 */
const IconPickerPopup = ({ isOpen, value, onChange, onClose, t }) => {
  const [q, setQ] = useState('');

  useEffect(() => { if (isOpen) setQ(''); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return HOST_ICON_OPTIONS;
    return HOST_ICON_OPTIONS.filter(
      (o) => o.key.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle),
    );
  }, [q]);

  if (!isOpen) return null;

  const pick = (key) => {
    onChange?.(key || '');
    onClose?.();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.title}>{t?.('pickIcon') || 'Pick an icon'}</div>
          <button type="button" onClick={onClose} style={styles.closeBtn} title={t?.('close') || 'Close'}>
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div style={styles.searchRow}>
          <Search size={13} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t?.('searchIcon') || 'Search icons…'}
            style={styles.search}
          />
        </div>

        <div style={styles.body}>
          <div style={styles.grid}>
            <Tile selected={!value} onClick={() => pick('')} title={t?.('noneIconHint') || 'None (default)'}>
              <span style={{ fontSize: '11px', color: color.muted }}>—</span>
            </Tile>
            {filtered.map((opt) => {
              const Icon = opt.Icon;
              const selected = value === opt.key;
              return (
                <Tile key={opt.key} selected={selected} onClick={() => pick(opt.key)} title={opt.label}>
                  <Icon size={18} strokeWidth={1.8} style={{ color: selected ? color.accent : color.text }} />
                </Tile>
              );
            })}
            {filtered.length === 0 && (
              <div style={styles.empty}>{t?.('noResults') || 'No matches'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Tile = ({ selected, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      width: '40px',
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: selected ? `${color.accent}1f` : color.surface0,
      border: `1px solid ${selected ? color.accent : color.border}`,
      borderRadius: radius.sm,
      cursor: 'pointer',
      transition: 'background 120ms, border-color 120ms',
      padding: 0,
    }}
    onMouseEnter={(e) => {
      if (selected) return;
      e.currentTarget.style.background = color.surface1;
      e.currentTarget.style.borderColor = color.borderStrong;
    }}
    onMouseLeave={(e) => {
      if (selected) return;
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.borderColor = color.border;
    }}
  >
    {children}
  </button>
);

const styles = {
  overlay: {
    position: 'absolute', inset: 0,
    background: color.scrim,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10002,
    fontFamily: font.sans,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    width: '92%',
    maxWidth: '460px',
    maxHeight: '78vh',
    background: color.base,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.lg,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `12px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  title: { fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: color.text },
  closeBtn: {
    width: '24px', height: '24px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', borderRadius: '4px',
    cursor: 'pointer', color: color.subtext, padding: 0,
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: `8px ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
    background: color.mantle,
  },
  search: {
    flex: 1, minWidth: 0,
    height: '28px',
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: `0 10px`,
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    outline: 'none',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: space['3'],
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))',
    gap: '6px',
  },
  empty: {
    gridColumn: '1 / -1',
    textAlign: 'center',
    padding: space['4'],
    fontSize: fontSize['12'],
    color: color.muted,
  },
};

export default IconPickerPopup;
