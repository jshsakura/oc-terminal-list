import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import createOutputSink, {
  COALESCE_EINK_MS,
  COALESCE_FOCUSED_MS,
  COALESCE_VISIBLE_MS,
} from './createOutputSink';

/* Timing is the whole point of this module, so every test drives fake timers.
   `term.write(data, cb)` is recorded and the callback fired synchronously — the real
   xterm defers it, but nothing here depends on that. */
const makeTerm = () => {
  const writes = [];
  return {
    writes,
    write: (data, cb) => { writes.push(data); cb?.(); },
    get text() { return writes.map((w) => new TextDecoder().decode(w)).join(''); },
  };
};

const bytes = (s) => {
  const src = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(src.byteLength);
  new Uint8Array(buf).set(src);
  return buf;
};

describe('createOutputSink', () => {
  let term;

  beforeEach(() => {
    vi.useFakeTimers();
    term = makeTerm();
  });
  afterEach(() => { vi.useRealTimers(); });

  const sink = (opts = {}) => createOutputSink({
    term,
    isActive: () => true,
    isFocused: () => true,
    ...opts,
  });

  describe('e-ink mode', () => {
    // The mode's main saving. An e-ink panel needs 100-300ms per refresh, so pushing it
    // at 30fps buys nothing but ghosting.
    it('widens the window even for the focused pane', () => {
      const out = sink({ isEink: () => true });
      out.push(bytes('a'));          // leading edge — drawn at once
      expect(term.text).toBe('a');

      out.push(bytes('b'));
      vi.advanceTimersByTime(COALESCE_FOCUSED_MS + 5);
      expect(term.text).toBe('a');   // a normal window would have flushed here

      vi.advanceTimersByTime(COALESCE_EINK_MS);
      expect(term.text).toBe('ab');
    });

    // Keystroke echo after a quiet spell must stay instant — a 300ms window on *input*
    // would make the terminal feel broken, which is not what this mode is buying.
    it('keeps the leading edge, so a quiet keystroke still draws at once', () => {
      const out = sink({ isEink: () => true });
      out.push(bytes('x'));
      expect(term.text).toBe('x');
      vi.advanceTimersByTime(COALESCE_EINK_MS + 5);
      out.push(bytes('y'));
      expect(term.text).toBe('xy');
    });

    it('is off unless asked — the default sink is unchanged', () => {
      const out = sink();
      out.push(bytes('a'));
      out.push(bytes('b'));
      vi.advanceTimersByTime(COALESCE_FOCUSED_MS + 5);
      expect(term.text).toBe('ab');
    });
  });

  describe('leading edge', () => {
    // The whole reason for leading edge: a keystroke echo after a quiet spell used to
    // wait out the batch timer before it was drawn.
    it('writes the first chunk after a quiet spell with no timer wait', () => {
      const out = sink();
      out.push(bytes('a'));
      expect(term.text).toBe('a');
    });

    it('goes back to leading edge once the window has elapsed', () => {
      const out = sink();
      out.push(bytes('a'));
      vi.advanceTimersByTime(COALESCE_FOCUSED_MS + 1);

      out.push(bytes('b'));
      expect(term.text).toBe('ab');
    });
  });

  describe('coalescing', () => {
    it('folds sustained output into one write per window', () => {
      const out = sink();
      out.push(bytes('1'));           // leading edge — drawn now
      expect(term.writes).toHaveLength(1);

      // Everything arriving inside the window is one more write, not one per chunk.
      out.push(bytes('2'));
      out.push(bytes('3'));
      out.push(bytes('4'));
      expect(term.writes).toHaveLength(1);

      vi.advanceTimersByTime(COALESCE_FOCUSED_MS);
      expect(term.writes).toHaveLength(2);
      expect(term.text).toBe('1234');
    });

    it('draws an unfocused-but-visible pane on the slower window', () => {
      const out = sink({ isFocused: () => false });
      out.push(bytes('1'));
      out.push(bytes('2'));

      vi.advanceTimersByTime(COALESCE_FOCUSED_MS);
      expect(term.text).toBe('1');            // focused window is not enough

      vi.advanceTimersByTime(COALESCE_VISIBLE_MS - COALESCE_FOCUSED_MS);
      expect(term.text).toBe('12');
    });

    it('caps a steady stream at one write per window, not one per chunk', () => {
      const out = sink();
      // 60 chunks spread over 300ms — a stream arriving every 5ms.
      for (let i = 0; i < 60; i += 1) {
        out.push(bytes('x'));
        vi.advanceTimersByTime(5);
      }
      // 300ms / 33ms ≈ 9 windows. The old 16ms trailing batch drew ~19 times.
      expect(term.writes.length).toBeLessThanOrEqual(10);
      expect(term.text).toBe('x'.repeat(60));
    });
  });

  describe('inactive panes', () => {
    it('buffers instead of writing, then flushes on reactivation', () => {
      let active = false;
      const out = sink({ isActive: () => active });

      out.push(bytes('while-inactive'));
      vi.advanceTimersByTime(200);
      expect(term.writes).toHaveLength(0);

      active = true;
      out.flush();
      expect(term.text).toBe('while-inactive');
    });
  });

  describe('callbacks', () => {
    it('reports content and new data once per write', () => {
      const onContent = vi.fn();
      const onNewData = vi.fn();
      const onServerOutput = vi.fn();
      const out = sink({ onContent, onNewData, onServerOutput });

      out.push(bytes('hi'));
      expect(onContent).toHaveBeenCalledTimes(1);
      expect(onNewData).toHaveBeenCalledTimes(1);
      expect(onServerOutput).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('drops buffered output so nothing reaches an evicted terminal', () => {
      const out = sink();
      out.push(bytes('first'));       // leading edge — already drawn
      out.push(bytes('evicted'));     // still buffered
      out.clear();

      vi.advanceTimersByTime(200);
      expect(term.text).toBe('first');
    });
  });
});
