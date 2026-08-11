/**
 * CSV/TSV → rows, for the file editor's table preview.
 *
 * Hand-rolled rather than pulled from npm because the whole job is one state machine
 * over quotes, and a preview must never be the reason the start bundle grows: this is
 * ~40 lines and ships in the main chunk, while the xlsx reader stays a lazy import.
 */

// A quoted field may contain the delimiter, newlines and doubled quotes ("" → ").
const QUOTE = '"';

/** Delimiter by extension, falling back to whichever candidate wins the first line. */
export const detectDelimiter = (name = '', text = '') => {
  if (/\.tsv$/i.test(name)) return '\t';
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  // Semicolon CSV is the norm in locales where the comma is the decimal separator.
  const best = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a), ',');
  return count(best) > 0 ? best : ',';
};

/**
 * `{ rows, truncated }` — rows is an array of string arrays.
 *
 * `maxRows` is a guard, not a preference: a 200k-row export would otherwise build a
 * DOM the browser cannot lay out. The caller says so on screen when it trips.
 */
export const parseDelimited = (text = '', { delimiter = ',', maxRows = 2000 } = {}) => {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    if (rows.length >= maxRows) truncated = true;
    return !truncated;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch !== QUOTE) { field += ch; continue; }
      if (source[i + 1] === QUOTE) { field += QUOTE; i += 1; continue; } // "" → literal quote
      inQuotes = false;
      continue;
    }
    if (ch === QUOTE) { inQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\r') continue;            // CRLF: the \n does the work
    if (ch === '\n') { if (!endRow()) break; continue; }
    field += ch;
  }
  // A trailing newline must not invent an empty last row; anything else must be kept.
  if (!truncated && (field !== '' || row.length > 0)) endRow();

  return { rows, truncated };
};

/** Widest row wins — ragged files still line their columns up under one header. */
export const columnCount = (rows) => rows.reduce((max, r) => Math.max(max, r.length), 0);
