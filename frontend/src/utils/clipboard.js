/**
 * Copy text to the clipboard — **the one implementation for the whole app**.
 *
 * Every hand-rolled variant in this repo failed the same way on iPhone, so the rules
 * are collected here once:
 *
 * - `navigator.clipboard` is missing entirely outside a secure context (plain-http
 *   LAN address), and can reject inside embedded browsers (e.g. Telegram's in-app
 *   WebView). Calling it without a fallback is how "복사 눌러도 아무 일 없음" happens.
 * - **iOS ignores `textarea.select()`.** The fallback needs a real `Range` plus
 *   `setSelectionRange`, and the element must be on-screen and not fully transparent —
 *   an element parked at `top:-9999px` with `opacity:0` copies nothing on Safari.
 * - The caller must be able to *tell the user* — hence a boolean, never a silent throw.
 */

const iosSafeExecCopy = (text) => {
  if (typeof document === 'undefined' || !document.body) return false;
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');           // keeps the on-screen keyboard away
  // Real geometry inside the viewport, near-invisible: what iOS actually accepts.
  // font-size 16px keeps Safari from zooming the page while it is focused.
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;'
    + 'border:none;outline:none;box-shadow:none;background:transparent;opacity:0.01;font-size:16px;';
  document.body.appendChild(el);

  const selection = document.getSelection?.();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.setSelectionRange?.(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    el.remove();
    // Putting the user's own selection back — copying must not steal what they highlighted.
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
  }
};

/** `true` when the text is on the clipboard. Never throws. */
export const copyToClipboard = async (text) => {
  const value = text == null ? '' : String(text);
  if (!value) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch { /* insecure context, denied permission, embedded webview — try the fallback */ }
  }
  // The rejection above resolves in a microtask, so the user gesture is still active here.
  return iosSafeExecCopy(value);
};

export default copyToClipboard;
