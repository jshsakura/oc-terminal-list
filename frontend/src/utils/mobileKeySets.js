import { DEFAULT_MOBILE_KEYS, MOBILE_MODIFIER_KEYS, KEY_PRESETS, TMUX_KEYS, sanitizeMobileKeys } from './mobileKeys';

const keysFromPresets = (presets, prefix) => [
  { id: `${prefix}-input`, kind: 'cmdInput', tone: 'accent' },
  { id: `${prefix}-divider`, kind: 'sep' },
  ...presets.map((key, index) => ({ kind: 'send', ...key, id: `${prefix}-${index}` })),
];

export const MOBILE_KEY_SET_PRESETS = [
  { id: 'basic', nameKey: 'keySetBasic', label: '1', keys: DEFAULT_MOBILE_KEYS },
  { id: 'llm', nameKey: 'keySetLlm', label: '2', keys: keysFromPresets([
    { label: 'Shift+←', payload: '\x1b[1;2D' },
    { label: 'Shift+→', payload: '\x1b[1;2C' },
    { label: 'Shift+Tab', payload: '\x1b[Z' },
    { label: 'Ctrl+J', payload: '\n' },
    { label: 'ESC', payload: '\x1b' },
    { label: 'Ctrl+C', payload: '\x03', tone: 'danger' },
    { label: 'Ctrl+T', payload: '\x14' },
    { label: 'Ctrl+O', payload: '\x0f' },
    { label: 'Ctrl+R', payload: '\x12' },
    { label: 'Ctrl+G', payload: '\x07' },
    { label: 'Alt+P', payload: '\x1bp' },
    { label: 'Alt+T', payload: '\x1bt' },
  ], 'llm') },
  { id: 'navigation', nameKey: 'keySetNavigation', label: '2', keys: keysFromPresets(
    KEY_PRESETS.filter(key => ['←', '↑', '↓', '→', 'Home', 'End', 'PgUp', 'PgDn', 'Ins', 'Del'].includes(key.label)), 'navigation') },
  { id: 'control', nameKey: 'keySetControl', label: '3', keys: keysFromPresets(
    KEY_PRESETS.filter(key => key.label?.startsWith('^') || key.label === 'Ctrl+Space')
      .map(key => ({ ...key, label: key.label.startsWith('^') ? `Ctrl+${key.label.slice(1)}` : key.label })), 'control') },
  { id: 'alt', nameKey: 'keySetAlt', label: '4', keys: keysFromPresets(
    KEY_PRESETS.filter(key => key.label?.startsWith('⌥')).map(key => ({ ...key, label: `Alt+${key.label.slice(1)}` })), 'alt') },
  { id: 'function', nameKey: 'keySetFunction', label: '5', keys: keysFromPresets(
    KEY_PRESETS.filter(key => /^F\d+$/.test(key.label)), 'function') },
  { id: 'tmux', nameKey: 'keySetTmux', label: '6', keys: keysFromPresets(TMUX_KEYS, 'tmux') },
  { id: 'text', nameKey: 'keySetText', label: '7', keys: keysFromPresets(
    KEY_PRESETS.filter(key => ['sudo', 'cd', 'git', 'ls -la', 'clear'].includes(key.label)), 'text') },
  { id: 'special', nameKey: 'keySetSpecial', label: '8', keys: keysFromPresets(
    KEY_PRESETS.filter(key => ['ESC', 'TAB', 'Shift+Tab', 'Enter', 'Space', 'Shift+Enter', 'Del', '⌫', 'Ctrl+Space'].includes(key.label)), 'special') },
];

export const newMobileKeySetId = () => `set-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

const isUneditedPreset = (set, preset) => !set.name && !set.icon && set.label === preset.label
  && set.nameKey === preset.nameKey && set.keys.length === preset.keys.length
  && set.keys.every((key, index) => {
    const expected = preset.keys[index];
    return Object.keys(key).length === Object.keys(expected).length
      && Object.entries(expected).every(([name, value]) => key[name] === value);
  });

// Retire automatically seeded sets only; edited sets and manually added presets survive.
export const resolveMobileKeySets = (settings = {}) => {
  const ids = new Set();
  const sets = Array.isArray(settings.mobileKeySets) ? settings.mobileKeySets.filter(set => {
    if (!set || typeof set.id !== 'string' || !set.id || ids.has(set.id) || !Array.isArray(set.keys)) return false;
    ids.add(set.id);
    return true;
  }).map(set => ({ ...set, label: typeof set.label === 'string' ? set.label : '',
    icon: typeof set.icon === 'string' ? set.icon : '', keys: sanitizeMobileKeys(set.keys) })) : [];
  const wasAutoSeeded = MOBILE_KEY_SET_PRESETS.filter(preset => preset.id !== 'llm')
    .every(preset => sets.some(set => set.id === preset.id));
  const kept = wasAutoSeeded ? sets.filter(set => {
    const preset = MOBILE_KEY_SET_PRESETS.find(preset => preset.id === set.id && !['basic', 'llm'].includes(preset.id));
    return !preset || !isUneditedPreset(set, preset);
  }) : sets;
  const initial = kept.length ? kept : [{ ...MOBILE_KEY_SET_PRESETS[0],
    keys: sanitizeMobileKeys(settings.mobileKeys ?? DEFAULT_MOBILE_KEYS) }];
  const resolved = initial.map(set => {
    if (set.id !== 'basic' || set.modifiersSeeded) return set;
    const missing = MOBILE_MODIFIER_KEYS.filter(mod => !set.keys.some(key => key.kind === 'mod'
      && (key.modifier || 'ctrl') === mod.modifier));
    const lastModifier = set.keys.findLastIndex(key => key.kind === 'mod');
    const at = lastModifier < 0 ? set.keys.length : lastModifier + 1;
    return { ...set, modifiersSeeded: true, keys: [...set.keys.slice(0, at), ...missing, ...set.keys.slice(at)] };
  });
  const basic = resolved.find(set => set.id === 'basic');
  if (!basic || basic.llmSetSeeded) return resolved;
  const migrated = resolved.map(set => set.id === 'basic' ? { ...set, llmSetSeeded: true,
    keys: set.codexShortcutSeeded ? set.keys.filter(key => !(key.id === 'shift-left'
      && key.label === 'Shift+←' && key.payload === '\x1b[1;2D')) : set.keys } : set);
  if (!migrated.some(set => set.id === 'llm')) migrated.splice(1, 0, MOBILE_KEY_SET_PRESETS.find(set => set.id === 'llm'));
  return migrated;
};

export const activeMobileKeySet = (settings, sets = resolveMobileKeySets(settings)) => (
  sets.find(set => set.id === settings.activeMobileKeySetId) || sets[0]
);

export const appendMobileShortcut = (settings, shortcut) => {
  const sets = resolveMobileKeySets(settings);
  const active = activeMobileKeySet(settings, sets);
  if (active.keys.some(key => key.kind === 'send' && key.payload === shortcut.payload)) return null;
  return {
    activeMobileKeySetId: active.id,
    mobileKeySets: sets.map(set => set.id === active.id ? { ...set,
      keys: [...set.keys, { id: newMobileKeySetId(), kind: 'send', ...shortcut }] } : set),
  };
};
