import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  focusForKeyboard, tapFocusWithProbe, resetTapFocusReports, releaseFocusWhenKeyboardCloses,
  CLIENT_REPORT_EVENT, KEYBOARD_WAIT_MS,
} from './tapFocus';

const makeTerm = () => {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  return { textarea, focus: vi.fn(() => textarea.focus()) };
};

const fakeWin = ({ vvHeight, inner }) => {
  const vv = { height: vvHeight };
  return {
    vv,
    win: {
      visualViewport: vv, innerHeight: inner, document,
      navigator: { userAgent: 'iPhone', maxTouchPoints: 5 },
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
      dispatchEvent: (e) => window.dispatchEvent(e),
    },
  };
};

describe('tapFocus', () => {
  let reports;
  const onReport = (e) => reports.push(e.detail);
  beforeEach(() => {
    vi.useFakeTimers();
    resetTapFocusReports();
    reports = [];
    window.addEventListener(CLIENT_REPORT_EVENT, onReport);
  });
  afterEach(() => {
    window.removeEventListener(CLIENT_REPORT_EVENT, onReport);
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('steps through a helper input when the terminal already has focus, then lands on the terminal', () => {
    const term = makeTerm();
    term.textarea.focus();
    const seen = [];
    document.addEventListener('focusin', (e) => seen.push(e.target.id || e.target.tagName), true);
    expect(focusForKeyboard(term)).toEqual({ refocus: true, via: 'proxy' });
    expect(seen).toEqual(['iterm-tap-focus-proxy', 'TEXTAREA']);
    expect(document.activeElement).toBe(term.textarea);
    focusForKeyboard(term);
    expect(document.querySelectorAll('#iterm-tap-focus-proxy')).toHaveLength(1);   // reused, not piled up
  });

  it('just focuses when focus was elsewhere', () => {
    const term = makeTerm();
    expect(focusForKeyboard(term)).toEqual({ refocus: false, via: 'direct' });
    expect(term.focus).toHaveBeenCalledTimes(1);
    const other = document.createElement('textarea');
    document.body.appendChild(other);
    other.focus();
    expect(focusForKeyboard(term)).toEqual({ refocus: false, via: 'proxy' });   // another field held focus
    expect(document.activeElement).toBe(term.textarea);
  });

  it('reports once when the keyboard did not come up, with what it saw', () => {
    const term = makeTerm();
    term.textarea.focus();
    const { win } = fakeWin({ vvHeight: 800, inner: 844 });
    tapFocusWithProbe(term, { win });
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ scope: 'tap-focus', kind: 'measure' });
    expect(reports[0].detail).toMatch(/no-keyboard refocus=1 via=proxy active=terminal vv=800->800 inner=844 os=ios/);
    tapFocusWithProbe(term, { win });
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    expect(reports).toHaveLength(1);              // one per 30s, not one per tap
  });

  it('says nothing when the keyboard came up or was already up', () => {
    const term = makeTerm();
    const up = fakeWin({ vvHeight: 800, inner: 844 });
    tapFocusWithProbe(term, { win: up.win });
    up.vv.height = 450;
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    const already = fakeWin({ vvHeight: 450, inner: 844 });
    tapFocusWithProbe(term, { win: already.win });
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    expect(reports).toEqual([]);
  });

  it('cancel stops a pending check', () => {
    const term = makeTerm();
    const { win } = fakeWin({ vvHeight: 800, inner: 844 });
    tapFocusWithProbe(term, { win })();
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    expect(reports).toEqual([]);
  });
  describe('releaseFocusWhenKeyboardCloses', () => {
    const resizableWin = ({ vvHeight, inner }) => {
      const listeners = new Set();
      const vv = {
        height: vvHeight,
        addEventListener: (_t, fn) => listeners.add(fn),
        removeEventListener: (_t, fn) => listeners.delete(fn),
      };
      const resize = (h) => { vv.height = h; listeners.forEach(fn => fn()); };
      return { win: { visualViewport: vv, innerHeight: inner, document }, resize, listeners };
    };

    it('lets go of terminal focus when the keyboard closes', () => {
      const term = makeTerm();
      const { win, resize } = resizableWin({ vvHeight: 450, inner: 844 });
      term.textarea.focus();
      releaseFocusWhenKeyboardCloses(term, { win });
      resize(844);
      expect(document.activeElement).not.toBe(term.textarea);
    });

    it('keeps focus while the keyboard stays open or was never open', () => {
      const term = makeTerm();
      const { win, resize } = resizableWin({ vvHeight: 800, inner: 844 });
      term.textarea.focus();
      releaseFocusWhenKeyboardCloses(term, { win });
      resize(780);                                  // browser chrome, not a keyboard
      resize(450);                                  // keyboard opens
      resize(430);                                  // still open
      expect(document.activeElement).toBe(term.textarea);
    });

    it('leaves another focused field alone and detaches cleanly', () => {
      const term = makeTerm();
      const other = document.createElement('input');
      document.body.appendChild(other);
      const { win, resize, listeners } = resizableWin({ vvHeight: 450, inner: 844 });
      other.focus();
      const detach = releaseFocusWhenKeyboardCloses(term, { win });
      resize(844);
      expect(document.activeElement).toBe(other);
      detach();
      expect(listeners.size).toBe(0);
    });
  });
});
