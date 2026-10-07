// Apply before any focus call, including the first frame on iOS.
export default function setTerminalReadOnly(term, readOnly) {
  if (!term) return;
  term.options.disableStdin = readOnly;
  if (term.textarea) {
    term.textarea.readOnly = readOnly;
    term.textarea.inputMode = readOnly ? 'none' : 'text';
    term.textarea.tabIndex = readOnly ? -1 : 0;
  }
  if (readOnly) term.blur?.();
}
