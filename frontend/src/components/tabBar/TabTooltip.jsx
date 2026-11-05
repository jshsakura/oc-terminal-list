import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, z } = tokens;

/* The native `title` takes about a second to appear and only on the exact element that carries
   it, so a tab's truncated name looked like it had no tooltip at all. */
export const TAB_TIP_DELAY_MS = 300;
const TIP_GAP_PX = 4;
const TIP_MAX_WIDTH_PX = 420;
const VIEWPORT_MARGIN_PX = 8;

// Anchored to the edge nearer the middle of the screen, so a long name grows away from the
// viewport edge without having to measure the tooltip first.
const placeBelow = (rect) => {
  const viewportWidth = window.innerWidth;
  const isRightSide = rect.left > viewportWidth / 2;
  const offset = isRightSide ? viewportWidth - rect.right : rect.left;
  return {
    top: rect.bottom + TIP_GAP_PX,
    [isRightSide ? 'right' : 'left']: offset,
    maxWidth: Math.min(TIP_MAX_WIDTH_PX, viewportWidth - offset - VIEWPORT_MARGIN_PX),
  };
};

export const useHoverTip = (isEnabled) => {
  const [placement, setPlacement] = useState(null);
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setPlacement(null);
  }, []);

  const show = useCallback((event) => {
    if (!isEnabled) return;
    const element = event.currentTarget;
    clearTimeout(timerRef.current);
    // Measured when it fires: the strip may have scrolled during the delay.
    timerRef.current = setTimeout(() => {
      setPlacement(placeBelow(element.getBoundingClientRect()));
    }, TAB_TIP_DELAY_MS);
  }, [isEnabled]);

  useEffect(() => { if (!isEnabled) hide(); }, [isEnabled, hide]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { placement, show, hide };
};

// Portalled because the tab strip scrolls horizontally, which clips anything inside it.
export const TabTooltip = ({ placement, names, hint }) => createPortal(
  <div
    role="tooltip"
    style={{
      ...placement,
      position: 'fixed',
      zIndex: z.popover,
      padding: '5px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      background: color.surface1,
      border: '1px solid var(--ui-border-strong)',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      color: color.text,
      fontFamily: font.sans,
      fontSize: fontSize['12'],
      lineHeight: 1.4,
      overflowWrap: 'anywhere',
      pointerEvents: 'none',
    }}
  >
    {names.map((name, index) => (
      <span
        key={name}
        data-testid="tab-tip-name"
        style={index === 0 ? { fontWeight: fontWeight.medium } : { color: color.subtext }}
      >
        {name}
      </span>
    ))}
    {hint && <span style={{ color: color.muted, fontSize: fontSize['11'] }}>{hint}</span>}
  </div>,
  document.body,
);
