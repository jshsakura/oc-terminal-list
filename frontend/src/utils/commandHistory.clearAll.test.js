import { describe, test, expect, beforeEach } from 'vitest';
import { clearAllLocalCommands } from './commandHistory';

const PREFIX = 'iterm:commandHistory:local:v1:';

describe('clearAllLocalCommands', () => {
  beforeEach(() => localStorage.clear());

  test('removes every terminal local recovery slot', () => {
    localStorage.setItem(`${PREFIX}sess-a`, '[]');
    localStorage.setItem(`${PREFIX}sess-b`, '[]');

    clearAllLocalCommands();

    expect(localStorage.getItem(`${PREFIX}sess-a`)).toBeNull();
    expect(localStorage.getItem(`${PREFIX}sess-b`)).toBeNull();
  });

  test('leaves unrelated keys alone', () => {
    localStorage.setItem(`${PREFIX}sess-a`, '[]');
    localStorage.setItem('terminal_settings', '{"theme":"default"}');
    localStorage.setItem('tabs_v2', '[]');

    clearAllLocalCommands();

    expect(localStorage.getItem('terminal_settings')).toBe('{"theme":"default"}');
    expect(localStorage.getItem('tabs_v2')).toBe('[]');
  });

  test('is a no-op when nothing is stored', () => {
    expect(() => clearAllLocalCommands()).not.toThrow();
    expect(localStorage.length).toBe(0);
  });
});
