const NAMED_KEYS = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  space: 'Space', spacebar: 'Space', backspace: 'Backspace',
  arrowup: 'ArrowUp', up: 'ArrowUp', '↑': 'ArrowUp',
  arrowdown: 'ArrowDown', down: 'ArrowDown', '↓': 'ArrowDown',
  arrowleft: 'ArrowLeft', left: 'ArrowLeft', '←': 'ArrowLeft',
  arrowright: 'ArrowRight', right: 'ArrowRight', '→': 'ArrowRight',
  home: 'Home', end: 'End', insert: 'Insert', ins: 'Insert', delete: 'Delete', del: 'Delete',
  pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown',
};
const CURSOR_KEYS = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
const TILDE_KEYS = { Insert: 2, Delete: 3, PageUp: 5, PageDown: 6,
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24 };
const SHIFTED_KEYS = Object.fromEntries(Array.from('`1234567890-=[]\\;\',./')
  .map((key, index) => [key, '~!@#$%^&*()_+{}|:"<>?'[index]]));

export function applyTerminalModifiers(payload, { ctrl = false, alt = false, shift = false } = {}) {
  if (!ctrl && !alt && !shift) return payload;
  const sequence = /^\x1b(?:\[(\d*)(?:;(\d+))?([A-DFHPQRSZ~])|O([A-DFHPQRS]))$/.exec(payload);
  let key = { '\r': 'Enter', '\t': 'Tab', '\x1b': 'Escape', '\x7f': 'Backspace' }[payload];
  let previous = 0;
  if (sequence) {
    const [, number, modifier, csi, ss3] = sequence;
    const suffix = csi || ss3;
    previous = modifier ? Number(modifier) - 1 : suffix === 'Z' ? 1 : 0;
    key = suffix === '~' ? Object.keys(TILDE_KEYS).find(name => TILDE_KEYS[name] === Number(number))
      : suffix === 'Z' ? 'Tab'
        : Object.keys(CURSOR_KEYS).find(name => CURSOR_KEYS[name] === suffix)
          || (['P', 'Q', 'R', 'S'].includes(suffix) ? `F${'PQRS'.indexOf(suffix) + 1}` : null);
  }
  if (key || (payload.length === 1 && payload.charCodeAt(0) >= 32)) {
    const result = terminalKeyCombination(key || payload, {
      ctrl: ctrl || Boolean(previous & 4), alt: alt || Boolean(previous & 2), shift: shift || Boolean(previous & 1),
    });
    if (result.payload !== null) return result.payload;
  }
  return alt ? `\x1b${payload}` : payload;
}

export default function terminalKeyCombination(value, { ctrl = false, alt = false, shift = false } = {}) {
  const text = value === ' ' ? 'Space' : value.trim();
  if (!text) { return { label: '', payload: null, error: 'empty' }; }
  const named = NAMED_KEYS[text.toLowerCase()] || (/^f(?:[1-9]|1[0-2])$/i.test(text) ? text.toUpperCase() : null);
  const key = named || text;
  const label = [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift',
    /^[a-z]$/i.test(key) && (ctrl || alt || shift) ? key.toUpperCase() : key].filter(Boolean).join(' + ');
  const modifiers = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  let payload = null;
  if (CURSOR_KEYS[key]) {
    payload = `\x1b[${modifiers > 1 ? `1;${modifiers}` : ''}${CURSOR_KEYS[key]}`;
  } else if (TILDE_KEYS[key]) {
    payload = `\x1b[${TILDE_KEYS[key]}${modifiers > 1 ? `;${modifiers}` : ''}~`;
  } else if (/^F[1-4]$/.test(key)) {
    const suffix = 'PQRS'[Number(key.slice(1)) - 1];
    payload = modifiers > 1 ? `\x1b[1;${modifiers}${suffix}` : `\x1bO${suffix}`;
  } else if (key === 'Tab') {
    payload = shift ? '\x1b[Z' : '\t';
    if (alt) { payload = `\x1b${payload}`; }
  } else if (key === 'Enter' || key === 'Escape' || key === 'Backspace') {
    payload = key === 'Enter' ? '\r' : key === 'Escape' ? '\x1b' : ctrl ? '\b' : '\x7f';
    if (alt) { payload = `\x1b${payload}`; }
  } else if (key === 'Space' || Array.from(key).length === 1) {
    let character = key === 'Space' ? ' ' : key;
    if (shift) { character = SHIFTED_KEYS[character] || character.toUpperCase(); }
    if (ctrl) {
      const upper = character.toUpperCase();
      const code = upper.charCodeAt(0);
      if (character === ' ' || character === '@' || character === '`' || character === '2') {
        character = '\x00';
      } else if (upper.length === 1 && code >= 65 && code <= 95) {
        character = String.fromCharCode(code - 64);
      } else if (/^[3-7]$/.test(character)) {
        character = String.fromCharCode(Number(character) + 24);
      } else if (character === '8' || character === '?') {
        character = '\x7f';
      } else {
        return { label, payload: null, error: 'unsupported' };
      }
    }
    if (Array.from(character).length === 1) { payload = `${alt ? '\x1b' : ''}${character}`; }
  }
  return { label, payload, error: payload === null ? 'unsupported' : null };
}
