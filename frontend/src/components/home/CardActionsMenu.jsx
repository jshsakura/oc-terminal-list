import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassMenuStyle } from '../../styles/glass';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';

const { color, font, radius } = tokens;

/**
 * The machine card's "…" — the occasional actions, with their names.
 *
 * Four bare icons cost 116px of a card that is barely 330px wide, which is why the name
 * and the start path had ~130px to live in. They also **said nothing on a phone**: an
 * icon's only label is its `title` tooltip, and touch devices have no hover. So folding
 * three of them in here is not a trade — the card gets its width back *and* the actions
 * finally have words. The one action that is used often (open at path) stays outside.
 *
 * ⚠️ **Rendered into a portal.** The card list scrolls, and an absolutely positioned menu
 * inside a scrolling ancestor gets clipped at the edge. Fixed + portal is the same shape
 * `RailSubMenu` settled on for the pane menu.
 *
 * ⚠️ **The toggle closes it too.** Outside-dismiss deliberately ignores this button
 * (otherwise the press would close the menu and the click would reopen it), so the button
 * has to do it itself — a menu you cannot close by pressing the thing that opened it
 * reads as broken. This repo has shipped that bug before.
 */
const MENU_MARGIN = 8;

const CardActionsMenu = ({ items = [], title, ariaLabel }) => {
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [measured, setMeasured] = useState(false);

  const close = useCallback(() => { setAnchor(null); setMeasured(false); }, []);
  useDismissOnOutside(menuRef, close, {
    ignoreSelector: '[data-card-actions-toggle]',
    enabled: !!anchor,
  });

  const toggle = useCallback((e) => {
    e.stopPropagation();
    if (anchor) { close(); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.right, y: rect.bottom + 4 });
  }, [anchor, close]);

  useEffect(() => {
    if (!anchor || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = anchor.x - rect.width;          // right-aligned to the button
    let y = anchor.y;
    if (x < MENU_MARGIN) x = MENU_MARGIN;
    if (x + rect.width > window.innerWidth - MENU_MARGIN) {
      x = window.innerWidth - rect.width - MENU_MARGIN;
    }
    if (y + rect.height > window.innerHeight - MENU_MARGIN) {
      y = anchor.y - rect.height - 32;      // flip above the button
    }
    if (y < MENU_MARGIN) y = MENU_MARGIN;
    setPos({ x, y });
    setMeasured(true);
  }, [anchor]);

  const usable = items.filter(Boolean);
  if (usable.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-card-actions-toggle=""
        onClick={toggle}
        title={title}
        aria-label={ariaLabel || title}
        aria-expanded={!!anchor}
        style={styles.toggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = color.base;
          e.currentTarget.style.color = color.text;
          e.currentTarget.style.borderColor = color.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = color.surface0;
          e.currentTarget.style.color = color.subtext;
          e.currentTarget.style.borderColor = color.border;
        }}
      >
        <MoreHorizontal size={13} strokeWidth={1.8} />
      </button>

      {anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            ...glassMenuStyle(),
            position: 'fixed',
            top: pos.y,
            left: pos.x,
            zIndex: 200000,
            minWidth: '176px',
            fontFamily: font.sans,
            opacity: measured ? 1 : 0,
            transition: 'opacity 120ms',
          }}
        >
          {usable.map(({ key, icon: Icon, label, onClick }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); close(); onClick?.(); }}
              style={styles.item}
              onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {Icon && <Icon size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />}
              <span>{label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

const styles = {
  toggle: {
    width: '26px',
    height: '26px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    cursor: 'pointer',
    color: color.subtext,
    transition: 'background 150ms, color 150ms, border-color 150ms',
    padding: 0,
  },
  item: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    textAlign: 'left',
    minHeight: '32px',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    color: color.text,
    fontSize: '12px',
    fontFamily: font.sans,
    whiteSpace: 'nowrap',
  },
};

export default CardActionsMenu;
