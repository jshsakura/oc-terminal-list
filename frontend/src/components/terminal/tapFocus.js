/**
 * Tap on the terminal → phone keyboard.
 *
 * A phone shows its keyboard only when focus *moves* inside a user gesture. focus() on the
 * element that already has focus is a no-op, so after the keyboard was put away (iOS "완료",
 * Android back, scrolling the page) the textarea kept focus and the next tap did nothing.
 * The way out was quick input, a different element. So when a text field already holds
 * focus, the tap first moves focus to a tiny helper input and then to the terminal.
 *
 * Whether the keyboard then came up only the browser knows, so a tap that ends with no
 * keyboard is reported over the live WS (`iterm:client-report`, scope `tap-focus`) with
 * the facts needed to tell the cases apart in the server log.
 */
export const CLIENT_REPORT_EVENT = 'iterm:client-report';
export const KEYBOARD_WAIT_MS = 800;
// The keyboard takes well over this share of the screen; browser chrome moving does not.
export const KEYBOARD_MIN_SHRINK = 0.15;
// A keyboard already up leaves the visible area below this share of the layout height.
const KEYBOARD_OPEN_RATIO = 0.75;
const REPORT_GAP_MS = 30000;

let lastReportAt = -Infinity;
let tapCount = 0;
let missCount = 0;
let skippedFocusCount = 0;

export const resetTapFocusReports = () => {
  lastReportAt = -Infinity; tapCount = 0; missCount = 0; skippedFocusCount = 0;
};

const platform = (nav) => {
  const ua = nav?.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav?.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
};

const describeActive = (doc, textarea) => {
  const el = doc.activeElement;
  if (!el || el === doc.body) return 'none';
  if (el === textarea) return 'terminal';
  return (el.tagName || 'other').toLowerCase();
};

export const reportTapFocus = (kind, detail, { win = window, now = Date.now } = {}) => {
  const at = now();
  if (at - lastReportAt < REPORT_GAP_MS) return false;
  lastReportAt = at;
  try {
    win.dispatchEvent(new CustomEvent(CLIENT_REPORT_EVENT, {
      detail: { scope: 'tap-focus', kind, detail },
    }));
  } catch { /* a report must never break typing */ }
  return true;
};

/* iOS rule seen in the logs (refocus=1, active=terminal, no keyboard): focusing the same
   field again, even after blur(), does not bring the keyboard back. Moving focus to a
   *different* field inside the tap does, which is why quick input always worked. So when
   the terminal already holds focus, step through a tiny helper input first; focus moving
   input → terminal keeps the keyboard that the first move raised. */
const PROXY_ID = 'iterm-tap-focus-proxy';

const proxyInput = (doc) => {
  let el = doc.getElementById(PROXY_ID);
  if (el) return el;
  el = doc.createElement('input');
  el.id = PROXY_ID;
  el.type = 'text';
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.autocomplete = 'off';
  // In the viewport (iOS may scroll to an off-screen field), invisible, 16px so iOS does not zoom.
  Object.assign(el.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
    opacity: '0', fontSize: '16px', border: '0', padding: '0', pointerEvents: 'none',
  });
  doc.body.appendChild(el);
  return el;
};

const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');

/**
 * Focus the terminal from inside a tap so the keyboard shows.
 * Returns { refocus, via }: whether the terminal already had focus, and the path taken
 * ('direct', or 'proxy' when another step was needed). Both go into the report.
 */
export const focusForKeyboard = (term, { win = window } = {}) => {
  const doc = win.document;
  const textarea = term?.textarea;
  const holder = doc.activeElement;
  const refocus = !!textarea && holder === textarea;
  let via = 'direct';
  // A text field (ours or another) holds focus with the keyboard possibly put away: step
  // through the helper so the move to the terminal is a move between two different fields.
  if (isTextField(holder) && holder.id !== PROXY_ID) {
    try {
      proxyInput(doc).focus({ preventScroll: true });
      via = 'proxy';
    } catch { textarea?.blur(); }
  }
  term.focus();
  return { refocus, via };
};

/**
 * A focus() made outside a tap (tab switch, pane connect, a modal closing) gives the
 * terminal focus on a phone but no keyboard. The textarea then sits focused with the
 * keyboard down, and the logs show the next tap cannot raise it (refocus=1). Such a focus
 * does nothing useful on a phone, so skip it: only focus while the user is touching.
 * Browsers without `navigator.userActivation` keep the old behavior. Returns a detach.
 */
export const focusOnlyFromGesture = (term, { win = window } = {}) => {
  const activation = win.navigator?.userActivation;
  if (!term || typeof term.focus !== 'function' || !activation || !('isActive' in activation)) {
    return () => {};
  }
  const original = term.focus;
  const guarded = function guardedFocus(...args) {
    if (!activation.isActive) { skippedFocusCount += 1; return undefined; }
    return original.apply(this, args);
  };
  term.focus = guarded;
  return () => { if (term.focus === guarded) term.focus = original; };
};

/**
 * The keyboard closed while the terminal kept focus ("완료", Android back, page scroll).
 * Logs showed that a tap after that never brings the keyboard back on iOS, not even when
 * focus steps through the helper input (via=proxy), while a tap with nothing focused
 * always works. So the moment the keyboard goes away, let go of focus: the next tap is
 * then a fresh focus, the case that works. Returns a detach function.
 */
export const releaseFocusWhenKeyboardCloses = (term, { win = window } = {}) => {
  const vv = win.visualViewport;
  if (!vv?.addEventListener) return () => {};
  const isOpen = () => {
    const inner = win.innerHeight || 0;
    return inner > 0 && vv.height < inner * KEYBOARD_OPEN_RATIO;
  };
  let wasOpen = isOpen();
  const onResize = () => {
    const open = isOpen();
    const closed = wasOpen && !open;
    wasOpen = open;
    const textarea = term?.textarea;
    if (closed && textarea && win.document.activeElement === textarea) textarea.blur();
  };
  vv.addEventListener('resize', onResize);
  return () => vv.removeEventListener('resize', onResize);
};

/**
 * Tap → focus → check, a moment later, that the visible area shrank (the keyboard came up).
 * If it did not, report it once per REPORT_GAP_MS. Returns a cancel function.
 */
export const tapFocusWithProbe = (term, { win = window, now = Date.now } = {}) => {
  const vv = win.visualViewport;
  const before = vv ? vv.height : null;
  const inner = win.innerHeight || 0;
  const keyboardAlreadyUp = before !== null && inner > 0 && before < inner * KEYBOARD_OPEN_RATIO;
  const { refocus, via } = focusForKeyboard(term, { win });
  if (!vv || keyboardAlreadyUp) return () => {};
  tapCount += 1;
  const timer = win.setTimeout(() => {
    const after = vv.height;
    if (after <= before * (1 - KEYBOARD_MIN_SHRINK)) return;
    missCount += 1;
    reportTapFocus('measure', [
      'no-keyboard',
      `refocus=${refocus ? 1 : 0}`,
      `via=${via}`,
      `active=${describeActive(win.document, term.textarea)}`,
      `vv=${Math.round(before)}->${Math.round(after)}`,
      `inner=${inner}`,
      `os=${platform(win.navigator)}`,
      `misses=${missCount}/${tapCount}`,
      `skipped-focus=${skippedFocusCount}`,
    ].join(' '), { win, now });
  }, KEYBOARD_WAIT_MS);
  return () => win.clearTimeout(timer);
};
