import { describe, expect, it } from 'vitest';
import { findUrlLinks, rowsJoin } from './terminalUrlLinks';

const COLS = 30;
const row = (text, isWrapped = false) => ({
  text, isWrapped, xs: Array.from({ length: text.length }, (_v, i) => i),
});
const screen = (...rows) => (i) => rows[i] ?? null;
const urls = (getRow, target) => findUrlLinks(getRow, target, COLS).map((l) => l.url);

const URL = 'https://example.com/aaaa/bbbb/cccc/dddd/eeee';

describe('findUrlLinks', () => {
  it('finds a link that fits on one row', () => {
    expect(urls(screen(row('see https://a.com/x ok')), 0)).toEqual(['https://a.com/x']);
  });

  it('joins a URL tmux redrew across rows without the wrapped flag', () => {
    const rows = screen(row(`see ${URL.slice(0, 26)}`), row(`${URL.slice(26)} end`));
    expect(urls(rows, 0)).toEqual([URL]);
    expect(urls(rows, 1)).toEqual([URL]);
  });

  it('joins rows xterm did mark as wrapped', () => {
    const rows = screen(row(`see ${URL.slice(0, 26)}`), row(URL.slice(26), true));
    expect(urls(rows, 1)).toEqual([URL]);
  });

  it('skips the indent an agent TUI puts in front of its continuation', () => {
    const rows = screen(row(`  ⎿ ${URL.slice(0, 25)}`), row(`    ${URL.slice(25)}`));
    const [link] = findUrlLinks(rows, 1, COLS);
    expect(link.url).toBe(URL);
    // The continuation segment starts after the indent, so only the URL is underlined.
    expect(link.segments).toEqual([
      { row: 0, startX: 4, endX: 28 },
      { row: 1, startX: 4, endX: 4 + URL.length - 26 },
    ]);
  });

  it('follows a URL over three rows', () => {
    const long = `https://example.com/${'x'.repeat(60)}`;
    const rows = screen(row(long.slice(0, 30)), row(long.slice(30, 60)), row(`${long.slice(60)} done`));
    expect(urls(rows, 2)).toEqual([long]);
  });

  it('does not glue the next word onto a URL that ended just short of the edge', () => {
    const rows = screen(row('read https://a.com/docs/page'), row('and then go'));
    expect(urls(rows, 0)).toEqual(['https://a.com/docs/page']);
    expect(urls(rows, 1)).toEqual([]);
  });

  it('leaves a short line alone even when the next row starts with a word', () => {
    expect(rowsJoin(row('https://a.com'), row('next'), COLS)).toBe(false);
  });

  it('maps cells past a wide character', () => {
    const text = `한 ${URL.slice(0, 26)}`;
    // '한' takes two cells, so every later character sits one cell to the right.
    const wide = { text, isWrapped: false, xs: Array.from({ length: text.length }, (_v, i) => (i === 0 ? 0 : i + 1)) };
    const [link] = findUrlLinks(screen(wide, row(URL.slice(26))), 0, COLS);
    expect(link.url).toBe(URL);
    expect(link.segments[0]).toEqual({ row: 0, startX: 3, endX: 28 });
  });
});
