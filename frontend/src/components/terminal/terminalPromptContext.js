const PROMPT = /^\s{0,2}[›❯] (\S.*)$/u;
const MAX_INPUT = 32768;
const normalizedInput = (text) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

// The store contains text and time, not answer positions. Only a matching
// rendered question establishes that position; never use the newest entry as
// a fallback or guess from a common/truncated prefix.
function historyOriginal(text, commands) {
  const normalized = normalizedInput(text);
  const entry = commands.find((item) => typeof item?.text === 'string'
    && normalizedInput(item.text) === normalized);
  return entry ? entry.text.slice(0, MAX_INPUT) : text;
}

export function cellBackground(term, row, column) {
  const line = term.buffer.active.getLine?.(row);
  const cell = [column, Math.max(0, column - 1)].map((col) => line?.getCell?.(col))
    .find((candidate) => candidate?.isBgRGB?.() || candidate?.isBgPalette?.());
  if (cell?.isBgRGB?.()) return `#${cell.getBgColor().toString(16).padStart(6, '0')}`;
  if (cell?.isBgPalette?.()) return term._core?._themeService?.colors?.ansi?.[cell.getBgColor()]?.css || null;
  return null;
}

// A viewport belongs to the last rendered question at/before its first row.
// Read terminal history so reflows, trimmed scrollback and reloads cannot leave
// stale submit-time offsets pointing into a different answer.
export function readTerminalPromptContext(term, commands = []) {
  const buffer = term?.buffer?.active;
  if (!buffer?.getLine || buffer.type !== 'normal' || buffer.viewportY >= buffer.baseY) return null;
  const top = buffer.viewportY;
  for (let start = top; start >= Math.max(0, top - 4000); start -= 1) {
    const line = buffer.getLine(start);
    if (!line || line.isWrapped) continue;
    const first = line.translateToString(!buffer.getLine(start + 1)?.isWrapped);
    const match = first.match(PROMPT);
    if (!match) continue;
    let text = match[1];
    for (let row = start + 1; row < Math.min(buffer.length, top + 81); row += 1) {
      const next = buffer.getLine(row);
      if (!next) break;
      const content = next.translateToString(!buffer.getLine(row + 1)?.isWrapped);
      if (next.isWrapped) text += content;
      else {
        if (!content.trim() || PROMPT.test(content) || !content.startsWith('  ')) break;
        text += `\n${content.slice(2)}`;
      }
      if (text.length >= MAX_INPUT) break;
    }
    return { offset: buffer.baseY - start, text: historyOriginal(text.trimEnd().slice(0, MAX_INPUT), commands),
      background: cellBackground(term, start, first.length - match[1].length) };
  }
  return null;
}
