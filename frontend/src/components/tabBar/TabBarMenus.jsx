import { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Edit3, Copy, LayoutGrid, List,
  SquareSplitHorizontal, SquareSplitVertical, Grid2x2, Trash2,
  Settings as SettingsIcon, RefreshCw,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassMenuItemHover, glassMenuStyle } from '../../styles/glass';

const { color, font } = tokens;

export const MenuItem = ({ onClick, children, danger, disabled = false, icon: Icon = null }) => (
  <button
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
      borderRadius: '3px',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? color.muted : (danger ? color.danger : color.text),
      fontSize: '11.5px',
      fontFamily: 'inherit',
      transition: 'background 120ms',
      lineHeight: 1.3,
      opacity: disabled ? 0.5 : 1,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = glassMenuItemHover(); }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    {Icon && <Icon size={12} strokeWidth={1.8} />}
    {children}
  </button>
);

export const TabContextMenu = ({
  ctx, t, onClose, onCloseTab, onDuplicateTab, onRenameTab = null,
  canToggleViewMode = false, viewMode = 'grid', onToggleViewMode = null,
  canMoveLeft = false, canMoveRight = false, onMoveLeft = null, onMoveRight = null,
  canSplit = false, onSplit = null,
}) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => {
      if (e.target?.closest?.('[data-more="true"]')) return;
      if (!ref.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = ctx.x;
      let nextY = ctx.y;

      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextX < margin) nextX = margin;

      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;

      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [ctx.x, ctx.y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(),
        zIndex: 200000,
        minWidth: '140px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
      }}
    >
      {(onMoveLeft || onMoveRight) && (
        <>
          <MenuItem onClick={onMoveLeft} disabled={!canMoveLeft} icon={ChevronLeft}>
            {t?.('moveLeft') || 'Move left'}
          </MenuItem>
          <MenuItem onClick={onMoveRight} disabled={!canMoveRight} icon={ChevronRight}>
            {t?.('moveRight') || 'Move right'}
          </MenuItem>
        </>
      )}
      {onRenameTab && (
        <MenuItem onClick={onRenameTab} icon={Edit3}>
          {t?.('rename') || 'Rename'}
        </MenuItem>
      )}
      {onDuplicateTab && (
        <MenuItem onClick={onDuplicateTab} icon={Copy}>
          {t?.('duplicateTab') || 'Duplicate (same path)'}
        </MenuItem>
      )}
      {canToggleViewMode && onToggleViewMode && (
        <MenuItem onClick={onToggleViewMode} icon={viewMode === 'tabs' ? LayoutGrid : List}>
          {viewMode === 'tabs'
            ? (t?.('switchToGridView') || 'Switch to split view')
            : (t?.('switchToTabsView') || 'Switch to tabs view')}
        </MenuItem>
      )}
      {canSplit && onSplit && (
        <>
          <MenuItem onClick={() => onSplit('right')} icon={SquareSplitHorizontal}>
            {`${t?.('splitRight') || 'Split right'} (Ctrl+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('left')} icon={SquareSplitHorizontal}>
            {t?.('splitLeft') || 'Split left'}
          </MenuItem>
          <MenuItem onClick={() => onSplit('down')} icon={SquareSplitVertical}>
            {`${t?.('splitDown') || 'Split down'} (Ctrl+Shift+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('up')} icon={SquareSplitVertical}>
            {t?.('splitUp') || 'Split up'}
          </MenuItem>
          <MenuItem onClick={() => onSplit('2x2')} icon={Grid2x2}>
            {t?.('layout2x2') || '2 × 2 grid'}
          </MenuItem>
        </>
      )}
      <MenuItem onClick={onCloseTab} danger icon={Trash2}>{t?.('closeTab') || 'Close tab'}</MenuItem>
    </div>
  );
};

export const SettingsSubMenu = ({ anchor, t, isMobile = false, onClose, onSettings, onReload, onEqualize }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onCloseRef.current(); };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const m = 8;
      let nx = anchor.x - rect.width;
      let ny = anchor.y;
      if (nx < m) nx = m;
      if (nx + rect.width > window.innerWidth - m) nx = window.innerWidth - rect.width - m;
      if (ny + rect.height > window.innerHeight - m) ny = window.innerHeight - rect.height - m;
      setPos({ x: nx, y: ny });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  const iconSize = isMobile ? 15 : 12;
  const item = (Icon, label, action) => (
    <button
      type="button"
      onClick={action}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        width: '100%',
        minHeight: isMobile ? '42px' : '30px',
        padding: isMobile ? '0 12px' : '6px 9px',
        background: 'transparent', border: 'none', borderRadius: '3px',
        cursor: 'pointer', color: color.text,
        fontSize: isMobile ? '13px' : '11.5px', fontFamily: font.sans,
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={iconSize} strokeWidth={1.8} />
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{
      position: 'fixed', top: pos.y, left: pos.x,
      ...glassMenuStyle(),
      zIndex: 200000,
      minWidth: isMobile ? '190px' : '160px',
      fontFamily: font.sans,
      opacity: measured ? 1 : 0,
      transition: 'opacity 120ms',
    }}>
      {item(SettingsIcon, t?.('settings') || 'Settings', onSettings)}
      {onEqualize && item(LayoutGrid, t?.('equalizePane') || 'Equalize panes', onEqualize)}
      {onReload && item(RefreshCw, t?.('reloadTerminals') || 'Reload terminals', onReload)}
    </div>
  );
};

