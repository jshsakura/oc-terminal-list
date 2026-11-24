import { getPresentedNamedLinks, rangeContainsCell, namedFileLink, terminalNamedLinkPresentations } from './terminalNamedLinks';
import { findFileLinks, fileLinkFromUri, MAX_WRAPPED_ROWS, wrappedFileLinkAtCell } from './terminalFileLinks';
import { findUrlLinks, readRow } from './terminalUrlLinks';

// Match logical text, but locate the tap in terminal cells. UTF-16 offsets and
// display columns differ for Korean, emoji and combining characters.
function cellAtClient(term, clientX, clientY) {
  const screen = term?.element?.querySelector?.('.xterm-screen') || term?.element;
  const rect = screen?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return null;
  const dims = term._core?._renderService?.dimensions?.css?.cell;
  let col = Math.floor((clientX - rect.left) / (dims?.width || rect.width / term.cols));
  const row = Math.floor((clientY - rect.top) / (dims?.height || rect.height / term.rows));
  if (col < 0 || col >= term.cols || row < 0 || row >= term.rows) return null;
  const buffer = term.buffer.active;
  const targetRow = buffer.viewportY + row;
  const targetLine = buffer.getLine?.(targetRow);
  if (!targetLine) return null;
  if (targetLine.getCell?.(col)?.getWidth() === 0 && col > 0) col--;
  const linkId = targetLine.getCell?.(col)?.extended?.urlId;
  const uri = linkId ? term._core?._oscLinkService?.getLinkData?.(linkId)?.uri : null;
  return { buffer, targetRow, col, uri };
}

function textAtClient(term, clientX, clientY) {
  const hit = cellAtClient(term, clientX, clientY);
  if (!hit) return null;
  const { buffer, targetRow, col } = hit;
  let startRow = targetRow;
  while (startRow > 0 && targetRow - startRow < MAX_WRAPPED_ROWS - 1 && buffer.getLine(startRow)?.isWrapped) startRow--;
  let text = '';
  let index = 0;
  for (let i = startRow; i < startRow + MAX_WRAPPED_ROWS; i++) {
    const line = buffer.getLine(i);
    if (!line || (i > startRow && !line.isWrapped)) break;
    const part = line.translateToString(false);
    if (i === targetRow) {
      const prefix = line.getCell ? line.translateToString(false, 0, col) : part.slice(0, col);
      index = text.length + prefix.length;
    }
    text += part;
  }
  return { ...hit, text, index };
}

export function wrappedWebLinks(buffer, targetRow) {
  let text = '';
  const cells = [];
  for (let row = Math.max(0, targetRow - MAX_WRAPPED_ROWS + 1); row < targetRow + MAX_WRAPPED_ROWS; row++) {
    const line = buffer.getLine(row);
    if (!line) { break; }
    if (text && !line.isWrapped) {
      text += '\n';
      cells.push(null);
    }
    const part = line.translateToString(false).trimEnd();
    let col = 0;
    for (const char of part) {
      while (line.getCell?.(col)?.getWidth() === 0) { col++; }
      const cell = { x: col + 1, y: row + 1 };
      for (let i = 0; i < char.length; i++) { cells.push(cell); }
      col += line.getCell?.(col)?.getWidth() || 1;
    }
    text += part;
  }
  const found = [];
  const pattern = /\((https?:\/\/[^\s()<>'"]*(?:\n[ \t]*[^\s()<>'"]+){1,7})\)/g;
  for (const match of text.matchAll(pattern)) {
    const uri = match[1].replace(/\n[ \t]*/g, '');
    const start = cells[match.index + 1];
    const end = cells[match.index + match[0].length - 2];
    if (start.y <= targetRow + 1 && end.y >= targetRow + 1 && normalizeWebUri(uri)) {
      found.push({ text: uri, range: { start, end } });
    }
  }
  return found;
}

export function normalizeWebUri(uri) {
  const value = uri.replace(/\r?\n[ \t]*/g, '');
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function namedHit(term, hit) {
  const presentation = terminalNamedLinkPresentations.get(term);
  const links = presentation ? presentation.links(hit.targetRow, hit.targetRow) : getPresentedNamedLinks(term, hit.targetRow, hit.targetRow);
  for (const link of links) {
    if (rangeContainsCell(link.labelRange, hit.targetRow, hit.col)) { return { link, label: true }; }
    if (link.hiddenRanges.some(range => rangeContainsCell(range, hit.targetRow, hit.col))) { return { link, label: false }; }
  }
  return null;
}

export function getLinkAtClient(term, clientX, clientY) {
  const hit = cellAtClient(term, clientX, clientY);
  if (!hit) return null;
  if (hit.uri) {
    return normalizeWebUri(hit.uri);
  }
  const named = namedHit(term, hit);
  if (named) { return named.label && named.link.kind === 'web' ? named.link.target : null; }
  const wrapped = wrappedWebLinks(term.buffer.active, hit.targetRow).find(({ range }) =>
    (hit.targetRow + 1 > range.start.y || hit.col + 1 >= range.start.x)
    && (hit.targetRow + 1 < range.end.y || hit.col + 1 <= range.end.x));
  if (wrapped) { return wrapped.text; }
  const { buffer, targetRow, col } = hit;
  const links = findUrlLinks(index => readRow(buffer, index, term.cols), targetRow, term.cols);
  return links.find(link => link.segments.some(segment =>
    segment.row === targetRow && col >= segment.startX && col <= segment.endX))?.url ?? null;
}

export function getFileLinkAtClient(term, clientX, clientY) {
  const hit = textAtClient(term, clientX, clientY);
  if (!hit) return null;
  if (hit.uri) {
    return fileLinkFromUri(hit.uri);
  }
  const named = namedHit(term, hit);
  if (named) { return named.label && named.link.kind === 'file' ? namedFileLink(named.link.target) : null; }
  return wrappedFileLinkAtCell(term.buffer.active, hit.targetRow, hit.col)
    || findFileLinks(hit.text).find(link => hit.index >= link.start && hit.index < link.end) || null;
}
