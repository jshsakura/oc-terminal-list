import { useEffect, useRef } from 'react';

/**
 * Close a popup when the next press lands outside it (or on Escape).
 *
 * **Listen on `pointerdown`, in the capture phase.** Every hand-written version of this
 * in the repo used `mousedown` (+ later `touchstart`), and both can be silenced before
 * they reach `document`:
 *
 * - The terminal's touch overlay calls `preventDefault()` on `touchstart`, which
 *   suppresses the synthesized `mousedown` entirely.
 * - React handlers that call `stopPropagation()` on a touch event stop the *native*
 *   event too, so a tap on such an element never reaches a document listener.
 *
 * `pointerdown` is a separate event from `touchstart` (it fires first), and capture
 * phase at `document` runs before anything downstream can stop it — so no component can
 * accidentally make a menu unclosable. Browsers without Pointer Events fall back.
 *
 * `ignoreSelector` is for the button that toggles the popup: without it, the press
 * would close the menu here and the button's own click would immediately reopen it.
 */
const DOWN_EVENT = typeof window !== 'undefined' && 'PointerEvent' in window
  ? 'pointerdown'
  : 'mousedown';

export const useDismissOnOutside = (ref, onClose, options = {}) => {
  const { ignoreSelector = null, enabled = true, ignoreRightButton = false } = options;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;

    const handle = (e) => {
      if (ignoreRightButton && e.button === 2) return;
      const target = e.target;
      if (ignoreSelector && target?.closest?.(ignoreSelector)) return;
      if (ref.current?.contains?.(target)) return;
      onCloseRef.current?.();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };

    // Next tick — otherwise the very press that opened the popup closes it again.
    // All three names are listened for: a real tap fires more than one of them and
    // closing twice is a no-op, while missing the one a given browser sends is not.
    const id = setTimeout(() => {
      document.addEventListener(DOWN_EVENT, handle, true);
      document.addEventListener('mousedown', handle, true);
      document.addEventListener('touchstart', handle, true);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener(DOWN_EVENT, handle, true);
      document.removeEventListener('mousedown', handle, true);
      document.removeEventListener('touchstart', handle, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [enabled, ignoreSelector, ignoreRightButton, ref]);
};

export default useDismissOnOutside;
