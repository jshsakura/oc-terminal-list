import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UI_ACTIONS, UI_ACTION_EVENT, runUiAction, uiActionLabel } from './uiActions';

// Tests run from frontend/.
const BACKEND = resolve(process.cwd(), '../backend/routes/terminator.py');

describe('uiActions', () => {
  it('lists exactly the actions the backend lets the model use', () => {
    const block = readFileSync(BACKEND, 'utf8').split('UI_ACTIONS = (')[1].split(')')[0];
    const fromBackend = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(UI_ACTIONS.map((a) => a.id).sort()).toEqual(fromBackend);
  });

  it('runs only known actions, as a window event', () => {
    const seen = vi.fn();
    window.addEventListener(UI_ACTION_EVENT, seen);
    expect(runUiAction('split-right')).toBe(true);
    expect(runUiAction('rm-rf')).toBe(false);
    window.removeEventListener(UI_ACTION_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toEqual({ action: 'split-right' });
  });

  it('labels fall back when there is no translation', () => {
    expect(uiActionLabel('new-tab', () => undefined)).toBe('새 터미널');
    expect(uiActionLabel('nope', () => 'x')).toBe('');
  });
});
