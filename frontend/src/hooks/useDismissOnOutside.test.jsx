import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { useDismissOnOutside } from './useDismissOnOutside';

const Popup = ({ onClose, ...options }) => {
  const ref = useRef(null);
  useDismissOnOutside(ref, onClose, options);
  return <div ref={ref} data-testid="popup"><button type="button">item</button></div>;
};

const press = (target, init = {}) => {
  // jsdom has no PointerEvent, so the hook listens on mousedown there — dispatch both
  // shapes so the test asserts behaviour, not which name the browser gave the press.
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...init }));
  });
};

const flushArm = async () => {
  // The listener is armed on the next tick so the opening press cannot close it.
  await act(async () => { await new Promise((r) => setTimeout(r, 1)); });
};

describe('useDismissOnOutside', () => {
  it('closes on a press outside', async () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} />);
    await flushArm();

    press(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a press inside', async () => {
    const onClose = vi.fn();
    const { getByText } = render(<Popup onClose={onClose} />);
    await flushArm();

    press(getByText('item'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} />);
    await flushArm();

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close from the press that opened it', () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} />);
    press(document.body);   // same tick — listener not armed yet
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores presses on the toggle button, which owns open/close itself', async () => {
    const onClose = vi.fn();
    const toggle = document.createElement('button');
    toggle.setAttribute('data-more', 'true');
    document.body.appendChild(toggle);
    render(<Popup onClose={onClose} ignoreSelector='[data-more="true"]' />);
    await flushArm();

    press(toggle);
    expect(onClose).not.toHaveBeenCalled();
    toggle.remove();
  });

  it('can ignore the right button so a context menu is not eaten by its own opening', async () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} ignoreRightButton />);
    await flushArm();

    press(document.body, { button: 2 });
    expect(onClose).not.toHaveBeenCalled();
    press(document.body, { button: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('listens in the capture phase — a child that stops propagation cannot block it', async () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} />);
    await flushArm();

    const blocker = document.createElement('div');
    blocker.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(blocker);

    press(blocker);
    expect(onClose).toHaveBeenCalledTimes(1);
    blocker.remove();
  });

  it('does nothing while disabled', async () => {
    const onClose = vi.fn();
    render(<Popup onClose={onClose} enabled={false} />);
    await flushArm();

    press(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
