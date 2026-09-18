import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import attachImeTextareaGuard from './attachImeTextareaGuard';

describe('IME textarea guard', () => {
  let root;
  let textarea;
  let guard;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    textarea = document.createElement('textarea');
    root.appendChild(textarea);
    document.body.appendChild(root);
  });

  afterEach(() => {
    guard?.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it('clears committed composition only after xterm reads it', () => {
    // Given
    let emitted = '';
    textarea.addEventListener('compositionend', () => {
      setTimeout(() => { emitted = textarea.value; }, 0);
    });
    guard = attachImeTextareaGuard({
      element: root,
      textarea,
      options: { screenReaderMode: false },
    });
    textarea.value = '한글';

    // When
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글' }));
    vi.runAllTimers();

    // Then
    expect(emitted).toBe('한글');
    expect(textarea.value).toBe('');
  });

  it('removes accumulated text before a 229 diff can replay it', () => {
    // Given
    guard = attachImeTextareaGuard({
      element: root,
      textarea,
      options: { screenReaderMode: false },
    });
    textarea.value = 'f'.repeat(40);
    const event = new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: 229 });

    // When
    textarea.dispatchEvent(event);

    // Then
    expect(textarea.value).toBe('');
  });

  it('preserves the textarea in screen-reader mode', () => {
    guard = attachImeTextareaGuard({
      element: root,
      textarea,
      options: { screenReaderMode: true },
    });
    textarea.value = 'announced text';

    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'A', bubbles: true }));
    vi.runAllTimers();

    expect(textarea.value).toBe('announced text');
  });
});
