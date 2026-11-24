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
    it('flushes the first server chunk after user input immediately during a steady stream', () => {
      const out = sink();
      out.push(bytes('stream-1'));
      out.push(bytes('stream-2'));

      out.prioritizeNextPush();
      out.push(bytes('echo'));

      expect(term.text).toBe('stream-1stream-2echo');
      expect(term.writes).toHaveLength(2);

      out.push(bytes('stream-3'));
      expect(term.writes).toHaveLength(2);
      vi.advanceTimersByTime(COALESCE_FOCUSED_MS);
      expect(term.text).toBe('stream-1stream-2echostream-3');
    });

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

    it('uses a lower sustained render budget on a phone without delaying the leading edge', () => {
      const out = sink({ isMobile: () => true });
      out.push(bytes('a'));
      expect(term.text).toBe('a');

      out.push(bytes('b'));
      vi.advanceTimersByTime(COALESCE_FOCUSED_MS);
      expect(term.text).toBe('a');

      vi.advanceTimersByTime(100);
      expect(term.text).toBe('ab');
    });
  });

  describe('inactive panes', () => {
    it('preserves split UTF-8 and escape bytes while packing small background frames', () => {
      let active = false;
      const out = sink({ isActive: () => active });
      const text = '한글\u001b[31m' + 'x'.repeat(33000) + '\u001b[0m끝';
      const data = new TextEncoder().encode(text);

      for (const byte of data) out.push(Uint8Array.of(byte).buffer);

      active = true;
      out.flush();
      expect(term.text).toBe(text);
    });

    it('seals a partial block before a large frame and never reuses flushed storage', () => {
      let active = false;
      const out = sink({ isActive: () => active });
      out.push(bytes('first'));
      out.push(bytes('x'.repeat(32768)));
      out.push(bytes('last'));

      active = true;
      out.flush();
      active = false;
      out.push(bytes('new'));

      expect(term.text).toBe('first' + 'x'.repeat(32768) + 'last');
      active = true;
      out.flush();
      expect(term.text).toBe('first' + 'x'.repeat(32768) + 'lastnew');
    });

    it('buffers hidden output without scheduling background flush timers', () => {
      // Given a hidden page receiving several frames inside a rendering window.
      let visible = false;
      const out = sink({ isVisible: () => visible });

      // When more output arrives while nobody can see the terminal.
      out.push(bytes('first'));
      out.push(bytes('second'));

      // Then no timer wakes the page, and all output is available on return.
      expect(vi.getTimerCount()).toBe(0);
      visible = true;
      out.flush();
      expect(term.text).toBe('firstsecond');
    });

    it('does bounded work as retained background output grows', () => {
      // Given many small output frames retained by an inactive terminal.
      const chunks = Array.from({ length: 200 }, () => bytes('x'));
      const lengths = vi.spyOn(ArrayBuffer.prototype, 'byteLength', 'get');
      let active = false;
      const out = sink({ isActive: () => active });
      try {
        // When the stream keeps arriving, accounting must not scan its entire history.
        for (const chunk of chunks) { out.push(chunk); vi.advanceTimersByTime(5); }

        // Then work grows with incoming frames and the retained content stays intact.
        expect(lengths.mock.calls.length).toBeLessThan(800);
        active = true;
        out.flush();
        expect(term.text).toBe('x'.repeat(200));
      } finally {
        lengths.mockRestore();
      }
    });

    it('keeps the newest bounded background history when returning to the pane', () => {
      // Given output exceeding the retained-history budget before timers can run.
      let active = false;
      const out = sink({ isActive: () => active });

      // When ten megabytes arrive in a background pane.
      for (let i = 0; i < 10; i += 1) out.push(bytes(String(i).repeat(1024 * 1024)));

      // Then returning shows the latest eight megabytes in order.
      active = true;
      out.flush();
      const output = term.text;
      expect(output.length).toBe(8 * 1024 * 1024);
      expect(Array.from({ length: 8 }, (_, i) => output.slice(i * 1024 * 1024, i * 1024 * 1024 + 4)))
        .toEqual(['2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
    });

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

    it('buffers instead of rendering while the browser page is hidden', () => {
      let visible = false;
      const out = sink({ isVisible: () => visible });

      out.push(bytes('while-hidden'));
      vi.advanceTimersByTime(200);
      expect(term.writes).toHaveLength(0);

      visible = true;
      out.flush();
      expect(term.text).toBe('while-hidden');
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
