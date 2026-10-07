import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import attachMobileViewSelection from './attachMobileViewSelection';

describe('mobile view selection', () => {
  let term, overlay, api, locked, scroll, menu, file, open, zoom;
  const touch = (type, x, y, count = 1) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : Array.isArray(x) ? x
      : Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
    overlay.dispatchEvent(event);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    locked = true;
    overlay = document.createElement('div');
    document.body.append(overlay);
    const text = 'alpha beta https://example.com src/main.js:12';
    const line = { translateToString: (_, start = 0, end = 80) => text.slice(start, end),
      getCell: col => ({ getWidth: () => 1, getChars: () => text[col] || ' ' }) };
    term = { cols: 80, rows: 20, element: overlay, options: { fontSize: 13 },
      _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } },
      buffer: { active: { viewportY: 0, getLine: row => row === 0 ? line : null } },
      select: vi.fn(), clearSelection: vi.fn(), hasSelection: () => term.select.mock.calls.length > 0 };
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 });
    scroll = vi.fn(); menu = vi.fn(); file = vi.fn(); zoom = vi.fn();
    open = vi.spyOn(window, 'open').mockImplementation(() => null);
    api = attachMobileViewSelection({ term, overlay, isReadOnly: () => locked,
      scroll, setContextMenu: menu, onFileLinkClick: file, onViewFontSize: zoom });
  });
  afterEach(() => { api.detach(); overlay.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('selects a word on hold, extends the range on vertical drag, then offers copy', () => {
    touch('touchstart', 15, 10);
    touch('touchmove', 17, 12); // Finger jitter must not cancel a hold.
    vi.advanceTimersByTime(510);
    expect(term.select).toHaveBeenLastCalledWith(0, 0, 5);
    touch('touchmove', 105, 30);
    expect(term.select).toHaveBeenLastCalledWith(0, 0, 91);
    touch('touchend', 105, 30);
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ hasSelection: true }));
    expect(scroll).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('selects by horizontal drag, including a reversed range', () => {
    touch('touchstart', 95, 10);
    touch('touchmove', 15, 10);
    touch('touchend', 15, 10);
    expect(term.select).toHaveBeenLastCalledWith(1, 0, 9);
    expect(scroll).not.toHaveBeenCalled();
  });
  it('vertical swipes keep scrolling without opening links or selecting', () => {
    touch('touchstart', 150, 10);
    touch('touchmove', 150, 110);
    vi.advanceTimersByTime(600);
    touch('touchend', 150, 110);
    expect(scroll).toHaveBeenCalledWith(-50, 150, 110);
    expect(term.select).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('pinches both directions within font limits without scrolling, selecting or opening links', () => {
    touch('touchstart', 150, 10);
    touch('touchstart', [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }]);
    touch('touchmove', [{ clientX: 50, clientY: 100 }, { clientX: 250, clientY: 100 }]);
    expect(zoom).toHaveBeenLastCalledWith(26);
    touch('touchmove', [{ clientX: 0, clientY: 100 }, { clientX: 400, clientY: 100 }]);
    expect(zoom).toHaveBeenLastCalledWith(28);
    touch('touchmove', [{ clientX: 140, clientY: 100 }, { clientX: 160, clientY: 100 }]);
    expect(zoom).toHaveBeenLastCalledWith(8);
    vi.advanceTimersByTime(600);
    touch('touchend', 150, 10);
    expect(scroll).not.toHaveBeenCalled();
    expect(term.select).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('ends a pinch when one finger remains and requires a fresh touch before scrolling', () => {
    touch('touchstart', [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }]);
    touch('touchmove', 150, 200);
    touch('touchmove', 150, 300);
    touch('touchend', 150, 300);
    expect(scroll).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    touch('touchstart', 150, 100);
    touch('touchmove', 150, 200);
    expect(scroll).toHaveBeenCalledWith(-50, 150, 200);
  });
  it('taps open URLs and local file links, without treating a URL hold as a click', () => {
    touch('touchstart', 150, 10); touch('touchend', 150, 10);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    touch('touchstart', 350, 10); touch('touchend', 350, 10);
    expect(file).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/main.js', line: 12 }));
    touch('touchstart', 150, 10); vi.advanceTimersByTime(510); touch('touchend', 150, 10);
    expect(open).toHaveBeenCalledOnce();
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ linkUrl: 'https://example.com' }));
  });
  it('cancels interrupted, multi-touch and unlocked gestures', () => {
    touch('touchstart', 150, 10); touch('touchcancel', 150, 10);
    vi.advanceTimersByTime(600); touch('touchend', 150, 10);
    touch('touchstart', 150, 10); touch('touchstart', 150, 10, 2);
    vi.advanceTimersByTime(600); touch('touchend', 150, 10);
    touch('touchstart', 150, 10); locked = false;
    vi.advanceTimersByTime(600); touch('touchend', 150, 10);
    expect(term.select).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
  });
  it('also selects using a mouse in a narrow viewport', () => {
    overlay.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 15, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 65, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 65, clientY: 10 }));
    expect(term.select).toHaveBeenLastCalledWith(1, 0, 6);
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ hasSelection: true }));
  });
});
