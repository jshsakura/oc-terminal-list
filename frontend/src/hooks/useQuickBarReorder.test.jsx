import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MobileToolbar from '../components/MobileToolbar';

const pointer = (element, type, x, y = 10) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
  act(() => element.dispatchEvent(event));
};
const setup = () => {
  vi.useFakeTimers();
  const onReorderKeys = vi.fn();
  const onSendKey = vi.fn();
  const keys = ['A', 'B', 'C'].map(label => ({ id: label, kind: 'send', label, payload: label }));
  const view = render(<MobileToolbar language="en" keys={keys} activeSetId="basic"
    onReorderKeys={onReorderKeys} onSendKey={onSendKey} />);
  const scroll = view.container.querySelector('.mobile-toolbar-scroll');
  scroll.getBoundingClientRect = () => ({ left: 0, right: 400 });
  for (const [index, label] of ['A', 'B', 'C'].entries()) {
    screen.getByTitle(label).getBoundingClientRect = () => ({ left: 50 + index * 50, right: 100 + index * 50 });
  }
  return { ...view, onReorderKeys, onSendKey };
};
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('reorders on long press and drop without sending keys, and keeps the pinned input', () => {
  const { onReorderKeys, onSendKey } = setup();
  const first = screen.getByTitle('A');
  pointer(first, 'pointerdown', 75);
  fireEvent.touchStart(first);
  act(() => vi.advanceTimersByTime(400));
  pointer(document, 'pointermove', 140);
  act(() => vi.advanceTimersByTime(20));
  expect(onReorderKeys).not.toHaveBeenCalled();
  pointer(document, 'pointerup', 140);
  expect(onReorderKeys).toHaveBeenCalledOnce();
  expect(onReorderKeys.mock.calls[0][0].map(key => key.id)).toEqual(['cmd', 'B', 'A', 'C']);
  expect(onSendKey).not.toHaveBeenCalled();
});

it('sends a short tap once and ignores the following synthetic click', () => {
  const { onSendKey, onReorderKeys } = setup();
  const first = screen.getByTitle('A');
  pointer(first, 'pointerdown', 75);
  fireEvent.touchStart(first);
  pointer(document, 'pointerup', 75);
  fireEvent.click(first, { detail: 1 });
  expect(onSendKey).toHaveBeenCalledExactlyOnceWith('A');
  expect(onReorderKeys).not.toHaveBeenCalled();
});

it('lets an early swipe scroll instead of sending or reordering and cancels interrupted drags', () => {
  const { onSendKey, onReorderKeys } = setup();
  const first = screen.getByTitle('A');
  pointer(first, 'pointerdown', 75);
  pointer(document, 'pointermove', 120);
  act(() => vi.advanceTimersByTime(450));
  pointer(document, 'pointerup', 120);
  pointer(first, 'pointerdown', 75);
  act(() => vi.advanceTimersByTime(450));
  pointer(document, 'pointermove', 140);
  act(() => vi.advanceTimersByTime(20));
  pointer(document, 'pointercancel', 140);
  expect(onSendKey).not.toHaveBeenCalled();
  expect(onReorderKeys).not.toHaveBeenCalled();
});
