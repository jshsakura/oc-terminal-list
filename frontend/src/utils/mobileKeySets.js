import { DEFAULT_MOBILE_KEYS, KEY_PRESETS, TMUX_KEYS, sanitizeMobileKeys } from './mobileKeys';

const withCodexShortcut = keys => {
  if (keys.some(key => key.kind === 'send' && key.payload === '\x1b[1;2D')) return keys;
  const shortcut = { id: 'shift-left', kind: 'send', label: 'Shift+←', payload: '\x1b[1;2D' };
  const left = keys.findIndex(key => key.id === 'left');
  return left < 0 ? [...keys, shortcut] : [...keys.slice(0, left + 1), shortcut, ...keys.slice(left + 1)];
};

const keysFromPresets = (presets, prefix) => [
  { id: `${prefix}-input`, kind: 'cmdInput', tone: 'accent' },
  { id: `${prefix}-divider`, kind: 'sep' },
  ...presets.map((key, index) => ({ kind: 'send', ...key, id: `${prefix}-${index}` })),
];

export const MOBILE_KEY_SET_PRESETS = [
  { id: 'basic', nameKey: 'keySetBasic', label: '1', keys: withCodexShortcut(DEFAULT_MOBILE_KEYS) },
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
  const wasAutoSeeded = MOBILE_KEY_SET_PRESETS.every(preset => sets.some(set => set.id === preset.id));
  const kept = wasAutoSeeded ? sets.filter(set => {
    const preset = MOBILE_KEY_SET_PRESETS.find(preset => preset.id === set.id && preset.id !== 'basic');
    return !preset || !isUneditedPreset(set, preset);
  }) : sets;
  const resolved = kept.length ? kept : [{ ...MOBILE_KEY_SET_PRESETS[0],
    keys: sanitizeMobileKeys(settings.mobileKeys ?? DEFAULT_MOBILE_KEYS) }];
  return resolved.map(set => set.id === 'basic' && !set.codexShortcutSeeded
    ? { ...set, keys: withCodexShortcut(set.keys), codexShortcutSeeded: true } : set);
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
