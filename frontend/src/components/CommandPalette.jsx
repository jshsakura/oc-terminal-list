import { useEffect, useMemo, useRef, useState } from 'react';

const CommandPalette = ({
  isOpen,
  query,
  onQueryChange,
  onClose,
  commands,
  onExecute,
  theme,
  title,
  placeholder = 'Type a command...',
  emptyLabel = 'No commands found',
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
        setSelectedIndex((prev) => {
          if (visibleCommands.length === 0) return 0;
          return (prev + 1) % visibleCommands.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => {
          if (visibleCommands.length === 0) return 0;
          return (prev - 1 + visibleCommands.length) % visibleCommands.length;
        });
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = visibleCommands[selectedIndex];
        if (selected) {
          onExecute(selected.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, onExecute, selectedIndex, visibleCommands]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onMouseDown={onClose}>
      <div
        style={{
          ...styles.palette,
          backgroundColor: theme.ui.bgSecondary,
          border: `1px solid ${theme.ui.border}`,
          boxShadow: theme.ui.shadow || '0 28px 64px rgba(0,0,0,0.45)',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ ...styles.header, borderBottom: `1px solid ${theme.ui.borderLight}` }}>
          <span style={{ ...styles.title, color: theme.ui.text }}>{title}</span>
          <span style={{ ...styles.shortcut, color: theme.ui.textSecondary }}>ESC</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
          style={{
            ...styles.input,
            color: theme.ui.text,
            backgroundColor: theme.ui.bg,
            borderBottom: `1px solid ${theme.ui.borderLight}`,
          }}
        />

        <div style={styles.list}>
          {visibleCommands.length === 0 ? (
              <div style={{ ...styles.empty, color: theme.ui.textSecondary }}>
              {emptyLabel}
              </div>
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
                    color: isActive ? theme.ui.bg : theme.ui.text,
                    backgroundColor: isActive ? theme.ui.accent : 'transparent',
                  }}
                >
                  <span style={styles.itemLabel}>{command.label}</span>
                  {command.shortcut ? <span style={styles.itemHint}>{command.shortcut}</span> : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(6, 8, 12, 0.48)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '12vh',
    zIndex: 120000,
  },
  palette: {
    width: 'min(760px, calc(100vw - 28px))',
    maxHeight: 'min(72vh, 560px)',
    borderRadius: '10px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
  },
  title: {
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  shortcut: {
    fontSize: '11px',
    fontWeight: 700,
    opacity: 0.8,
  },
  input: {
    width: '100%',
    border: 'none',
    outline: 'none',
    padding: '14px 14px',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  list: {
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  itemLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginRight: '8px',
  },
  itemHint: {
    fontSize: '11px',
    opacity: 0.8,
    fontWeight: 700,
  },
  empty: {
    padding: '16px 12px',
    fontSize: '12px',
    fontWeight: 600,
  },
};

export default CommandPalette;
