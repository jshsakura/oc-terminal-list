import { expect, it } from 'vitest';
import { MOBILE_KEY_SET_PRESETS, activeMobileKeySet, appendMobileShortcut, resolveMobileKeySets } from './mobileKeySets';

it('appends the bottom action to basic once, preserves edits and respects later deletion', () => {
  const mine = { id: 'mine', kind: 'send', label: 'Mine', payload: 'kept' };
  const [basic, custom] = resolveMobileKeySets({ mobileKeySets: [
    { id: 'basic', keys: [mine], modifiersSeeded: true, llmSetSeeded: true },
    { id: 'custom', keys: [mine] },
  ] });
  expect(basic.keys.at(-1)).toMatchObject({ kind: 'scrollToBottom' });
  expect(basic.keys).toContainEqual(mine);
  expect(custom.keys.some(key => key.kind === 'scrollToBottom')).toBe(false);
  expect(resolveMobileKeySets({ mobileKeySets: [basic] })[0].keys.filter(key => key.kind === 'scrollToBottom')).toHaveLength(1);
  const deleted = { ...basic, keys: basic.keys.filter(key => key.kind !== 'scrollToBottom') };
  expect(resolveMobileKeySets({ mobileKeySets: [deleted] })[0].keys).toEqual(deleted.keys);
  expect(MOBILE_KEY_SET_PRESETS[0].keys.at(-1)).toMatchObject({ kind: 'scrollToBottom' });
});

it('adds missing default modifiers once and preserves customized keys and subsequent deletions', () => {
  const saved = { id: 'basic', llmSetSeeded: true, keys: [
    { id: 'mine', kind: 'send', label: 'Mine', payload: 'kept' },
    { id: 'ctrl', kind: 'mod', label: 'CTRL' },
    { id: 'my-alt', kind: 'mod', label: 'Option', modifier: 'alt' },
  ] };
  const [migrated] = resolveMobileKeySets({ mobileKeySets: [saved] });
  expect(migrated.keys.filter(key => key.kind === 'mod').map(key => key.modifier || 'ctrl')).toEqual(['ctrl', 'alt', 'shift']);
  expect(migrated.keys).toContainEqual(saved.keys[0]);
  const edited = { ...migrated, keys: migrated.keys.filter(key => key.modifier !== 'shift') };
  expect(resolveMobileKeySets({ mobileKeySets: [edited] })[0].keys).toEqual(edited.keys);
});

it('starts with basic and LLM sets and preserves the existing custom bar', () => {
  const custom = [{ id: 'my-key', kind: 'send', label: 'Mine', payload: 'custom' }];
  const sets = resolveMobileKeySets({ mobileKeys: custom });
  expect(sets.map(set => set.id)).toEqual(['basic', 'llm']);
  expect(sets[0].keys).toContainEqual(custom[0]);
  expect(sets[0].keys.some(key => key.payload === '\x1b[1;2D')).toBe(false);
  expect(sets[1].label).toBe('2');
  expect(sets[1].keys).toContainEqual(expect.objectContaining({ label: 'Shift+←', payload: '\x1b[1;2D' }));
  expect(MOBILE_KEY_SET_PRESETS.find(set => set.id === 'control').keys).toContainEqual(expect.objectContaining({ label: 'Ctrl+C', payload: '\x03' }));
  expect(MOBILE_KEY_SET_PRESETS.find(set => set.id === 'function').keys.filter(key => key.kind === 'send')).toHaveLength(12);
});

it('does not restore a deleted or customized LLM set', () => {
  const [basic, llm] = resolveMobileKeySets();
  expect(resolveMobileKeySets({ mobileKeySets: [basic] })).toHaveLength(1);
  const edited = { ...llm, keys: llm.keys.filter(key => key.payload !== '\x1b[1;2D') };
  expect(resolveMobileKeySets({ mobileKeySets: [basic, edited] })[1].keys).toEqual(edited.keys);
});

it('moves only the automatically added Shift+Left from basic to LLM and retains other edits', () => {
  const basic = { ...MOBILE_KEY_SET_PRESETS[0], codexShortcutSeeded: true,
    keys: [...MOBILE_KEY_SET_PRESETS[0].keys,
      { id: 'shift-left', kind: 'send', label: 'Shift+←', payload: '\x1b[1;2D' },
      { id: 'mine', kind: 'send', label: 'Selection', payload: '\x1b[1;2D' }] };
  const sets = resolveMobileKeySets({ mobileKeySets: [basic] });
  expect(sets[0].keys.some(key => key.id === 'shift-left')).toBe(false);
  expect(sets[0].keys).toContainEqual(expect.objectContaining({ id: 'mine', label: 'Selection' }));
  expect(sets[1].keys).toContainEqual(expect.objectContaining({ label: 'Shift+←' }));
});

it.each([
  ['Shift+←', '\x1b[1;2D'], ['Shift+→', '\x1b[1;2C'], ['Shift+Tab', '\x1b[Z'], ['Ctrl+J', '\n'],
  ['Ctrl+T', '\x14'], ['Ctrl+O', '\x0f'], ['Ctrl+R', '\x12'],
  ['Ctrl+G', '\x07'], ['Alt+P', '\x1bp'], ['Alt+T', '\x1bt'],
])('encodes LLM shortcut %s as terminal bytes', (label, payload) => {
  const llm = resolveMobileKeySets()[1];
  expect(llm.keys.find(key => key.label === label)?.payload).toBe(payload);
});

it('retires untouched auto-seeded sets but preserves customized sets and manually added presets', () => {
  const sets = MOBILE_KEY_SET_PRESETS.filter(set => set.id !== 'llm').map(set => ({ ...set }));
  sets[2] = { ...sets[2], label: 'C', icon: 'Keyboard' };
  sets.push({ ...MOBILE_KEY_SET_PRESETS.find(set => set.id === 'tmux'), id: 'my-tmux' });
  const settings = { mobileKeySets: sets, activeMobileKeySetId: 'navigation' };
  expect(resolveMobileKeySets(settings).map(set => set.id)).toEqual(['basic', 'llm', 'control', 'my-tmux']);
  expect(activeMobileKeySet(settings).id).toBe('basic');
});

it('retains the LLM set when retiring legacy presets after migration', () => {
  const sets = MOBILE_KEY_SET_PRESETS.map(set => set.id === 'basic' ? { ...set, llmSetSeeded: true } : set);
  expect(resolveMobileKeySets({ mobileKeySets: sets }).map(set => set.id)).toEqual(['basic', 'llm']);
});

it('does not resurrect deleted sets or replace edited keys and falls back after the active set is deleted', () => {
  const settings = { mobileKeySets: [{ id: 'mine', label: 'X', icon: 'Keyboard', keys: [{ id: 'k', kind: 'send', payload: 'kept' }] }],
    activeMobileKeySetId: 'deleted' };
  expect(resolveMobileKeySets(settings)).toHaveLength(1);
  expect(activeMobileKeySet(settings).id).toBe('mine');
  expect(activeMobileKeySet(settings).icon).toBe('Keyboard');
});

it('adds a composed shortcut only to the selected set without mutating others or duplicating payloads', () => {
  const settings = { mobileKeySets: [MOBILE_KEY_SET_PRESETS[0], { ...MOBILE_KEY_SET_PRESETS.find(set => set.id === 'alt'), id: 'my-alt' }], activeMobileKeySetId: 'my-alt' };
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
