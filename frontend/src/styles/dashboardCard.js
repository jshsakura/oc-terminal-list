import { tokens } from './tokens';

const { color, radius, space } = tokens;

/**
 * The surface of one dashboard card.
 *
 * **Glass is only glass when there is something behind it.** An earlier attempt was
 * reverted for exactly that reason — over a flat background the blur had nothing to
 * chew on and the card just looked transparent. The home canvas now carries scanlines
 * (`styles/textures.js` `canvasTexture`), so the blur actually smears them: the inside
 * of a card reads as frosted glass and its edge becomes visible. The two are one
 * feature; remove either and both lose their meaning.
 *
 * Tiles, bars and chart cards all use this one definition. Drawn separately they drift.
 */
export const dashboardCardStyle = ({ padding = space['3'], corner = radius.md } = {}) => ({
  padding,
  borderRadius: corner,
  /* Fully opaque hides what is behind; too transparent puts the background lines under
     the text. 62% is where the scanlines still show through but body contrast holds
     (picked by looking at it, not by theory). */
  background: `color-mix(in srgb, ${color.surface0} var(--glass-fill, 62%), transparent)`,
  border: `1px solid ${color.borderStrong}`,
  /* A 1px top highlight is what gives the glass thickness — without it this is just a
     translucent rectangle. **No hardcoded white/black**: on a light theme a white
     highlight disappears and a black shadow is far too heavy. Derived from the theme's
     text/crust, it becomes a bright rim on dark themes and a crisp edge on light ones. */
  boxShadow: `0 2px 10px color-mix(in srgb, ${color.crust} 55%, transparent),`
    + ` inset 0 1px 0 color-mix(in srgb, ${color.text} 7%, transparent)`,
  backdropFilter: 'blur(var(--glass-blur-card, 12px))',
  WebkitBackdropFilter: 'blur(var(--glass-blur-card, 12px))',
});

export default dashboardCardStyle;
