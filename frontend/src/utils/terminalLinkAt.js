import { findFileLinks, MAX_WRAPPED_ROWS } from './terminalFileLinks';

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

// Match logical text, but locate the tap in terminal cells. UTF-16 offsets and
// display columns differ for Korean, emoji and combining characters.
function textAtClient(term, clientX, clientY) {
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
  return { text, index };
}

export function getLinkAtClient(term, clientX, clientY) {
  const hit = textAtClient(term, clientX, clientY);
  if (!hit) return null;
  for (const match of hit.text.matchAll(URL_RE)) {
    if (hit.index >= match.index && hit.index < match.index + match[0].length) return match[0];
  }
  return null;
}

export function getFileLinkAtClient(term, clientX, clientY) {
  const hit = textAtClient(term, clientX, clientY);
  if (!hit) return null;
  return findFileLinks(hit.text).find(link => hit.index >= link.start && hit.index < link.end) || null;
}
