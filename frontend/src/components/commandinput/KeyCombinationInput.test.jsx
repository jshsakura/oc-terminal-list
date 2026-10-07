import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ko } from '../../i18n/locales/ko';
import KeyCombinationInput from './KeyCombinationInput';

const setup = () => {
  const onSend = vi.fn();
  const view = render(<KeyCombinationInput t={(key) => ko[key]} onSend={onSend} />);
  return { ...view, onSend, input: screen.getByLabelText('나머지 키'),
    send: screen.getByRole('button', { name: '조합키 전송' }) };
};

it('previews modifiers and sends only when requested', () => {
  const { onSend, input, send } = setup();
  expect(input).toHaveFocus();
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }));
  fireEvent.click(screen.getByRole('button', { name: 'Alt' }));
  fireEvent.change(input, { target: { value: 'x' } });
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + Alt + X');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(send);
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x1b\x18');
  expect(input.value).toBe('x');
});

it('supports Shift+Tab and toggling a modifier back off', () => {
  const { input, onSend } = setup();
  const shift = screen.getByRole('button', { name: 'Shift' });
  fireEvent.click(shift);
  fireEvent.change(input, { target: { value: 'Tab' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSend).toHaveBeenLastCalledWith('\x1b[Z');
  fireEvent.click(shift);
  expect(shift).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSend).toHaveBeenLastCalledWith('\t');
});

it('blocks empty, unsupported and composing input', () => {
  const { input, send, onSend } = setup();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'Ctrl+C' } });
  expect(send).toBeDisabled();
  fireEvent.click(send);
  fireEvent.change(input, { target: { value: 'c' } });
  fireEvent.compositionStart(input);
  expect(send).toBeDisabled();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(onSend).not.toHaveBeenCalled();
  act(() => fireEvent.compositionEnd(input));
  expect(send).not.toBeDisabled();
});
