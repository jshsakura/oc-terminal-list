import { findFileLinks } from './terminalFileLinks';

const CONTEXT_ROWS = 8;
export const terminalNamedLinkPresentations = new WeakMap();

function readCells(buffer, startRow, endRow, cols) {
  let text = '';
  const cells = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const line = buffer.getLine(row);
    if (!line) { break; }
    if (row > startRow && !line.isWrapped) {
      text += '\n';
      cells.push(null);
    }
    if (!line.getCell?.(0)?.getChars) { continue; }
    let part = '';
    const positions = [];
    let lastContent = 0;
    for (let col = 0; col < cols; col += 1) {
      const cell = line.getCell(col);
      const width = cell?.getWidth() ?? 1;
      if (width === 0) { continue; }
      const chars = cell?.getChars() || ' ';
      const position = { start: { x: col + 1, y: row + 1 }, end: { x: col + width, y: row + 1 }, linked: !!cell?.extended?.urlId };
      for (let index = 0; index < chars.length; index += 1) { positions.push(position); }
      part += chars;
      if (cell?.getChars()) { lastContent = part.length; }
    }
    text += part.slice(0, lastContent);
    cells.push(...positions.slice(0, lastContent));
  }
  return { text, cells };
}

function targetKind(target) {
  if (/^https?:\/\//i.test(target)) {
    try {
      return new URL(target).hostname ? 'web' : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) { return null; }
  return /^(?:\/{1}|~\/|\.{1,2}\/|[^\s/]+\/)[^\s<>"'`]+$/u.test(target) ? 'file' : null;
}

function cellRange(cells, start, end) {
  return { start: cells[start].start, end: cells[end - 1].end };
}

function rowRanges(range, cols) {
  const ranges = [];
  for (let row = range.start.y; row <= range.end.y; row += 1) {
    ranges.push({ start: { x: row === range.start.y ? range.start.x : 1, y: row }, end: { x: row === range.end.y ? range.end.x : cols, y: row } });
  }
  return ranges;
}

export function findTerminalNamedLinks(buffer, startRow, endRow, cols) {
  if (!buffer?.getLine || cols <= 0 || startRow < 0 || endRow < startRow) { return []; }
  const { text, cells } = readCells(buffer, Math.max(0, startRow - CONTEXT_ROWS), endRow + CONTEXT_ROWS, cols);
  const links = [];
  let previousEnd = -1;
  const pattern = /\[([^\[\]\n]+)\]\(|(?:^|\n|[•·|]|\)\s+(?=\S))(?:[ \t]*(?:[-*] |\d+\. ))?([^\n()[\]•·|]+)(?:\n\s*)?\(/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index < previousEnd) { continue; }
    const markdown = match[1] !== undefined;
    const label = (match[1] ?? match[2]).trim();
    if (!label || label.length > 120) { continue; }
    const open = match.index + match[0].length - 1;
    let close = open + 1;
    let depth = 1;
    for (; close < text.length && depth; close += 1) {
      if (text[close] === '(') { depth += 1; }
      if (text[close] === ')') { depth -= 1; }
    }
    if (depth) { continue; }
    close -= 1;
    const raw = text.slice(open + 1, close);
    if (/[\x00-\x09\x0b-\x1f\x7f<>"'`]/.test(raw) || /\n(?![ \t]+\S)/.test(raw)) { continue; }
    const target = raw.replace(/\n[ \t]+/g, '');
    if (/\s/.test(target)) { continue; }
    const kind = targetKind(target);
    if (!kind) { continue; }
    const labelStart = match.index + match[0].indexOf(label);
    const labelEnd = labelStart + label.length;
    const fullStart = markdown ? match.index : labelStart;
    if (cells.slice(fullStart, close + 1).some(cell => cell?.linked)) { continue; }
    const labelRange = cellRange(cells, labelStart, labelEnd);
    const end = cells[close].end;
    if (labelRange.start.y > endRow + 1 || end.y < startRow + 1) { continue; }
    const hiddenRanges = rowRanges(cellRange(cells, labelEnd, close + 1), cols);
    if (markdown) { hiddenRanges.unshift(cellRange(cells, fullStart, labelStart)); }
    links.push({ key: `${labelRange.start.y}:${labelRange.start.x}:${target}`, label, target, kind, labelRange, hiddenRanges });
    previousEnd = close;
  }
  return links;
}

export function rangeContainsCell(range, row, col) {
  const x = col + 1;
  const y = row + 1;
  return y >= range.start.y && y <= range.end.y
    && (y !== range.start.y || x >= range.start.x)
    && (y !== range.end.y || x <= range.end.x);
}

export function getPresentedNamedLinks(term, startRow, endRow, { allowFiles = true } = {}) {
  if (term?.hasSelection?.()) { return []; }
  const buffer = term?.buffer?.active;
  const cursorRow = buffer?.baseY + buffer?.cursorY;
  const cursorCol = buffer?.cursorX;
  const hasCursor = Number.isFinite(cursorRow) && Number.isFinite(cursorCol);
  return findTerminalNamedLinks(buffer, startRow, endRow, term?.cols).filter(link => {
    if (link.kind === 'file' && !allowFiles) { return false; }
    return !hasCursor || ![link.labelRange, ...link.hiddenRanges].some(range => cursorRow + 1 >= range.start.y && cursorRow + 1 <= range.end.y);
  });
}

export function namedFileLink(target) {
  const parsed = findFileLinks(target).find(link => link.start === 0 && link.end === target.length);
  return parsed ? { path: parsed.path, line: parsed.line, column: parsed.column, newTab: true } : { path: target, newTab: true };
}
