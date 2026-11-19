/**
 * Points at one button when Terminator is asked "where is X?".
 *
 * The backend sends only an id over the existing SSE (`{type:'spotlight', id}`);
 * useWorkspaceTabs turns it into an `iterm:spotlight` window event. The id is looked up in
 * our own list of `data-guide` targets, so the server can never inject markup here.
 * Any click or Escape dismisses it, and it goes away by itself.
 */
import { useEffect, useState } from 'react';
import { tokens } from '../../styles/tokens';
import { findGuideElement, guideCaption } from '../../utils/guideTargets';
import { isEinkActive } from '../../utils/einkMode';

const { color, fontSize, radius, space } = tokens;
const AUTO_DISMISS_MS = 7000;
const RING_PAD_PX = 4;

const Spotlight = ({ language = 'ko', t }) => {
  const [spot, setSpot] = useState(null);   // { id, rect } | { id, missing: true }

  useEffect(() => {
    const onSpot = (e) => {
      const id = e.detail?.id;
      const el = findGuideElement(id);
      if (!el) { setSpot({ id, missing: true }); return; }
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      setSpot({ id, rect });
      window.dispatchEvent(new CustomEvent('iterm:spotlight-shown', { detail: { id, rect } }));
    };
    window.addEventListener('iterm:spotlight', onSpot);
    return () => window.removeEventListener('iterm:spotlight', onSpot);
  }, []);

  useEffect(() => {
    if (!spot) return undefined;
    const dismiss = () => {
      setSpot(null);
      window.dispatchEvent(new CustomEvent('iterm:spotlight-done'));
    };
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [spot]);

  if (!spot) return null;
  const caption = spot.missing
    ? (t?.('spotlightMissing') || '그 버튼은 지금 화면에 없습니다. 터미널 탭을 열면 보입니다')
    : guideCaption(spot.id, language);
  const eink = isEinkActive();

  if (spot.missing) {
    return <div role="status" style={{ ...styles.caption, ...styles.center }}>{caption}</div>;
  }
  const { rect } = spot;
  const below = rect.bottom + 64 < window.innerHeight;
  return (
    <div aria-live="polite" style={styles.layer}>
      <div
        data-spotlight-ring=""
        style={{
          position: 'fixed',
          left: rect.left - RING_PAD_PX, top: rect.top - RING_PAD_PX,
          width: rect.width + RING_PAD_PX * 2, height: rect.height + RING_PAD_PX * 2,
          borderRadius: radius.md,
          border: `${eink ? 3 : 2}px solid ${color.accent}`,
          // Dims everything else. E-ink skips the dim: translucency is just smear there.
          boxShadow: eink ? 'none' : '0 0 0 9999px rgba(0,0,0,0.5)',
        }}
      />
      <div style={{
        ...styles.caption, position: 'fixed',
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
        top: below ? rect.bottom + 12 : rect.top - 52,
      }}>
        {caption}
      </div>
    </div>
  );
};

const styles = {
  layer: { position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none' },
  caption: {
    zIndex: 1001, maxWidth: '250px', padding: `${space[2]} ${space[3]}`, borderRadius: radius.lg,
    background: color.accent, color: color.base, fontSize: fontSize['13'], lineHeight: 1.45,
    boxShadow: '0 6px 20px rgba(0,0,0,0.3)', pointerEvents: 'none',
  },
  center: { position: 'fixed', left: '50%', top: '20%', transform: 'translateX(-50%)' },
};

export default Spotlight;
