import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexStatusUsage, watchCodexStatusUsage } from './codexStatusUsage';

const footer = 'GPT-6.2-Astra max · Context 35% used · 81.9M in · 331K out · weekly 82% left';
function terminal(rows, history = 0) {
  const writes = new Set();
  const resizes = new Set();
  const subscribe = listeners => callback => {
    listeners.add(callback);
    return { dispose: () => listeners.delete(callback) };
  };
  return {
    rows: rows.length,
    buffer: { active: { length: history + rows.length, baseY: history, viewportY: 0,
      getLine: vi.fn(index => rows[index - history] && {
        isWrapped: !!rows[index - history].wrapped,
        translateToString: trim => trim ? rows[index - history].text.trimEnd() : rows[index - history].text,
      }),
    } },
    onWriteParsed: subscribe(writes), onResize: subscribe(resizes),
    write: () => writes.forEach(callback => callback()),
    resize: () => resizes.forEach(callback => callback()),
  };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Codex status line', () => {
  it('reads the live bottom of a long buffer and joins a wrapped footer', () => {
    const rows = Array.from({ length: 40 }, () => ({ text: '' }));
    rows[1].text = footer.replace('82%', '1%');
    rows[37].text = footer.slice(0, footer.indexOf('weekly'));
    rows[38] = { text: 'weekly 82% left', wrapped: true };
    const term = terminal(rows, 3000);
    expect(readCodexStatusUsage(term)).toEqual({ model: 'GPT-6.2-Astra max', context: '35%', input: '81.9M', output: '331K', remaining: 82 });
    expect(Math.min(...term.buffer.active.getLine.mock.calls.map(([row]) => row))).toBe(3028);
  });
  it.each(['weekly 82% left', '› '+footer, footer.replace('82%', '110%'), footer.replace('weekly','5h'), footer.split(' · weekly')[0]])('requires a complete model and weekly field in %s', text => {
    expect(readCodexStatusUsage(terminal([{ text }]))).toBeNull();
  });
  it('rejects ambiguous footers and preserves zero with a shorter layout', () => {
    expect(readCodexStatusUsage(terminal([{ text: footer }, { text: footer }]))).toBeNull();
    expect(readCodexStatusUsage(terminal([{ text: 'gpt-6 · weekly 0% left' }]))).toEqual({ model: 'gpt-6', remaining: 0, context: '—', input: '—', output: '—' });
  });
  it('reads again when returning to a visible tab without inspecting background writes', () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const term = terminal([{ text: footer }]), notify = vi.fn();
    const stop = watchCodexStatusUsage(term, notify);
    term.write(); vi.advanceTimersByTime(1000);
    expect(term.buffer.active.getLine).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(200);
    expect(notify.mock.lastCall[0].remaining).toBe(82);
    stop();
  });
  it('coalesces output, updates token-only changes and releases listeners and pending work', () => {
    vi.useFakeTimers();
    const row = { text: footer }, term = terminal([row]), notify = vi.fn();
    const stop = watchCodexStatusUsage(term, notify);
    for (let i = 0; i < 50; i++) { term.write(); }
    vi.advanceTimersByTime(200);
    expect(notify).toHaveBeenCalledTimes(1);
    row.text = footer.replace('81.9M', '82.0M');
    term.write(); term.resize();
    vi.advanceTimersByTime(200);
    expect(notify.mock.lastCall[0].input).toBe('82.0M');
    row.text = 'a narrow or cleared footer';
    term.resize(); vi.advanceTimersByTime(200);
    expect(notify.mock.lastCall[0]).toBeNull();
    term.write(); stop(); row.text = footer; term.write(); term.resize(); vi.runAllTimers();
    expect(notify).toHaveBeenCalledTimes(3);
  });
});
