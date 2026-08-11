import { describe, it, expect, vi } from 'vitest';
import { bytesUrlFor, loadWorkbook, MAX_WORKBOOK_BYTES, WorkbookTooLargeError } from './loadWorkbook';

describe('bytesUrlFor', () => {
  it('uses the workspace raw route for local files', () => {
    expect(bytesUrlFor('data/report.xlsx', null))
      .toBe('/api/files/raw?path=data%2Freport.xlsx');
  });

  it('uses that host download route for remote files', () => {
    // Not /files/raw: that route renders inline and refuses non-media on purpose.
    expect(bytesUrlFor('/home/u/report.xlsx', 'h1'))
      .toBe('/api/hosts/h1/files/download?path=%2Fhome%2Fu%2Freport.xlsx');
  });

  it('escapes host ids and paths', () => {
    expect(bytesUrlFor('/a b/c.xlsx', 'h 1')).toBe('/api/hosts/h%201/files/download?path=%2Fa%20b%2Fc.xlsx');
  });
});

describe('loadWorkbook', () => {
  const blobOf = (size) => ({ size });

  it('fails loudly on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 }));
    await expect(loadWorkbook('a.xlsx', 'h1', { fetchImpl })).rejects.toThrow('HTTP 502');
  });

  it('refuses an oversized workbook before importing the parser', async () => {
    // Parsing runs on the main thread — a huge file would freeze the UI, not draw a table.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      blob: async () => blobOf(MAX_WORKBOOK_BYTES + 1),
    }));
    await expect(loadWorkbook('a.xlsx', null, { fetchImpl })).rejects.toBeInstanceOf(WorkbookTooLargeError);
  });

  it('sends the auth cookie with the request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    await loadWorkbook('a.xlsx', null, { fetchImpl }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), { credentials: 'same-origin' });
  });
});
