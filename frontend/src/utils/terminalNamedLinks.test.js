import { describe, expect, it, vi } from 'vitest';
import { findTerminalNamedLinks, getPresentedNamedLinks, rangeContainsCell, namedFileLink } from './terminalNamedLinks';

function makeBuffer(rows, cols = 100) {
  const lines = rows.map(row => {
    const { text, wrapped = false, linked = false } = typeof row === 'string' ? { text: row } : row;
    const cells = [];
    for (const { segment } of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)) {
      const width = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3]|\p{Extended_Pictographic}/u.test(segment) ? 2 : 1;
      cells.push({ getChars: () => segment, getWidth: () => width, extended: { urlId: linked ? 42 : 0 } });
      if (width === 2) { cells.push({ getChars: () => '', getWidth: () => 0 }); }
    }
    if (cells.length > cols) { throw new Error(`Fixture exceeds ${cols} columns`); }
    return { isWrapped: wrapped, getCell: col => cells[col] || { getChars: () => '', getWidth: () => 1 } };
  });
  return { getLine: vi.fn(row => lines[row]) };
}

describe('findTerminalNamedLinks', () => {
  it('maps Korean labels to complete terminal cells and hides only the suffix', () => {
    const [link] = findTerminalNamedLinks(makeBuffer(['• PNG 파일뷰어 (https://example.test/a.png)']), 0, 0, 100);
    expect(link).toMatchObject({ label: 'PNG 파일뷰어', target: 'https://example.test/a.png', kind: 'web', labelRange: { start: { x: 3, y: 1 }, end: { x: 14, y: 1 } } });
    expect(link.hiddenRanges[0].start).toEqual({ x: 15, y: 1 });
  });

  it('finds multiple named files including an indented hard wrap', () => {
    const links = findTerminalNamedLinks(makeBuffer(['PC 화면 (2026-10/pc.png) · 모바일 화면 (2026-10/', '  screenshots/mobile.png)']), 0, 1, 100);
    expect(links.map(link => [link.label, link.target, link.kind])).toEqual([
      ['PC 화면', '2026-10/pc.png', 'file'], ['모바일 화면', '2026-10/screenshots/mobile.png', 'file'],
    ]);
    expect(links[1].hiddenRanges[1]).toEqual({ start: { x: 1, y: 2 }, end: { x: 25, y: 2 } });
  });

  it('joins soft wraps without shifting combining characters or emoji', () => {
    const buffer = makeBuffer(['e\u0301😀 (https://ex.', { text: 'test/a.png)', wrapped: true }], 16);
    const [link] = findTerminalNamedLinks(buffer, 0, 1, 16);
    expect(link.label).toBe('e\u0301😀');
    expect(link.target).toBe('https://ex.test/a.png');
    expect(link.labelRange).toEqual({ start: { x: 1, y: 1 }, end: { x: 3, y: 1 } });
    expect(link.hiddenRanges[1].end).toEqual({ x: 11, y: 2 });
  });

  it('hides markdown markers while keeping neighboring prose', () => {
    const [link] = findTerminalNamedLinks(makeBuffer(['See [image](./a/b.png) for details']), 0, 0, 100);
    expect(link.labelRange).toEqual({ start: { x: 6, y: 1 }, end: { x: 10, y: 1 } });
    expect(link.hiddenRanges).toEqual([
      { start: { x: 5, y: 1 }, end: { x: 5, y: 1 } },
      { start: { x: 11, y: 1 }, end: { x: 22, y: 1 } },
    ]);
  });

  it.each([
    'name (javascript:alert(1))', 'name (data:text/plain,hello)', 'name (ftp://example.test/a)',
    'name (https://example.test/incomplete', 'name (ordinary words)',
    'name (https://example.test/a\n  unrelated prose)', 'name (src/a\nnext.png)',
    'name (https://example.test/a\n\n  b.png)', 'name (//server/path)',
  ])('rejects unsupported or interrupted targets: %s', text => {
    expect(findTerminalNamedLinks(makeBuffer(text.split('\n')), 0, 3, 100)).toEqual([]);
  });

  it('preserves balanced parentheses in URLs', () => {
    const [link] = findTerminalNamedLinks(makeBuffer(['article (https://example.test/a_(b))']), 0, 0, 100);
    expect(link.target).toBe('https://example.test/a_(b)');
  });

  it('preserves padded list labels and their cells across a line break on a wide screen', () => {
    const buffer = makeBuffer([' '.repeat(319), '   12.  문서   ', '  (docs/a.md)\u00a0\u00a0- 둘째 (docs/b.md)'], 319);
    const links = findTerminalNamedLinks(buffer, 0, 2, 319);
    expect(links.map(({ label, target, labelRange }) => [label, target, labelRange])).toEqual([
      ['문서', 'docs/a.md', { start: { x: 9, y: 2 }, end: { x: 12, y: 2 } }],
      ['둘째', 'docs/b.md', { start: { x: 18, y: 3 }, end: { x: 21, y: 3 } }],
    ]);
  });

  it('skips existing OSC 8 links', () => {
    expect(findTerminalNamedLinks(makeBuffer([{ text: 'name (src/a.png)', linked: true }]), 0, 0, 100)).toEqual([]);
  });

  it('bounds buffer reads to the viewport and eight context rows on each side', () => {
    const buffer = makeBuffer(Array.from({ length: 200 }, (_, index) => `row ${index} (src/a.png)`));
    const links = findTerminalNamedLinks(buffer, 50, 52, 100);
    expect(links).toHaveLength(3);
    expect(buffer.getLine.mock.calls.map(([row]) => row)).toEqual(Array.from({ length: 19 }, (_, index) => 42 + index));
  });

  it('finds a label above the viewport when its wrapped URL is visible', () => {
    const links = findTerminalNamedLinks(makeBuffer(['name (https://example.test/', '  screenshot.png)']), 1, 1, 100);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('https://example.test/screenshot.png');
    expect(links[0].labelRange.start.y).toBe(1);
  });

  it('keeps each markdown label separate', () => {
    const links = findTerminalNamedLinks(makeBuffer(['[one](src/a.png) · [two](src/b.png)']), 0, 0, 100);
    expect(links.map(link => link.label)).toEqual(['one', 'two']);
  });
});

describe('named link presentation', () => {
  function terminal() {
    return { cols: 100, hasSelection: () => false, buffer: { active: makeBuffer(['file (src/a.png)', 'web (https://example.test/a)']) } };
  }

  it('keeps selected output untouched', () => {
    const term = terminal();
    term.hasSelection = () => true;
    expect(getPresentedNamedLinks(term, 0, 1)).toEqual([]);
  });

  it('filters file links when the pane cannot open files', () => {
    expect(getPresentedNamedLinks(terminal(), 0, 1, { allowFiles: false }).map(link => link.kind)).toEqual(['web']);
  });

  it.each([0, 6, 15, 25])('does not cover the active cursor at column %i', cursorX => {
    const term = terminal();
    Object.assign(term.buffer.active, { baseY: 0, cursorY: 0, cursorX });
    expect(getPresentedNamedLinks(term, 0, 1).map(link => link.kind)).toEqual(['web']);
  });

  it('uses inclusive terminal cells for multiline hit testing', () => {
    const range = { start: { x: 5, y: 2 }, end: { x: 3, y: 4 } };
    expect(rangeContainsCell(range, 1, 3)).toBe(false);
    expect(rangeContainsCell(range, 1, 4)).toBe(true);
    expect(rangeContainsCell(range, 2, 0)).toBe(true);
    expect(rangeContainsCell(range, 3, 2)).toBe(true);
    expect(rangeContainsCell(range, 3, 3)).toBe(false);
  });
});


it('accepts labels adjacent to parentheses', () => {
  expect(findTerminalNamedLinks(makeBuffer(['이름(https://example.test/a)']), 0, 0, 100)[0]).toMatchObject({ label: '이름', target: 'https://example.test/a' });
});

it('preserves file line and column metadata when opening named targets', () => {
  expect(namedFileLink('src/main.js:12:4')).toEqual({ path: 'src/main.js', line: 12, column: 4, newTab: true });
  expect(namedFileLink('docs/한글.png')).toEqual({ path: 'docs/한글.png', newTab: true });
});
