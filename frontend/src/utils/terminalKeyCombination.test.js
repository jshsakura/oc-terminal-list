import { describe, expect, it } from 'vitest';
import terminalKeyCombination from './terminalKeyCombination';

describe('terminal key combinations', () => {
  it.each([
    ['c', { ctrl: true }, '\x03', 'Ctrl + C'],
    ['x', { ctrl: true, alt: true }, '\x1b\x18', 'Ctrl + Alt + X'],
    ['c', { ctrl: true, shift: true }, '\x03', 'Ctrl + Shift + C'],
    ['f', { alt: true }, '\x1bf', 'Alt + F'],
    ['a', { alt: true, shift: true }, '\x1bA', 'Alt + Shift + A'],
    ['a', { shift: true }, 'A', 'Shift + A'],
    ['1', { shift: true }, '!', 'Shift + 1'],
    ['Tab', { shift: true }, '\x1b[Z', 'Shift + Tab'],
    ['ArrowUp', { ctrl: true }, '\x1b[1;5A', 'Ctrl + ArrowUp'],
    ['←', { ctrl: true, alt: true, shift: true }, '\x1b[1;8D', 'Ctrl + Alt + Shift + ArrowLeft'],
    ['PageDown', { alt: true }, '\x1b[6;3~', 'Alt + PageDown'],
    ['Home', { shift: true }, '\x1b[1;2H', 'Shift + Home'],
    ['F1', {}, '\x1bOP', 'F1'],
    ['F12', { ctrl: true }, '\x1b[24;5~', 'Ctrl + F12'],
    ['Space', { ctrl: true }, '\x00', 'Ctrl + Space'],
    ['Enter', { alt: true }, '\x1b\r', 'Alt + Enter'],
    ['Backspace', { ctrl: true }, '\b', 'Ctrl + Backspace'],
    ['Escape', {}, '\x1b', 'Escape'],
  ])('encodes %s with %j', (key, modifiers, payload, label) => {
    expect(terminalKeyCombination(key, modifiers)).toEqual({ label, payload, error: null });
  });

  it.each(['', '  ', 'hello', 'Ctrl+C', 'F13', 'Unknown'])('rejects invalid key %j', (key) => {
    expect(terminalKeyCombination(key).payload).toBeNull();
  });
  it('rejects characters without a Ctrl mapping and keeps literal space distinct from empty input', () => {
    expect(terminalKeyCombination('한', { ctrl: true }).error).toBe('unsupported');
    expect(terminalKeyCombination('ß', { ctrl: true }).error).toBe('unsupported');
    expect(terminalKeyCombination('9', { ctrl: true }).payload).toBeNull();
    expect(terminalKeyCombination(' ').payload).toBe(' ');
  });
});
