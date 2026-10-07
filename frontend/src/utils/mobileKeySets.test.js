import { expect, it } from 'vitest';
import { MOBILE_KEY_SET_PRESETS, activeMobileKeySet, appendMobileShortcut, resolveMobileKeySets } from './mobileKeySets';

it('starts with one set, preserves the existing custom bar and offers other sets as presets', () => {
  const custom = [{ id: 'my-key', kind: 'send', label: 'Mine', payload: 'custom' }];
  const sets = resolveMobileKeySets({ mobileKeys: custom });
  expect(sets.map(set => set.id)).toEqual(['basic']);
  expect(sets[0].keys).toContainEqual(custom[0]);
  expect(sets[0].keys).toContainEqual(expect.objectContaining({ label: 'Shift+←', payload: '\x1b[1;2D' }));
  expect(MOBILE_KEY_SET_PRESETS.find(set => set.id === 'control').keys).toContainEqual(expect.objectContaining({ label: 'Ctrl+C', payload: '\x03' }));
  expect(MOBILE_KEY_SET_PRESETS.find(set => set.id === 'function').keys.filter(key => key.kind === 'send')).toHaveLength(12);
});

it('does not restore the Codex shortcut after the user removes it from a saved set', () => {
  const [basic] = resolveMobileKeySets();
  const settings = { mobileKeySets: [{ ...basic, keys: basic.keys.filter(key => key.payload !== '\x1b[1;2D') }] };
  expect(resolveMobileKeySets(settings)[0].keys.some(key => key.payload === '\x1b[1;2D')).toBe(false);
});

it('retires untouched auto-seeded sets but preserves customized sets and manually added presets', () => {
  const sets = MOBILE_KEY_SET_PRESETS.map(set => ({ ...set }));
  sets[2] = { ...sets[2], label: 'C', icon: 'Keyboard' };
  sets.push({ ...MOBILE_KEY_SET_PRESETS[5], id: 'my-tmux' });
  const settings = { mobileKeySets: sets, activeMobileKeySetId: 'navigation' };
  expect(resolveMobileKeySets(settings).map(set => set.id)).toEqual(['basic', 'control', 'my-tmux']);
  expect(activeMobileKeySet(settings).id).toBe('basic');
});

it('does not resurrect deleted sets or replace edited keys and falls back after the active set is deleted', () => {
  const settings = { mobileKeySets: [{ id: 'mine', label: 'X', icon: 'Keyboard', keys: [{ id: 'k', kind: 'send', payload: 'kept' }] }],
    activeMobileKeySetId: 'deleted' };
  expect(resolveMobileKeySets(settings)).toHaveLength(1);
  expect(activeMobileKeySet(settings).id).toBe('mine');
  expect(activeMobileKeySet(settings).icon).toBe('Keyboard');
});

it('adds a composed shortcut only to the selected set without mutating others or duplicating payloads', () => {
  const settings = { mobileKeySets: [MOBILE_KEY_SET_PRESETS[0], { ...MOBILE_KEY_SET_PRESETS[3], id: 'my-alt' }], activeMobileKeySetId: 'my-alt' };
  const shortcut = { label: 'Ctrl + Alt + X', payload: '\x1b\x18' };
  const patch = appendMobileShortcut(settings, shortcut);
  expect(activeMobileKeySet(patch).keys.at(-1)).toMatchObject({ kind: 'send', ...shortcut });
  expect(resolveMobileKeySets(patch)[0].keys.some(key => key.payload === shortcut.payload)).toBe(false);
  expect(appendMobileShortcut(patch, shortcut)).toBeNull();
});

it('rejects malformed and duplicate sets while keeping a usable input button', () => {
  const sets = resolveMobileKeySets({ mobileKeySets: [null, { id: 'ok', keys: [] }, { id: 'ok', keys: [] }, { id: 'bad' }] });
  expect(sets).toHaveLength(1);
  expect(sets[0].keys.some(key => key.kind === 'cmdInput')).toBe(true);
});
