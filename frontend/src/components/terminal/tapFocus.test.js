import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  focusForKeyboard, tapFocusWithProbe, resetTapFocusReports,
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

  it('blurs first when the terminal already has focus, so the tap moves focus again', () => {
    const term = makeTerm();
    term.textarea.focus();
    const blur = vi.spyOn(term.textarea, 'blur');
    expect(focusForKeyboard(term)).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(term.focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(term.textarea);
  });

  it('just focuses when focus was elsewhere', () => {
    const term = makeTerm();
    expect(focusForKeyboard(term)).toBe(false);
    expect(term.focus).toHaveBeenCalledTimes(1);
  });

  it('reports once when the keyboard did not come up, with what it saw', () => {
    const term = makeTerm();
    term.textarea.focus();
    const { win } = fakeWin({ vvHeight: 800, inner: 844 });
    tapFocusWithProbe(term, { win });
    vi.advanceTimersByTime(KEYBOARD_WAIT_MS);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ scope: 'tap-focus', kind: 'measure' });
    expect(reports[0].detail).toMatch(/no-keyboard refocus=1 active=terminal vv=800->800 inner=844 os=ios/);
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
});
