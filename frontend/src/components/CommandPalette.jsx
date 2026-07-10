import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { tokens } from '../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space, motion, shadow } = tokens;

const CommandPalette = ({
  isOpen,
  // 기본값을 둔다 — 이 컴포넌트는 AppModals 의 단일 LazyErrorBoundary 안에서 렌더된다.
  // 호출 측이 prop 이름을 틀리면 여기서 던진 예외를 그 경계가 삼켜, 설정·확인창 등
  // 형제 모달까지 전부 사라진다. 잘못 부르면 빈 팔레트가 뜨는 편이 낫다.
  query = '',
  onQueryChange,
  onClose,
  commands = [],
  onExecute,
  title,
  placeholder = 'Type a command...',
  emptyLabel = 'No commands found',
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => {
      const keywords = (command.keywords || []).join(' ').toLowerCase();
      return command.label.toLowerCase().includes(normalized) || keywords.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIndex(0);
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => visibleCommands.length === 0 ? 0 : (prev + 1) % visibleCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => visibleCommands.length === 0 ? 0 : (prev - 1 + visibleCommands.length) % visibleCommands.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = visibleCommands[selectedIndex];
        if (selected) onExecute(selected.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, onExecute, selectedIndex, visibleCommands]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onMouseDown={onClose}>
      <div style={styles.palette} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.searchRow}>
          <Search size={13} strokeWidth={2} style={{ color: color.muted, flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            style={styles.input}
          />
          <span style={styles.kbd}>ESC</span>
        </div>

        <div ref={listRef} style={styles.list}>
          {visibleCommands.length === 0 ? (
            <div style={styles.empty}>{emptyLabel}</div>
          ) : (
            visibleCommands.map((command, index) => {
              const isActive = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => onExecute(command.id)}
                  style={{
                    ...styles.item,
                    background: isActive ? color.accentSubtle : 'transparent',
                    color: isActive ? color.text : color.subtext,
                    borderColor: isActive ? color.accentBorder : 'transparent',
                  }}
                >
                  <span style={styles.itemLabel}>{command.label}</span>
                  {command.shortcut ? <span style={styles.itemKbd}>{command.shortcut}</span> : null}
                </button>
              );
            })
          )}
        </div>

        {title && <div style={styles.footer}>{title}</div>}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: color.scrim,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '12vh',
    zIndex: 120000,
    fontFamily: font.sans,
    backdropFilter: 'blur(2px)',
  },
  palette: {
    width: 'min(640px, calc(100vw - 28px))',
    maxHeight: 'min(64vh, 520px)',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `0 ${space['3']}`,
    height: '40px',
    borderBottom: `1px solid ${color.border}`,
  },
  input: {
    flex: 1,
    height: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: color.text,
    fontSize: fontSize['14'],
    fontFamily: 'inherit',
  },
  kbd: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    color: color.muted,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    padding: '1px 6px',
  },
  list: {
    overflowY: 'auto',
    padding: space['1'],
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid transparent',
    background: 'transparent',
    width: '100%',
    textAlign: 'left',
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}`,
  },
  itemLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginRight: space['2'],
  },
  itemKbd: {
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    color: color.muted,
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    padding: '1px 6px',
    flexShrink: 0,
  },
  empty: {
    padding: `${space['4']} ${space['3']}`,
    fontSize: fontSize['12'],
    color: color.muted,
    textAlign: 'center',
  },
  footer: {
    padding: `${space['1.5']} ${space['3']}`,
    fontSize: fontSize['11'],
    color: color.muted,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
    letterSpacing: '0.02em',
  },
};

export default CommandPalette;
