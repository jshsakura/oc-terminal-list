const FOOTER_ROWS = 12;
const UPDATE_DELAY_MS = 150;
const modelLabel = /^(?:gpt-[\w.-]+|codex-[\w.-]+|o\d+[\w.-]*)(?:\s+[\w.-]+)?$/i;
const tokenLabel = /^(\d+(?:[.,]\d+)*[kmbt]?)\s+(in|out)$/i;

function parseFooter(line) {
  if (!/\bweekly\b/i.test(line)) { return null; }
  const [model, ...fields] = line.trim().split(/\s*·\s*/);
  if (!modelLabel.test(model)) { return null; }
  let context = '—';
  let input = '—';
  let output = '—';
  let remaining = null;
  for (const field of fields) {
    const weekly = /^weekly\s+(\d{1,3})%\s+left$/i.exec(field);
    if (weekly) {
      if (remaining !== null || Number(weekly[1]) > 100) { return null; }
      remaining = Number(weekly[1]);
      continue;
    }
    const percent = /^context\s+(\d{1,3})%\s+used$/i.exec(field);
    if (percent && Number(percent[1]) <= 100) { context = percent[1] + '%'; }
    const tokens = tokenLabel.exec(field);
    if (tokens?.[2].toLowerCase() === 'in') { input = tokens[1]; }
    if (tokens?.[2].toLowerCase() === 'out') { output = tokens[1]; }
  }
  return remaining === null ? null : { model, context, input, output, remaining };
}

export function readCodexStatusUsage(term) {
  const buffer = term.buffer.active;
  const end = Math.min(buffer.length, buffer.baseY + term.rows);
  const start = Math.max(buffer.baseY, end - FOOTER_ROWS);
  const lines = [];
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row);
    if (!line) { continue; }
    const text = line.translateToString(!buffer.getLine(row + 1)?.isWrapped);
    if (!line.isWrapped) { lines.push(text); }
    else if (lines.length) { lines[lines.length - 1] += text; }
  }
  let result = null;
  for (const line of lines) {
    const usage = parseFooter(line);
    if (usage) {
      if (result) { return null; }
      result = usage;
    }
  }
  return result;
}

export function watchCodexStatusUsage(term, onChange) {
  if (!term) { return undefined; }
  let previous = null;
  let timer = null;
  const scan = () => {
    timer = null;
    if (document.hidden) { return; }
    const next = readCodexStatusUsage(term);
    if (previous?.remaining === next?.remaining && previous?.context === next?.context
        && previous?.model === next?.model && previous?.input === next?.input && previous?.output === next?.output) { return; }
    previous = next;
    onChange(next);
  };
  const schedule = () => {
    if (timer === null && !document.hidden) { timer = setTimeout(scan, UPDATE_DELAY_MS); }
  };
  const write = term.onWriteParsed(schedule);
  const resize = term.onResize(schedule);
  document.addEventListener('visibilitychange', schedule);
  scan();
  return () => {
    clearTimeout(timer);
    write.dispose();
    resize.dispose();
    document.removeEventListener('visibilitychange', schedule);
  };
}
