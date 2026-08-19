import { tokens } from './tokens';

const { color, font, fontSize, fontWeight, motion } = tokens;

/**
 * Segmented switch — the shared language for controls with a finite set of options
 * where exactly **one** is on at a time.
 *
 * The home's Terminals/Dashboard toggle, the range picker (7/30/90/all) and the chart's
 * cost/tokens and chart/table switches all use this. Rendered as rows of bordered
 * buttons instead, the same kind of control looks different on every screen — and worse,
 * "one of several" never becomes visible in the shape.
 *
 * Two rules of the form:
 *  1. **The track is recessed.** One step darker + an inset shadow — the pressed place.
 *  2. **Only the selected item rises.** Lighter face, drop shadow, 1px top highlight.
 * Change only the colour and it is just a differently coloured button; the shape has to
 * change for it to read as a switch.
 *
 * (Not used in the tab bar — that is window chrome, not a control, and the track would
 * carve a groove across the space where no tabs are.)
 */
export const segmentedTrackStyle = ({ radius: corner = '9px' } = {}) => ({
  display: 'inline-flex',
  alignItems: 'stretch',
  alignSelf: 'flex-start',
  /* Three slots made the old 2px gap and 2px inset read as one crowded strip — on hover
     the lit slot sat flush against its neighbours with no visible track between them.
     The groove has to stay visible on every side of the slot for this to look like a
     switch rather than three buttons pushed together. */
  gap: '3px',
  padding: '3px',
  borderRadius: corner,
  background: 'color-mix(in srgb, #000 20%, var(--ui-crust))',
  border: `1px solid ${color.border}`,
  boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
  maxWidth: '100%',
  boxSizing: 'border-box',
});

/**
 * One slot inside the track.
 * @param active  whether it is selected
 * @param compact narrow slot (range chips and similar, text only)
 */
export const segmentedItemStyle = ({ active = false, compact = false } = {}) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: compact ? '0 12px' : '0 15px',
  minHeight: compact ? '26px' : '30px',
  border: 'none',
  /* Concentric with the track: outer 9px minus the 3px inset. A slot rounded more than
     its groove leaves a sliver of track showing at each corner. */
  borderRadius: '6px',
  fontSize: compact ? fontSize['11'] : fontSize['12'],
  fontWeight: fontWeight.medium,
  fontFamily: compact ? font.mono : font.sans,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `background ${motion.fast}, color ${motion.fast}`,
  background: active ? 'var(--ui-surface1)' : 'transparent',
  color: active ? color.text : color.subtext,
  /* Only the selected slot has thickness — a drop shadow lifts it and a 1px top
     highlight lights its edge. */
  boxShadow: active
    ? `0 1px 3px color-mix(in srgb, ${color.crust} 65%, transparent),`
      + ` inset 0 1px 0 color-mix(in srgb, ${color.text} 10%, transparent)`
    : 'none',
});

/** Hover ground for an unselected slot. Kept faint on purpose — see below. */
export const segmentedHoverBackground = `color-mix(in srgb, ${color.text} 4%, transparent)`;

/**
 * Apply (or clear) the hover look on an **unselected** slot.
 *
 * Why a function and not just a colour: hover used to paint a slot face heavy enough to
 * read as a second selected item, which only became obvious once the switch had three
 * slots sitting side by side. What separates hover from selected now is that hover
 * brightens the **label** and barely tints the ground, while selected owns the face and
 * the thickness (surface1 + drop shadow + top highlight). Two properties have to move
 * together for that to hold, so they move in one place.
 *
 * Call sites must guard on `active` themselves — the selected slot never hovers.
 */
export const applySegmentedHover = (element, hovered) => {
  if (!element) return;
  element.style.background = hovered ? segmentedHoverBackground : 'transparent';
  element.style.color = hovered ? color.text : color.subtext;
};
