const inactive = () => ({ dispose() {} });

export default function attachImeTextareaGuard(term) {
  const textarea = term.textarea;
  const root = term.element;
  if (!textarea || !root || term.options.screenReaderMode) return inactive();

  let composing = false;
  let clearTimer = null;

  const clearAfterNativeHandlers = () => {
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = null;
      if (!composing) textarea.value = '';
    }, 0);
  };
  const handleKeyDown = (event) => {
    if (!composing && !event.isComposing && event.keyCode === 229) textarea.value = '';
  };
  const handleKeyUp = (event) => {
    if (!composing && !event.isComposing) clearAfterNativeHandlers();
  };
  const handleCompositionStart = () => {
    composing = true;
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
  };
  const handleCompositionEnd = () => {
    composing = false;
    clearAfterNativeHandlers();
  };

  root.addEventListener('keydown', handleKeyDown, true);
  textarea.addEventListener('keyup', handleKeyUp);
  textarea.addEventListener('compositionstart', handleCompositionStart);
  textarea.addEventListener('compositionend', handleCompositionEnd);

  return {
    dispose() {
      if (clearTimer !== null) clearTimeout(clearTimer);
      root.removeEventListener('keydown', handleKeyDown, true);
      textarea.removeEventListener('keyup', handleKeyUp);
      textarea.removeEventListener('compositionstart', handleCompositionStart);
      textarea.removeEventListener('compositionend', handleCompositionEnd);
    },
  };
}
