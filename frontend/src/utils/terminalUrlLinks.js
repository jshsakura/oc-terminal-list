/**
 * Clickable http(s) links that survive being broken across rows.
 *
 * WebLinksAddon only follows rows xterm marked `isWrapped`. Inside this app that flag is
 * usually missing: tmux redraws every row with cursor moves (tab switch, reattach, resize),
 * and agent TUIs hard-wrap with their own newlines and indent. A long URL then turned into
 * two links, each opening a truncated address.
 *
 * So a row continues into the next one when its text runs up to the right edge and the next
 * row (after its indent) starts with URL characters. Pure: rows come in as plain objects.
 */

// Same shape as @xterm/addon-web-links' strict regex, so single-row links behave as before.
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;
const URL_CHAR_RE = /[^\s"'!*(){}|\\^<>`]/;
// A token that only a URL would contain. Used when the row stops a little short of the edge,
// where an ordinary word wrapped to the next row would otherwise be glued onto the link.
const URL_TAIL_HINT_RE = /[/?#&=%._~\-0-9]/;
// Box and tree glyphs agent TUIs draw in front of wrapped text.
const INDENT_RE = /^[\s│┃|⎿▏▕]*/;

// Rows that end this close to the right edge still count as reaching it (TUI right padding).
export const EDGE_SLACK_COLS = 4;
export const MAX_JOINED_ROWS = 8;

const trimmedEnd = (row) => row.text.replace(/\s+$/, '').length;

const continuationStart = (row) => {
  if (row.isWrapped) return 0;
  return row.text.match(INDENT_RE)[0].length;
};

/** Does `prev` run on into `next`? */
export const rowsJoin = (prev, next, cols) => {
  if (!prev || !next) return false;
  const end = trimmedEnd(prev);
  if (end === 0 || !URL_CHAR_RE.test(prev.text[end - 1])) return false;
  const lastCol = prev.xs[end - 1] ?? end - 1;
  const gap = cols - 1 - lastCol;
  if (gap > EDGE_SLACK_COLS) return false;

  const start = continuationStart(next);
  const token = next.text.slice(start).split(/\s/)[0];
  if (!token || !URL_CHAR_RE.test(token[0])) return false;
  if (next.isWrapped || gap <= 1) return true;
  return URL_TAIL_HINT_RE.test(token);
};

/**
 * Links that touch row `target`.
 *
 * @param getRow (index) => { text, xs, isWrapped } | null. `xs[i]` is the 0-based cell of
 *               `text[i]`, which differs from `i` once a wide character sits before it.
 * @returns [{ url, segments: [{ row, startX, endX }] }], cells 0-based and inclusive,
 *          keeping only links with a segment on `target`.
 */
export const findUrlLinks = (getRow, target, cols) => {
  let first = target;
  while (first > 0 && target - first < MAX_JOINED_ROWS && rowsJoin(getRow(first - 1), getRow(first), cols)) {
    first -= 1;
  }

  let joined = '';
  const map = [];
  for (let index = first; index - first < MAX_JOINED_ROWS * 2; index += 1) {
    const row = getRow(index);
    if (!row) break;
    if (index > first && !rowsJoin(getRow(index - 1), row, cols)) break;
    const from = index === first ? 0 : continuationStart(row);
    for (let i = from; i < row.text.length; i += 1) {
      joined += row.text[i];
      map.push({ row: index, x: row.xs[i] ?? i });
    }
    if (index >= target && !rowsJoin(row, getRow(index + 1), cols)) break;
  }

  const links = [];
  for (const match of joined.matchAll(URL_RE)) {
    const segments = [];
    for (let i = match.index; i < match.index + match[0].length; i += 1) {
      const cell = map[i];
      const last = segments[segments.length - 1];
      if (last && last.row === cell.row) last.endX = cell.x;
      else segments.push({ row: cell.row, startX: cell.x, endX: cell.x });
    }
    if (segments.some((s) => s.row === target)) links.push({ url: match[0], segments });
  }
  return links;
};

/** Cell-aligned view of an xterm buffer line for `findUrlLinks`. */
export const readRow = (buffer, index, cols) => {
  const line = buffer?.getLine(index);
  if (!line) return null;
  let text = '';
  const xs = [];
  const cell = line.getCell?.(0);
  if (!cell) {
    text = line.translateToString(false);
    return { text, xs: Array.from({ length: text.length }, (_v, i) => i), isWrapped: Boolean(line.isWrapped) };
  }
  for (let x = 0; x < cols; x += 1) {
    const c = line.getCell(x, cell);
    if (!c || c.getWidth() === 0) continue;
    const chars = c.getChars() || ' ';
    text += chars;
    // Per UTF-16 unit, so a surrogate pair keeps `xs` aligned with `text`.
    for (let k = 0; k < chars.length; k += 1) xs.push(x);
  }
  return { text, xs, isWrapped: Boolean(line.isWrapped) };
};
