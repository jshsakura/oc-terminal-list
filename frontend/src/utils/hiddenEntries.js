/**
 * Dot-entry filtering for the folder pickers.
 *
 * A workspace or home directory is full of `.config`, `.cache`, `.local`, `.git`…
 * — none of which anyone is looking for when picking a folder to open a terminal
 * in. They pushed the real folders off the screen and made the list unreadable.
 *
 * Both pickers (local + remote) share this so the two can never disagree about
 * what "hidden" means, and one toggle covers both.
 */

const PREF_KEY = 'iterm.folderPicker.showHidden';

/** `.` and `..` are navigation, not hidden entries — never treat them as such. */
export const isHiddenName = (name) => (
  typeof name === 'string' && name.startsWith('.') && name !== '.' && name !== '..'
);

/**
 * @returns {{ shown: Array, hiddenCount: number }}
 * `hiddenCount` is what the toggle reports, so the user can tell the difference
 * between "this folder is empty" and "everything here is hidden".
 */
export const splitHiddenEntries = (items, showHidden) => {
  const list = Array.isArray(items) ? items : [];
  let hiddenCount = 0;
  const shown = [];
  list.forEach((item) => {
    if (isHiddenName(item?.name)) {
      hiddenCount += 1;
      if (showHidden) shown.push(item);
      return;
    }
    shown.push(item);
  });
  return { shown, hiddenCount };
};

/* The preference outlives one open — having to re-toggle on every pick would be
   its own annoyance. localStorage (not the settings API) because this is local
   UI state, the same call the panel-state helper makes. */
export const readShowHidden = () => {
  try {
    return window.localStorage?.getItem(PREF_KEY) === '1';
  } catch {
    return false; // private mode / blocked storage — default to the quiet list
  }
};

export const writeShowHidden = (value) => {
  try {
    window.localStorage?.setItem(PREF_KEY, value ? '1' : '0');
  } catch { /* not worth failing a click over */ }
};
