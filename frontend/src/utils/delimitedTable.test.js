import { describe, it, expect } from 'vitest';
import { columnCount, detectDelimiter, parseDelimited } from './delimitedTable';

describe('detectDelimiter', () => {
  it('uses tab for .tsv regardless of content', () => {
    expect(detectDelimiter('data.tsv', 'a,b,c')).toBe('\t');
  });

  it('picks the delimiter that wins the header line', () => {
    expect(detectDelimiter('data.csv', 'a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('data.csv', 'a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('data.csv', 'a\tb\tc')).toBe('\t');
  });

  it('falls back to comma when nothing separates anything', () => {
    expect(detectDelimiter('data.csv', 'single-column')).toBe(',');
    expect(detectDelimiter('data.csv', '')).toBe(',');
  });
});

describe('parseDelimited', () => {
  it('splits plain rows', () => {
    expect(parseDelimited('a,b\n1,2').rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps delimiters and newlines that live inside quotes', () => {
    const { rows } = parseDelimited('name,note\n"Kim, J","line1\nline2"');
    expect(rows).toEqual([['name', 'note'], ['Kim, J', 'line1\nline2']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('a\n"say ""hi"""').rows).toEqual([['a'], ['say "hi"']]);
  });

  it('handles CRLF', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n').rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not invent an empty row for a trailing newline', () => {
    expect(parseDelimited('a\nb\n').rows).toEqual([['a'], ['b']]);
  });

  it('keeps genuinely empty fields', () => {
    expect(parseDelimited('a,,c').rows).toEqual([['a', '', 'c']]);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    expect(parseDelimited('﻿id,name').rows[0]).toEqual(['id', 'name']);
  });

  it('respects a custom delimiter', () => {
    expect(parseDelimited('a;b', { delimiter: ';' }).rows).toEqual([['a', 'b']]);
  });

  it('stops at maxRows and reports truncation', () => {
    const text = Array.from({ length: 10 }, (_, i) => `row${i}`).join('\n');
    const { rows, truncated } = parseDelimited(text, { maxRows: 3 });
    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('reports no truncation when everything fits', () => {
    expect(parseDelimited('a\nb', { maxRows: 10 }).truncated).toBe(false);
  });

  it('returns nothing for empty input', () => {
    expect(parseDelimited('').rows).toEqual([]);
  });
});

describe('columnCount', () => {
  it('takes the widest row so ragged files still align', () => {
    expect(columnCount([['a'], ['a', 'b', 'c'], ['a', 'b']])).toBe(3);
  });

  it('is zero for no rows', () => {
    expect(columnCount([])).toBe(0);
  });
});
