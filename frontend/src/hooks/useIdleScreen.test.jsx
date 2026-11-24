import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import useIdleScreen from './useIdleScreen';
import { isRenderPaused, setRenderPaused } from '../utils/renderPause';

const minute = 60_000;
function Fixture({ minutes = 5, enabled = true, clicked = () => {} }) {
  const paused = useIdleScreen({ minutes, enabled });
  return <><div data-app-surface><input aria-label="terminal" /><button onClick={clicked}>command</button></div>
    {paused && <button aria-label="wake">resting</button>}</>;
}
const advance = ms => act(() => { vi.advanceTimersByTime(ms); });

describe('idle screen', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); setRenderPaused(false); vi.useRealTimers(); });

  it('rests after five minutes even when terminal output keeps arriving', () => {
    render(<Fixture />);
    advance(4 * minute);
    fireEvent(window, new CustomEvent('iterm:activity', { detail: { paneId: 'p1' } }));
    advance(minute);
    expect(screen.getByRole('button', { name: 'wake' })).toBeInTheDocument();
    expect(document.querySelector('[data-app-surface]').inert).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pointermove', 'wheel', 'scroll', 'touchstart', 'input'])('extends the deadline after human %s activity', name => {
    render(<Fixture />);
    advance(4 * minute);
    fireEvent(window, new Event(name, { bubbles: true }));
    advance(2 * minute);
    expect(isRenderPaused()).toBe(false);
    advance(3 * minute);
    expect(isRenderPaused()).toBe(true);
  });

  it('consumes the wake click and restores focus synchronously', () => {
    const clicked = vi.fn();
    render(<Fixture clicked={clicked} />);
    const input = screen.getByLabelText('terminal');
    input.focus();
    advance(5 * minute);
    const command = screen.getByRole('button', { name: 'command' });
    fireEvent.click(command);
    expect(clicked).not.toHaveBeenCalled();
    expect(isRenderPaused()).toBe(false);
    expect(input).toHaveFocus();
    expect(document.querySelector('[data-app-surface]').inert).toBe(false);
    fireEvent.click(command);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('consumes the wake key, its repeat, and its keyup before allowing input', () => {
    render(<Fixture />);
    const input = screen.getByLabelText('terminal');
    const typed = vi.fn();
    input.addEventListener('keydown', typed);
    advance(5 * minute);
    fireEvent.keyDown(input, { key: 'x', code: 'KeyX' });
    fireEvent.keyDown(input, { key: 'x', code: 'KeyX', repeat: true });
    expect(typed).not.toHaveBeenCalled();
    fireEvent.keyUp(input, { key: 'x', code: 'KeyX' });
    fireEvent.keyDown(input, { key: 'x', code: 'KeyX' });
    expect(typed).toHaveBeenCalledOnce();
  });

  it('waits for IME composition to finish', () => {
    render(<Fixture minutes={1} />);
    fireEvent.compositionStart(screen.getByLabelText('terminal'));
    advance(2 * minute);
    expect(isRenderPaused()).toBe(false);
    fireEvent.compositionEnd(screen.getByLabelText('terminal'));
    advance(minute);
    expect(isRenderPaused()).toBe(true);
  });

  it('supports disabling and changing the delay without leaving the app inert', () => {
    const view = render(<Fixture minutes={1} />);
    advance(minute);
    view.rerender(<Fixture minutes={0} />);
    expect(isRenderPaused()).toBe(false);
    expect(document.querySelector('[data-app-surface]').inert).toBe(false);
    advance(30 * minute);
    expect(isRenderPaused()).toBe(false);
    view.rerender(<Fixture minutes={2} />);
    advance(2 * minute);
    expect(isRenderPaused()).toBe(true);
    view.rerender(<Fixture minutes={2} enabled={false} />);
    expect(isRenderPaused()).toBe(false);
  });
});
