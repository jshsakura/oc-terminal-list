/**
 * Tap on the terminal → phone keyboard.
 *
 * A phone shows its keyboard only when focus *moves* inside a user gesture. focus() on the
 * element that already has focus is a no-op, so after the keyboard was put away (iOS "완료",
 * Android back, scrolling the page) the textarea kept focus and the next tap did nothing.
 * The way out was quick input, a different element. Blurring first makes the focus a real
 * change again.
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

export const resetTapFocusReports = () => { lastReportAt = -Infinity; };

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

/** Focus the terminal from inside a tap so the keyboard shows; returns whether it re-focused. */
export const focusForKeyboard = (term, { win = window } = {}) => {
  const textarea = term?.textarea;
  const refocus = !!textarea && win.document.activeElement === textarea;
  if (refocus) textarea.blur();
  term.focus();
  return refocus;
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
  const refocus = focusForKeyboard(term, { win });
  if (!vv || keyboardAlreadyUp) return () => {};
  const timer = win.setTimeout(() => {
    const after = vv.height;
    if (after <= before * (1 - KEYBOARD_MIN_SHRINK)) return;
    reportTapFocus('measure', [
      'no-keyboard',
      `refocus=${refocus ? 1 : 0}`,
      `active=${describeActive(win.document, term.textarea)}`,
      `vv=${Math.round(before)}->${Math.round(after)}`,
      `inner=${inner}`,
      `os=${platform(win.navigator)}`,
    ].join(' '), { win, now });
  }, KEYBOARD_WAIT_MS);
  return () => win.clearTimeout(timer);
};
