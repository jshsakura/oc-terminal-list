const PROMPT = /^(?:\s*[›❯>]\s?|.*?[$#%]\s+)/u;
const PRIVATE_PROMPT = /(?:password|passphrase|secret|pin|비밀번호|암호)\s*[:：]?\s*$/iu;
const MAX_LENGTH = 32768;
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const dropLast = (text) => (segmenter
  ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text)).slice(0, -1).join('');

// Start from a recognized, visible prompt. Unknown prompts and hidden password
// entry must never turn into a second, visible copy of the input.
export function readPromptInput(term) {
  const buf = term?.buffer?.active;
  if (!buf?.getLine) return null;
  const cursor = buf.baseY + buf.cursorY;
  let start = cursor;
  const textAt = (row) => buf.getLine(row)?.translateToString(!buf.getLine(row + 1)?.isWrapped) || '';
  if (PRIVATE_PROMPT.test(textAt(cursor))) return null;
  while (start > Math.max(buf.baseY, cursor - 80)) {
    const line = buf.getLine(start);
    if (!line?.isWrapped && PROMPT.test(textAt(start))) break;
    // Agent multiline inputs use an indented continuation. Stop at output,
    // blank lines and input-box borders instead of searching unrelated history.
    if (!line?.isWrapped && !/^\s+\S/u.test(textAt(start))) return null;
    start -= 1;
  }
  const first = textAt(start);
  const prefix = first.match(PROMPT)?.[0];
  if (!prefix) return null;
  // Agent placeholders are dim text on an otherwise empty input line.
  if (buf.getLine(start)?.getCell?.(prefix.length)?.isDim?.()) return '';
  let text = first.slice(prefix.length);
  for (let row = start + 1; row <= cursor; row += 1) {
    const line = buf.getLine(row);
    text += line?.isWrapped ? textAt(row) : `\n${textAt(row).replace(/^ {1,2}/, '')}`;
  }
  // Editing in the middle of a wrapped input must keep the text after the cursor.
  for (let row = cursor + 1; row < Math.min(buf.length, cursor + 80); row += 1) {
    const line = buf.getLine(row);
    if (line?.isWrapped) text += textAt(row);
    else if (/^ {2}\S/u.test(textAt(row))) text += `\n${textAt(row).slice(2)}`;
    else break;
  }
  return text.slice(0, MAX_LENGTH);
}

export function submittedInput(term, data, command) {
  if (typeof data !== 'string' || !data.endsWith('\r') || data.includes('\x1b')) return '';
  const echoed = readPromptInput(term);
  if (echoed === null) return '';
  // Programmatic commands are already complete; a trailing iOS Hangul syllable
  // can instead arrive in the same packet as Enter, before the server echoes it.
  const text = typeof command === 'string' ? command : echoed + data.slice(0, -1);
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, MAX_LENGTH);
}

// Keep only the current draft in memory so fast typing and the final IME
// syllable do not depend on network echo latency. Cursor/history operations
// invalidate the tail model; the next submission then reads the actual screen.
export function createSubmittedInputCapture(term, onSubmit) {
  let draft = null;
  return (data, command) => {
    if (typeof data !== 'string') return;
    if (data.endsWith('\r') && !data.includes('\x1b')) {
      const next = submittedInput(term, data, command ?? (draft === null ? undefined : draft + data.slice(0, -1)));
      draft = null;
      if (next) onSubmit(next);
      return;
    }
    const pasted = data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~');
    const input = pasted ? data.slice(6, -6).replace(/\r\n?/g, '\n') : data;
    if (/[\x00-\x07\x0b-\x1f]/.test(input)) { draft = null; return; }
    if (draft === null) {
      draft = readPromptInput(term);
      // Only model appends. A cursor in the middle needs the editor's echo.
      const buf = term.buffer.active;
      const line = buf.getLine?.(buf.baseY + buf.cursorY);
      if (!line?.getCell?.(buf.cursorX)?.isDim?.()
          && line?.translateToString(true, buf.cursorX).trim()) {
        draft = null;
      }
    }
    if (draft === null) return;
    for (const char of input.slice(0, MAX_LENGTH * 2)) {
      if (char === '\b' || char === '\x7f') draft = dropLast(draft);
      else if (draft.length < MAX_LENGTH) draft += char;
    }
  };
}
