/**
 * Spreadsheet (.xlsx/.xlsm) → sheets of string rows, for the editor's table preview.
 *
 * Two rules this file exists to keep:
 *
 * 1. **The parser is a lazy import.** It is a few hundred KB and only a spreadsheet
 *    needs it — the start bundle must not carry it (same reason noVNC is lazy).
 * 2. **Bytes come from the download route, not the raw one.** `/files/raw` is the
 *    *inline render* path and deliberately refuses anything that is not media; here we
 *    only want bytes for our own parser, so the ordinary download endpoint is both
 *    correct and unchanged by that gate.
 */

// Parsing runs on the main thread, so a big workbook would freeze the UI before it
// ever drew a table. Preview is not a data pipeline — refuse rather than hang.
export const MAX_WORKBOOK_BYTES = 12 * 1024 * 1024;
export const MAX_SHEET_ROWS = 2000;

export class WorkbookTooLargeError extends Error {
  constructor() {
    super('workbook too large');
    this.name = 'WorkbookTooLargeError';
  }
}

/** URL that serves the file's raw bytes for the pane's machine. */
export const bytesUrlFor = (path, hostId) => (
  hostId
    ? `/api/hosts/${encodeURIComponent(hostId)}/files/download?path=${encodeURIComponent(path)}`
    : `/api/files/raw?path=${encodeURIComponent(path)}`
);

// Cells arrive as numbers/dates/booleans/null — a table renders strings.
const cellToText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
};

/**
 * `[{ name, rows, truncated }]` for every sheet in the workbook.
 * Throws on transport/parse failure so the caller can show one honest message.
 */
export const loadWorkbook = async (path, hostId, { fetchImpl = fetch, maxRows = MAX_SHEET_ROWS } = {}) => {
  const res = await fetchImpl(bytesUrlFor(path, hostId), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size > MAX_WORKBOOK_BYTES) throw new WorkbookTooLargeError();

  // `/web-worker` is the entry that does *not* spawn workers from a blob: URL — those
  // are the first thing a strict CSP kills, and a preview must not depend on that.
  const { default: readXlsxFile } = await import('read-excel-file/web-worker');
  const sheets = await readXlsxFile(blob);

  return (sheets || []).map((sheet) => ({
    name: sheet.sheet || '',
    rows: (sheet.data || []).slice(0, maxRows).map((row) => (row || []).map(cellToText)),
    truncated: (sheet.data || []).length > maxRows,
  }));
};
